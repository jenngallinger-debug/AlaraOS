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
// Every promise on the website is a BUSINESS-hours promise, so the clocks are
// business-hour clocks: Mon–Fri, 08:00–18:00 America/Los_Angeles (the site's
// own "after 6 PM, first thing the next business day"). A Friday-evening
// submission is due Monday morning, not breached by Saturday.
// ---------------------------------------------------------------------------
const BIZ = { tz: 'America/Los_Angeles', open: 8, close: 18 };
const bizFmt = new Intl.DateTimeFormat('en-US', { timeZone: BIZ.tz, hour12: false, weekday: 'short', hour: 'numeric' });

function bizParts(d) {
  const parts = {};
  for (const p of bizFmt.formatToParts(d)) parts[p.type] = p.value;
  const hour = parseInt(parts.hour, 10) % 24; // '24' at midnight in some ICU versions
  return { weekday: parts.weekday, hour };
}

function inBizWindow(d) {
  const { weekday, hour } = bizParts(d);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return hour >= BIZ.open && hour < BIZ.close;
}

// Advance `bizHours` of business time from `from`, stepping in 15-minute
// increments (bounded: even a 100-business-hour clock is < 2000 steps).
function addBusinessHours(from, bizHours) {
  const STEP = 15 * 60 * 1000;
  let t = new Date(from).getTime();
  let remaining = bizHours * 4; // 15-min units
  let guard = 0;
  while (remaining > 0 && ++guard < 20000) {
    t += STEP;
    if (inBizWindow(new Date(t))) remaining--;
  }
  return new Date(t).toISOString();
}

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

// Workflows can jump: a step's run()/apply() sets c.fields._goto = '<stepId>'
// and the runner moves there instead of to the next step. This is how loops
// work (re-prompt, check-in cadences) — always explicit, always journaled.
function resolveGoto(c, steps) {
  if (!c.fields._goto) return false;
  const target = steps.findIndex(s => s.id === c.fields._goto);
  if (target === -1) throw new Error('goto to unknown step: ' + c.fields._goto);
  journal(c.id, 'goto', { from: steps[c.stepIndex] && steps[c.stepIndex].id, to: c.fields._goto });
  c.stepIndex = target;
  delete c.fields._goto;
  return true;
}

// Run engine steps until: a human step (create prompt, stop), a wait step
// (sleep until wakeAt, tick() wakes it), the end (done), or an engine error.
function advance(caseId) {
  const c = loadCase(caseId);
  if (!c || c.state === 'done' || c.state === 'error') return c;
  const steps = registry[c.workflow] || [];
  let guard = 0; // a goto cycle with no human/wait step is a bug, not a feature

  while (c.stepIndex < steps.length) {
    if (++guard > 100) {
      c.state = 'error';
      c.error = { stepId: steps[c.stepIndex] && steps[c.stepIndex].id, message: 'goto cycle without a human/wait step' };
      journal(c.id, 'engine_error', c.error);
      saveCase(c);
      return c;
    }
    const step = steps[c.stepIndex];

    if (step.type === 'human') {
      const p = step.prompt(c);
      const sla = typeof step.slaHours === 'function' ? step.slaHours(c) : step.slaHours;
      c.prompt = {
        stepId: step.id,
        role: step.role,
        title: p.title,
        brief: p.brief,             // everything the engine prepared — no blank pages
        inputs: p.inputs,           // the exact schema the engine needs back
        createdAt: new Date().toISOString(),
        // Business-hours clock: the published promises are business promises.
        dueAt: sla ? addBusinessHours(new Date(), sla) : null
      };
      c.state = 'waiting_human';
      c.updatedAt = new Date().toISOString();
      journal(c.id, 'prompt_created', { stepId: step.id, role: step.role, title: p.title, dueAt: c.prompt.dueAt });
      saveCase(c);
      return c;
    }

    if (step.type === 'wait') {
      const days = typeof step.days === 'function' ? step.days(c) : step.days;
      c.state = 'sleeping';
      c.wakeAt = new Date(Date.now() + days * 864e5).toISOString();
      c.sleepStepId = step.id; // identity check at wake — deploys may reorder steps
      c.updatedAt = new Date().toISOString();
      journal(c.id, 'sleeping', { stepId: step.id, days, wakeAt: c.wakeAt });
      saveCase(c);
      return c;
    }

    // engine step — the goto resolution lives INSIDE the try: a bad jump is an
    // engine error the console can see, never a stranded 'running' case.
    try {
      const note = step.run(c) || {};
      journal(c.id, 'engine_step', { stepId: step.id, note });
      if (!resolveGoto(c, steps)) c.stepIndex++;
    } catch (e) {
      c.state = 'error';
      c.error = { stepId: step.id, message: e.message };
      c.updatedAt = new Date().toISOString();
      journal(c.id, 'engine_error', c.error);
      saveCase(c);
      return c;
    }
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

// Wake a sleeping case whose time has come (called by tick()).
// Identity-checked: the persisted stepIndex must still point at the wait step
// the case fell asleep on. If a deploy reordered the workflow, re-locate the
// step by id; if it no longer exists, surface an error — never misroute.
function wake(caseId) {
  const c = loadCase(caseId);
  if (!c || c.state !== 'sleeping') return c;
  if (c.wakeAt && c.wakeAt > new Date().toISOString()) return c;
  const steps = registry[c.workflow] || [];
  const at = steps[c.stepIndex];
  if (c.sleepStepId && (!at || at.id !== c.sleepStepId)) {
    const relocated = steps.findIndex(s => s.id === c.sleepStepId);
    if (relocated === -1) {
      c.state = 'error';
      c.error = { stepId: c.sleepStepId, message: 'wait step no longer exists in workflow definition' };
      journal(c.id, 'engine_error', c.error);
      saveCase(c);
      return c;
    }
    journal(c.id, 'wake_relocated', { from: c.stepIndex, to: relocated, stepId: c.sleepStepId });
    c.stepIndex = relocated;
  }
  journal(c.id, 'woke', { stepId: c.sleepStepId || (at && at.id) });
  delete c.wakeAt;
  delete c.sleepStepId;
  c.state = 'running';
  c.stepIndex++;
  saveCase(c);
  return advance(c.id);
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
  try {
    if (!resolveGoto(c, steps)) c.stepIndex++;
  } catch (e) {
    c.state = 'error';
    c.error = { stepId: step.id, message: e.message };
    journal(c.id, 'engine_error', c.error);
    saveCase(c);
    return { ok: false, error: e.message };
  }
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
  defineWorkflow, createCase, advance, completePrompt, wake,
  loadCase, saveCase, listCases, journal, readJournal, workQueue, clockStatus,
  addBusinessHours, inBizWindow
};
