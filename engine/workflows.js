'use strict';
// =============================================================================
// AlaraOS Engine V1 — the workflows.
//
// Three workflows, straight from the Human Boundary doc:
//   intake   (A2–A5, B1/B3): website submission → engine pre-read → NURSE
//            disposition prompt → routes (open an LMN case, hand off, close).
//   lmn      (C1, C2, C5–C7): engine drafts → NURSE approves → PHYSICIAN
//            signature recorded → AUTHORIZATION recorded → active + renewal
//            countdown scheduled.
//   renewal  (D4/D5): spawned automatically at T-45 days before authorization
//            expiry; same review→signature→authorization chain, pre-filled.
//
// Every human step names its role and carries the reason from the boundary
// doc (JUD / TRU / LIC) in its title, so the console teaches the model.
// =============================================================================
const core = require('./core');

// ---------------------------------------------------------------------------
// The pre-reader (A3/B1 engine half): match intake facts against the covered-
// facility knowledge the site already teaches. Hints for the nurse — never a
// determination. Verify before relying on any SEC note.
// ---------------------------------------------------------------------------
const FACILITIES = [
  { name: 'Nevada Test Site / NNSS', aliases: ['nevada test site', 'nts', 'nnss', 'mercury', 'yucca flat', 'jackass flats', 'area 51', 'test site'],
    note: 'DOE facility. SEC class covers defined NTS worker cohorts (250+ workday rules apply) — verify class specifics.' },
  { name: 'Tonopah Test Range', aliases: ['tonopah'], note: 'DOE-linked range, Nye County. Coverage period rules apply.' },
  { name: 'Central Nevada Test Area', aliases: ['central nevada test area', 'cnta', 'faultless'], note: 'Nye County DOE site (Project Faultless).' },
  { name: 'Yucca Mountain', aliases: ['yucca mountain'], note: 'DOE site; worker coverage depends on role/period.' }
];
const EMPLOYERS = ['reeco', 'eg&g', 'egg', 'bechtel', 'wackenhut', 'raytheon', 'holmes & narver', 'sandia', 'lawrence livermore'];

function preRead(fields) {
  const hay = ((fields.text || '') + ' ' + (fields.subject || '')).toLowerCase();
  const hits = { facilities: [], employers: [], phones: [], flags: [] };
  for (const f of FACILITIES) if (f.aliases.some(a => hay.includes(a))) hits.facilities.push({ name: f.name, note: f.note });
  for (const e of EMPLOYERS) if (hay.includes(e)) hits.employers.push(e);
  const phone = hay.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/);
  if (phone) hits.phones.push(phone[0]);
  if (hay.includes('survivor') || hay.includes('passed') || hay.includes('widow')) hits.flags.push('possible SURVIVOR case — compensation path, not home health');
  if (hay.includes('approved') || hay.includes('has a white card') || hay.includes('have a white card')) hits.flags.push('possible EXISTING card holder — delivery path, not eligibility');
  if (hay.includes('hours')) hits.flags.push('mentions HOURS — possible authorization/renewal review');
  if (hay.includes('switch')) hits.flags.push('mentions SWITCHING agencies — no-gap transition applies');
  hits.summary = hits.facilities.length
    ? 'Facility match: ' + hits.facilities.map(f => f.name).join(', ') + '. Preliminary read: worth pursuing.'
    : 'No covered-facility match found in the text — nurse read required.';
  return hits;
}

// ---------------------------------------------------------------------------
// The LMN drafter (C1 engine half). V1 drafts from intake facts + the
// structured clinical facts the nurse supplies at review. (V2: drafted from
// AlaraOS visit data — the website's full promise.)
// ---------------------------------------------------------------------------
function draftLMN(f) {
  const L = [];
  L.push('LETTER OF MEDICAL NECESSITY — DRAFT (' + (f.renewalOf ? 'RENEWAL' : 'INITIAL') + ')');
  L.push('Program: ' + (f.program || 'EEOICPA (White Card)'));
  L.push('Patient: ' + (f.patient || '[PATIENT NAME]'));
  L.push('');
  L.push('Accepted condition(s): ' + (f.conditions || '[FROM CLAIM — nurse to confirm]'));
  L.push('Care requested: ' + (f.careType || '[skilled nursing / home health aide / therapy]'));
  L.push('Hours: ' + (f.hoursPerDay || '[N]') + ' hours/day, ' + (f.daysPerWeek || '[N]') + ' days/week');
  L.push('');
  L.push('Clinical basis (engine-assembled; nurse reviews, physician certifies):');
  L.push(f.clinicalBasis || '[Documented needs: assessments, wound measurements, ADL/mobility findings, medication management demands — entered at nurse review in V1; drawn from the care record in V2.]');
  if (f.renewalOf) {
    L.push('');
    L.push('Renewal context: continues authorization ' + (f.priorAuthNumber || '[PRIOR AUTH#]') + ' (' + (f.priorHours || 'prior hours') + '). Changes in need since last period: ' + (f.needChanges || '[none documented / describe]'));
  }
  L.push('');
  L.push('Certifying physician (MD/DO): ' + (f.physician || '[TREATING PHYSICIAN]'));
  L.push('This draft supports Forms EE-17A/EE-17B. The treating physician certifies; the Department of Labor authorizes.');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// WORKFLOW: intake
// ---------------------------------------------------------------------------
core.defineWorkflow('intake', [
  { id: 'preread', type: 'engine', run(c) {
      c.fields.preread = preRead(c.fields);
      return { summary: c.fields.preread.summary };
    } },
  { id: 'nurse_disposition', type: 'human', role: 'nurse', slaHours: 1,
    prompt(c) {
      const p = c.fields.preread || {};
      return {
        title: 'Nurse read + callback (JUD/TRU) — respond within 1 business hour',
        brief: [
          'NEW ' + (c.kind || 'submission').toUpperCase() + ' — received ' + c.createdAt,
          '',
          '— WHAT THEY SENT —',
          (c.fields.subject || ''), '', (c.fields.text || '(no text)'),
          '',
          '— ENGINE PRE-READ —',
          p.summary || '',
          (p.facilities || []).map(f => '• ' + f.name + ': ' + f.note).join('\n'),
          (p.employers || []).length ? '• Employer signals: ' + p.employers.join(', ') : '',
          (p.flags || []).map(f => '⚑ ' + f).join('\n'),
          '',
          'Call them, make the read, pick the route. The engine handles everything after your disposition.'
        ].filter(s => s !== '').join('\n'),
        inputs: [
          { name: 'disposition', type: 'choice', options: ['open-lmn-case', 'refer-resource-center', 'not-a-fit', 'need-more-info'] },
          { name: 'patient', type: 'text', required: false, max: 120 },
          { name: 'phone', type: 'text', required: false, max: 40 },
          { name: 'notes', type: 'text', required: false, max: 2000 }
        ]
      };
    },
    apply(c, input) {
      c.fields.disposition = input.disposition;
      if (input.patient) c.fields.patient = input.patient;
      if (input.phone) c.fields.phone = input.phone;
      if (input.notes) c.fields.nurseNotes = input.notes;
    } },
  { id: 'route', type: 'engine', run(c) {
      if (c.fields.disposition === 'open-lmn-case') {
        const child = core.createCase('lmn', 'lmn', {
          patient: c.fields.patient || '', phone: c.fields.phone || '',
          program: c.fields.program || 'EEOICPA (White Card)',
          sourceCase: c.id, text: c.fields.text || '', nurseNotes: c.fields.nurseNotes || ''
        });
        c.fields.childCase = child.id;
        return { opened: child.id };
      }
      if (c.fields.disposition === 'need-more-info') {
        // loop back: re-prompt the nurse after more info arrives (V1: manual re-open)
        return { parked: true };
      }
      return { closed: c.fields.disposition };
    } }
]);

// ---------------------------------------------------------------------------
// WORKFLOW: lmn  (also used by renewals via fields.renewalOf)
// ---------------------------------------------------------------------------
core.defineWorkflow('lmn', [
  { id: 'draft', type: 'engine', run(c) {
      c.fields.lmnDraft = draftLMN(c.fields);
      return { drafted: true };
    } },
  { id: 'nurse_review', type: 'human', role: 'nurse',
    prompt(c) {
      return {
        title: 'Review the LMN draft (JUD) — fill the clinical facts, approve or rework',
        brief: (c.fields.declineReason ? '⚑ PHYSICIAN DECLINED LAST ROUND: ' + c.fields.declineReason + '\n\n' : '') +
          'ENGINE DRAFT:\n\n' + c.fields.lmnDraft +
          '\n\nFill in what the draft is missing. On approve, the engine routes it to the physician and tracks the signature.',
        inputs: [
          { name: 'decision', type: 'choice', options: ['approve', 'rework'] },
          { name: 'conditions', type: 'text', required: false, max: 500 },
          { name: 'careType', type: 'text', required: false, max: 200 },
          { name: 'hoursPerDay', type: 'text', required: false, max: 10 },
          { name: 'daysPerWeek', type: 'text', required: false, max: 10 },
          { name: 'clinicalBasis', type: 'text', required: false, max: 4000 },
          { name: 'physician', type: 'text', required: false, max: 120 }
        ]
      };
    },
    apply(c, input) {
      for (const k of ['conditions', 'careType', 'hoursPerDay', 'daysPerWeek', 'clinicalBasis', 'physician']) {
        if (input[k]) c.fields[k] = input[k];
      }
      c.fields.lmnDraft = draftLMN(c.fields); // re-draft with the nurse's facts
      if (input.decision === 'rework') { c.stepIndex--; } // re-prompt with the updated draft
    } },
  { id: 'send_physician', type: 'engine', run(c) {
      c.fields.sentToPhysicianAt = new Date().toISOString();
      return { sent: c.fields.physician || 'physician' };
    } },
  { id: 'physician_signature', type: 'human', role: 'coordinator', slaHours: 120,
    prompt(c) {
      return {
        title: 'Record the physician signature (LIC gate) — nudge until signed',
        brief: 'Sent to ' + (c.fields.physician || '[physician]') + ' on ' + (c.fields.sentToPhysicianAt || '') +
          '.\n\nFinal LMN:\n\n' + c.fields.lmnDraft +
          '\n\nWhen the signed order is back, record the date. If declined, record why — the engine loops it to nurse review.',
        inputs: [
          { name: 'outcome', type: 'choice', options: ['signed', 'declined'] },
          { name: 'signedDate', type: 'text', required: false, max: 20 },
          { name: 'declineReason', type: 'text', required: false, max: 1000 }
        ]
      };
    },
    apply(c, input) {
      if (input.outcome === 'declined') {
        c.fields.declineReason = input.declineReason || '';
        c.stepIndex -= 3; // back to nurse_review with the physician's objection on file
        return;
      }
      c.fields.signedDate = input.signedDate || new Date().toISOString().slice(0, 10);
    } },
  { id: 'submit_authorization', type: 'engine', run(c) {
      c.fields.submittedForAuthAt = new Date().toISOString();
      return { submitted: true };
    } },
  { id: 'record_authorization', type: 'human', role: 'coordinator', slaHours: 240,
    prompt(c) {
      return {
        title: 'Record the DOL authorization (engine tracks until it lands)',
        brief: 'Signed LMN submitted ' + (c.fields.submittedForAuthAt || '') +
          '. When the authorization arrives, record it exactly — these numbers drive scheduling, billing, and the renewal countdown.',
        inputs: [
          { name: 'authNumber', type: 'text', max: 60 },
          { name: 'startDate', type: 'text', max: 20 },
          { name: 'endDate', type: 'text', max: 20 },
          { name: 'hoursPerDay', type: 'text', required: false, max: 10 },
          { name: 'daysPerWeek', type: 'text', required: false, max: 10 }
        ]
      };
    },
    apply(c, input) {
      c.fields.authNumber = input.authNumber;
      c.fields.authStart = input.startDate;
      c.fields.authEnd = input.endDate;
      if (input.hoursPerDay) c.fields.hoursPerDay = input.hoursPerDay;
      if (input.daysPerWeek) c.fields.daysPerWeek = input.daysPerWeek;
    } },
  { id: 'activate', type: 'engine', run(c) {
      // The renewal countdown: T-45 days before expiry the engine spawns the
      // renewal case by itself. Care never stops over paperwork.
      const end = new Date(c.fields.authEnd);
      if (!isNaN(end)) {
        c.fields.renewalDueAt = new Date(end.getTime() - 45 * 864e5).toISOString();
      }
      c.fields.active = true;
      return { active: true, renewalDueAt: c.fields.renewalDueAt || 'unparsed end date — set manually' };
    } }
]);

// ---------------------------------------------------------------------------
// The tick — time-based work. Call on console load and/or cron.
// Spawns renewal cases whose countdown has arrived; reports SLA breaches.
// ---------------------------------------------------------------------------
function tick() {
  const now = new Date().toISOString();
  const actions = [];
  for (const c of core.listCases()) {
    // spawn renewals
    if (c.workflow === 'lmn' && c.state === 'done' && c.fields.active && c.fields.renewalDueAt &&
        c.fields.renewalDueAt <= now && !c.fields.renewalSpawned) {
      const r = core.createCase('lmn', 'renewal', {
        patient: c.fields.patient, phone: c.fields.phone, program: c.fields.program,
        conditions: c.fields.conditions, careType: c.fields.careType,
        hoursPerDay: c.fields.hoursPerDay, daysPerWeek: c.fields.daysPerWeek,
        physician: c.fields.physician, clinicalBasis: c.fields.clinicalBasis,
        renewalOf: c.id, priorAuthNumber: c.fields.authNumber,
        priorHours: (c.fields.hoursPerDay || '?') + 'h/day × ' + (c.fields.daysPerWeek || '?') + 'd/wk'
      });
      c.fields.renewalSpawned = r.id;
      core.saveCase(c);
      core.journal(c.id, 'renewal_spawned', { renewalCase: r.id });
      actions.push({ renewalSpawned: r.id, from: c.id });
    }
    // report breaches
    const clock = core.clockStatus(c);
    if (clock && clock.breached) actions.push({ slaBreach: c.id, lateH: -clock.remainingH, step: c.prompt && c.prompt.stepId });
  }
  return actions;
}

module.exports = { tick, preRead, draftLMN };
