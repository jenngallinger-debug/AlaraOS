'use strict';
// =============================================================================
// AlaraOS Engine V1 — the workflow core.
//
// Design (docs/ALARAOS-HUMAN-BOUNDARY.md): every workflow is a list of steps.
// Engine steps run automatically. Human steps STOP the engine and create a
// PROMPT — a first-class object holding everything the engine prepared (the
// brief), the exact input schema it needs back, the role that must answer,
// and an SLA clock. When a human submits input, the step's apply() consumes
// it and the engine continues. Pattern everywhere:
//     engine prepares → human acts → engine records and follows up.
//
// V1 persistence is JSON-on-disk (single-writer, same stdlib philosophy as
// server.js). Every state change is journaled append-only per case — the
// audit trail is not optional.
// =============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'engine');
const CASES_DIR = path.join(DATA_DIR, 'cases');
const JOURNAL_DIR = path.join(DATA_DIR, 'journal');

function ensureDirs() {
  for (const d of [DATA_DIR, CASES_DIR, JOURNAL_DIR]) fs.mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
function caseFile(id) { return path.join(CASES_DIR, id + '.json'); }

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

function loadCase(id) {
  if (!/^[a-z0-9-]+$/.test(id)) return null; // path-safety
  try { return JSON.parse(fs.readFileSync(caseFile(id), 'utf8')); } catch (e) { return null; }
}

function saveCase(c) {
  ensureDirs();
  fs.writeFileSync(caseFile(c.id), JSON.stringify(c, null, 1));
}

function listCases() {
  ensureDirs();
  return fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => loadCase(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function journal(caseId, type, detail) {
  ensureDirs();
  const rec = { ts: new Date().toISOString(), type, detail: detail || {} };
  fs.appendFileSync(path.join(JOURNAL_DIR, caseId + '.jsonl'), JSON.stringify(rec) + '\n');
  return rec;
}

function readJournal(caseId) {
  if (!/^[a-z0-9-]+$/.test(caseId)) return [];
  try {
    return fs.readFileSync(path.join(JOURNAL_DIR, caseId + '.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Clocks — every published SLA is a measured clock, breach = visible.
// ---------------------------------------------------------------------------
function hoursBetween(a, b) { return (new Date(b) - new Date(a)) / 36e5; }

function clockStatus(c) {
  if (!c.prompt || !c.prompt.dueAt) return null;
  const now = new Date().toISOString();
  const remainingH = -hoursBetween(c.prompt.dueAt, now);
  return { dueAt: c.prompt.dueAt, remainingH: Math.round(remainingH * 10) / 10, breached: remainingH < 0 };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------
const registry = {}; // workflowName -> steps[]

function defineWorkflow(name, steps) { registry[name] = steps; }

function createCase(workflowName, kind, fields) {
  ensureDirs();
  const c = {
    id: newId(workflowName),
    workflow: workflowName,
    kind: kind || workflowName,
    state: 'running',
    stepIndex: 0,
    prompt: null,           // set while waiting on a human
    fields: fields || {},   // the case's working data
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  journal(c.id, 'case_created', { workflow: workflowName, kind: c.kind });
  saveCase(c);
  advance(c.id);
  return loadCase(c.id);
}

// Run engine steps until: a human step (create prompt, stop), the end (done),
// or an engine error (state=error, humans see it in the console).
function advance(caseId) {
  const c = loadCase(caseId);
  if (!c || c.state === 'done' || c.state === 'error') return c;
  const steps = registry[c.workflow] || [];

  while (c.stepIndex < steps.length) {
    const step = steps[c.stepIndex];

    if (step.type === 'human') {
      const p = step.prompt(c);
      c.prompt = {
        stepId: step.id,
        role: step.role,
        title: p.title,
        brief: p.brief,             // everything the engine prepared — no blank pages
        inputs: p.inputs,           // the exact schema the engine needs back
        createdAt: new Date().toISOString(),
        dueAt: step.slaHours ? new Date(Date.now() + step.slaHours * 36e5).toISOString() : null
      };
      c.state = 'waiting_human';
      c.updatedAt = new Date().toISOString();
      journal(c.id, 'prompt_created', { stepId: step.id, role: step.role, title: p.title, dueAt: c.prompt.dueAt });
      saveCase(c);
      return c;
    }

    // engine step
    try {
      const note = step.run(c) || {};
      journal(c.id, 'engine_step', { stepId: step.id, note });
    } catch (e) {
      c.state = 'error';
      c.error = { stepId: step.id, message: e.message };
      c.updatedAt = new Date().toISOString();
      journal(c.id, 'engine_error', c.error);
      saveCase(c);
      return c;
    }
    c.stepIndex++;
    c.updatedAt = new Date().toISOString();
    saveCase(c);
  }

  c.state = 'done';
  c.prompt = null;
  c.updatedAt = new Date().toISOString();
  journal(c.id, 'case_done', {});
  saveCase(c);
  return c;
}

// A human answered the prompt: validate, apply, journal, continue the engine.
function completePrompt(caseId, input, who) {
  const c = loadCase(caseId);
  if (!c || c.state !== 'waiting_human' || !c.prompt) return { ok: false, error: 'no pending prompt' };
  const steps = registry[c.workflow] || [];
  const step = steps[c.stepIndex];
  if (!step || step.id !== c.prompt.stepId) return { ok: false, error: 'step mismatch' };

  // Validate against the declared schema — the engine only accepts what it asked for.
  const clean = {};
  for (const spec of c.prompt.inputs) {
    const v = input[spec.name];
    if (spec.type === 'choice') {
      if (!spec.options.includes(v)) {
        if (spec.required !== false) return { ok: false, error: 'missing/invalid: ' + spec.name };
        continue;
      }
      clean[spec.name] = v;
    } else { // text | date | number
      const s = (v === undefined || v === null) ? '' : String(v).trim();
      if (!s && spec.required !== false) return { ok: false, error: 'missing: ' + spec.name };
      if (s) clean[spec.name] = s.slice(0, spec.max || 4000);
    }
  }

  journal(c.id, 'prompt_completed', { stepId: step.id, by: (who || 'staff').slice(0, 60), input: clean });
  const breach = clockStatus(c);
  if (breach && breach.breached) journal(c.id, 'sla_breached_at_completion', { lateH: -breach.remainingH });

  try { step.apply(c, clean); } catch (e) {
    journal(c.id, 'apply_error', { stepId: step.id, message: e.message });
    return { ok: false, error: 'apply failed: ' + e.message };
  }
  c.prompt = null;
  c.state = 'running';
  c.stepIndex++;
  saveCase(c);
  advance(c.id);
  return { ok: true, case: loadCase(c.id) };
}

// The work queue = every case waiting on a human, oldest due first.
function workQueue() {
  return listCases()
    .filter(c => c.state === 'waiting_human')
    .map(c => ({ case: c, clock: clockStatus(c) }))
    .sort((a, b) => {
      const ad = (a.clock && a.clock.dueAt) || '9999';
      const bd = (b.clock && b.clock.dueAt) || '9999';
      return ad.localeCompare(bd);
    });
}

module.exports = {
  defineWorkflow, createCase, advance, completePrompt,
  loadCase, saveCase, listCases, journal, readJournal, workQueue, clockStatus
};
