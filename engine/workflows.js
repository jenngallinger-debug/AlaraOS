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
// Intake tiering — the callback clock matches distance to revenue and the
// honesty of the promise, not a blanket hour (owner decision, July 2026):
//   Tier 1 (1 bh):  revenue-near — existing card, hours, switching, referrals,
//                   call-back requests. Speed IS the product here.
//   Tier 2 (4 bh):  new claim — same business day. The job is filing fast and
//                   earning trust, not a sprint.
//   Tier 3 (24 h):  survivor — next business day, warm and unhurried.
// ---------------------------------------------------------------------------
// The tier matcher reads the TEXT with precise patterns — deliberately NOT the
// pre-read flags, which are broad hints for the nurse ("hints, never a
// determination"). Order matters: the published referral/call-back promise
// always wins; bare words like 'passed' or 'hours' never move a clock.
// All hours are BUSINESS hours (core clocks run Mon–Fri 08:00–18:00 PT).
function intakeTier(c) {
  const hay = ((c.fields.text || '') + ' ' + (c.fields.subject || '')).toLowerCase();
  // 1. Published promises outrank every inference.
  if (c.kind === 'referral' || c.kind === 'callback-request') {
    return { tier: 1, hours: 1, label: 'Tier 1 · published promise — 1 business hour' };
  }
  // 2. Revenue-near: an existing card, an hours problem, or a switch in motion.
  if (/\b(have|has|got) (a |my |his |her )?white card\b|already (have|has) (a |the )?card|hours were cut|cut (my|his|her) hours|more hours|not enough hours|switch(ing)? agenc|change agenc|current agency/.test(hay)) {
    return { tier: 1, hours: 1, label: 'Tier 1 · revenue-near — 1 business hour' };
  }
  // 3. Survivor: precise phrasings only ('cancer survivor' and 'passed along' must not match).
  if (/\bwidow(er)?\b|passed away|survivor benefit|\b(he|she|husband|wife|father|mother|dad|mom) (passed|died)\b/.test(hay) ||
      (/\bsurvivor\b/.test(hay) && !/cancer survivor/.test(hay))) {
    return { tier: 3, hours: 10, label: 'Tier 3 · survivor — next business day, warm and unhurried' };
  }
  // 4. Default: a new claim — same business day.
  return { tier: 2, hours: 4, label: 'Tier 2 · new claim — same business day' };
}

// ---------------------------------------------------------------------------
// WORKFLOW: intake
// Dispositions never dead-end: open-lmn-case spawns the LMN case,
// refer-resource-center spawns the CLAIM COMPANION (the two-year pipeline),
// need-more-info sleeps 3 days and re-prompts. Only not-a-fit closes.
// ---------------------------------------------------------------------------
core.defineWorkflow('intake', [
  { id: 'preread', type: 'engine', run(c) {
      c.fields.preread = preRead(c.fields);
      c.fields.tier = intakeTier(c);
      return { summary: c.fields.preread.summary, tier: c.fields.tier.label };
    } },
  { id: 'nurse_disposition', type: 'human', role: 'nurse',
    slaHours(c) { return (c.fields.tier || {}).hours || 4; },
    prompt(c) {
      const p = c.fields.preread || {};
      const t = c.fields.tier || {};
      return {
        title: 'Nurse read + callback (JUD/TRU) — ' + (t.label || 'same business day'),
        brief: [
          'NEW ' + (c.kind || 'submission').toUpperCase() + ' — received ' + c.createdAt,
          'CLOCK: ' + (t.label || ''),
          c.fields.reprompt ? '⚑ RE-PROMPT: previous read needed more info. Notes so far: ' + (c.fields.nurseNotes || '(none)') : '',
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
          'Call them, make the read, pick the route. The engine handles everything after your disposition:',
          '• open-lmn-case → LMN drafted and tracked to authorization',
          '• refer-resource-center → claim companion opens: warm handoff now, check-in in 7 days, milestone check-ins until the card lands (then the LMN case spawns itself)',
          '• need-more-info → engine re-prompts you in 3 days',
          '• not-a-fit → closed'
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
      if (input.notes) c.fields.nurseNotes = ((c.fields.nurseNotes || '') + '\n' + input.notes).trim();
    } },
  { id: 'route', type: 'engine', run(c) {
      if (c.fields.disposition === 'need-more-info') {
        c.fields.reprompt = true;
        c.fields._goto = 'wait_info';
        return { reprompting: 'in 3 days' };
      }
      // Children are created BEFORE the goto is set: if creation throws, the
      // case lands in a visible error state with no half-taken jump on disk.
      if (c.fields.disposition === 'open-lmn-case') {
        const child = core.createCase('lmn', 'lmn', {
          patient: c.fields.patient || '', phone: c.fields.phone || '',
          program: c.fields.program || 'EEOICPA (White Card)',
          sourceCase: c.id, text: c.fields.text || '', nurseNotes: c.fields.nurseNotes || ''
        });
        c.fields.childCase = child.id;
        c.fields._goto = 'close';
        return { opened: child.id };
      }
      if (c.fields.disposition === 'refer-resource-center') {
        const child = core.createCase('claim', 'claim-companion', {
          patient: c.fields.patient || '', phone: c.fields.phone || '',
          program: c.fields.program || '', // carried through to the LMN the day the card lands
          survivor: (c.fields.tier || {}).tier === 3,
          sourceCase: c.id, text: c.fields.text || '', nurseNotes: c.fields.nurseNotes || ''
        });
        c.fields.childCase = child.id;
        c.fields._goto = 'close';
        return { claimCompanion: child.id };
      }
      c.fields._goto = 'close';
      return { closed: c.fields.disposition };
    } },
  // --- need-more-info loop (reached only by goto) ---
  { id: 'wait_info', type: 'wait', days: 3 },
  { id: 'reprompt', type: 'engine', run(c) { c.fields._goto = 'nurse_disposition'; return { reprompt: true }; } },
  { id: 'close', type: 'engine', run(c) { return { done: c.fields.disposition }; } }
]);

// ---------------------------------------------------------------------------
// WORKFLOW: claim — the claim companion.
// The two-year pipeline, kept alive: warm handoff → 7-day filing check-in →
// milestone check-ins every 30 days until the card lands (LMN case spawns
// itself), the claim dies, or the family withdraws. Whoever accompanies the
// claim journey owns the start of care at the end of it.
// ---------------------------------------------------------------------------
core.defineWorkflow('claim', [
  { id: 'init', type: 'engine', run(c) {
      c.fields.claimStage = 'referred-to-resource-center';
      c.fields.checkins = 0;
      return { stage: c.fields.claimStage };
    } },
  { id: 'wait_first', type: 'wait', days: 7 },
  { id: 'first_checkin', type: 'human', role: 'nurse', slaHours: 10, // ~next business day
    prompt(c) {
      return {
        title: 'Claim companion — 7-day filing check-in (TRU)',
        brief: [
          'CLAIM COMPANION for ' + (c.fields.patient || '(name pending)') + (c.fields.survivor ? ' — SURVIVOR case (compensation path; stay warm, never rushed)' : ''),
          'Referred to the Resource Center 7 days ago. One question drives this call: DID THE FILING HAPPEN?',
          '',
          'Their story: ' + (c.fields.text || '(see source case)').slice(0, 600),
          'Nurse notes so far: ' + (c.fields.nurseNotes || '(none)'),
          '',
          'If they haven’t reached the Resource Center yet, help them do it on this call — (702) 697-0841, free, no percentage ever.'
        ].join('\n'),
        inputs: [
          { name: 'status', type: 'choice', options: ['filed', 'not-yet-helped-again', 'unreachable', 'withdrew'] },
          { name: 'notes', type: 'text', required: false, max: 2000 }
        ]
      };
    },
    apply(c, input) {
      if (input.notes) c.fields.nurseNotes = ((c.fields.nurseNotes || '') + '\n[7d] ' + input.notes).trim();
      if (input.status === 'filed') { c.fields.claimStage = 'filed'; c.fields.unreachable = 0; c.fields._goto = 'wait_cycle'; }
      else if (input.status === 'withdrew') { c.fields.claimStage = 'withdrew'; c.fields._goto = 'close'; }
      else if (input.status === 'unreachable') {
        c.fields.unreachable = (c.fields.unreachable || 0) + 1;
        if (c.fields.unreachable >= 3) { c.fields.claimStage = 'lost-contact'; c.fields._goto = 'close'; }
        else { c.fields._goto = 'wait_first'; }
      }
      else { c.fields._goto = 'wait_first'; } // not yet → try again in 7
    } },
  { id: 'wait_cycle', type: 'wait', days: 30 },
  { id: 'milestone_checkin', type: 'human', role: 'coordinator', slaHours: 20, // ~2 business days
    prompt(c) {
      c.fields.checkins = (c.fields.checkins || 0) + 1;
      return {
        title: 'Claim companion — milestone check-in #' + c.fields.checkins + ' (TRU)',
        brief: [
          'CLAIM COMPANION for ' + (c.fields.patient || '(name pending)') + (c.fields.survivor ? ' — SURVIVOR case' : ''),
          'Current stage: ' + (c.fields.claimStage || 'filed') + ' · check-in #' + c.fields.checkins,
          '',
          'The call: how is the claim moving, what letter arrived, what confused them. Explain the stage in plain terms (NIOSH dose reconstruction can take a year — that is normal, not a bad sign). Record the stage.',
          'Notes so far: ' + (c.fields.nurseNotes || '(none)'),
          '',
          'When the card is APPROVED, record it here — the engine opens the LMN case itself and care planning starts the same day.'
        ].join('\n'),
        inputs: [
          { name: 'stage', type: 'choice', options: ['awaiting-DOL', 'NIOSH-dose-reconstruction', 'decision-pending', 'approved-card-issued', 'denied-appealing', 'denied-final', 'unreachable', 'withdrew', 'deceased'] },
          { name: 'notes', type: 'text', required: false, max: 2000 }
        ]
      };
    },
    apply(c, input) {
      if (input.notes) c.fields.nurseNotes = ((c.fields.nurseNotes || '') + '\n[m' + c.fields.checkins + '] ' + input.notes).trim();
      if (input.stage === 'unreachable') {
        c.fields.unreachable = (c.fields.unreachable || 0) + 1;
        if (c.fields.unreachable >= 3) { c.fields.claimStage = 'lost-contact'; c.fields._goto = 'close'; }
        else { c.fields._goto = 'wait_retry'; } // shorter retry, not another 30 days
        return;
      }
      c.fields.claimStage = input.stage;
      c.fields.unreachable = 0;
      if (input.stage === 'approved-card-issued') { c.fields._goto = 'spawn_lmn'; }
      else if (input.stage === 'denied-final' || input.stage === 'withdrew' || input.stage === 'deceased') { c.fields._goto = 'close'; }
      else { c.fields._goto = 'wait_cycle'; } // awaiting / NIOSH / decision / denied-appealing → keep walking with them
    } },
  // Unreachable retry: 7 days, not a full 30-day cycle. Reached only by goto.
  { id: 'wait_retry', type: 'wait', days: 7 },
  { id: 'retry_back', type: 'engine', run(c) { c.fields._goto = 'milestone_checkin'; return { retrying: true }; } },
  { id: 'spawn_lmn', type: 'engine', run(c) {
      const child = core.createCase('lmn', 'lmn', {
        patient: c.fields.patient || '', phone: c.fields.phone || '',
        program: c.fields.program || 'EEOICPA (White Card)', sourceCase: c.id,
        nurseNotes: (c.fields.nurseNotes || '') + '\nCard issued after claim companion (' + (c.fields.checkins || 0) + ' check-ins).'
      });
      c.fields.childCase = child.id;
      c.fields.claimStage = 'card-issued-lmn-opened';
      c.fields._goto = 'close';
      return { lmnOpened: child.id };
    } },
  { id: 'close', type: 'engine', run(c) { return { finalStage: c.fields.claimStage }; } }
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
      if (input.decision === 'rework') c.fields._goto = 'nurse_review'; // re-prompt with the updated draft
    } },
  { id: 'send_physician', type: 'engine', run(c) {
      c.fields.sentToPhysicianAt = new Date().toISOString();
      return { sent: c.fields.physician || 'physician' };
    } },
  { id: 'physician_signature', type: 'human', role: 'coordinator', slaHours: 50, // ~5 business days
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
        c.fields._goto = 'nurse_review'; // back to review with the physician's objection on file
        return;
      }
      c.fields.signedDate = input.signedDate || new Date().toISOString().slice(0, 10);
    } },
  { id: 'submit_authorization', type: 'engine', run(c) {
      c.fields.submittedForAuthAt = new Date().toISOString();
      return { submitted: true };
    } },
  { id: 'record_authorization', type: 'human', role: 'coordinator', slaHours: 100, // ~10 business days
    prompt(c) {
      return {
        title: 'Record the DOL authorization (engine tracks until it lands)',
        brief: 'Signed LMN submitted ' + (c.fields.submittedForAuthAt || '') +
          '. When the authorization arrives, record it exactly — these numbers drive scheduling, billing, and the renewal countdown.',
        inputs: [
          { name: 'authNumber', type: 'text', max: 60 },
          { name: 'startDate', type: 'text', max: 20, hint: 'YYYY-MM-DD' },
          { name: 'endDate', type: 'text', max: 20, hint: 'YYYY-MM-DD — this date drives the automatic renewal' },
          { name: 'hoursPerDay', type: 'text', required: false, max: 10 },
          { name: 'daysPerWeek', type: 'text', required: false, max: 10 }
        ]
      };
    },
    apply(c, input) {
      // The renewal machine hangs off these dates — reject anything unparseable
      // now, while a human is looking, instead of silently losing the countdown.
      for (const [name, v] of [['startDate', input.startDate], ['endDate', input.endDate]]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v))) {
          throw new Error(name + ' must be a real date in YYYY-MM-DD form (got "' + v + '")');
        }
      }
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
      if (isNaN(end)) throw new Error('authEnd unparseable ("' + c.fields.authEnd + '") — renewal countdown cannot be scheduled');
      c.fields.renewalDueAt = new Date(end.getTime() - 45 * 864e5).toISOString();
      c.fields.active = true;
      return { active: true, renewalDueAt: c.fields.renewalDueAt };
    } }
]);

// ---------------------------------------------------------------------------
// The tick — time-based work. Call on console load and/or cron.
// Spawns renewal cases whose countdown has arrived; reports SLA breaches.
// ---------------------------------------------------------------------------
function tick() {
  const now = new Date().toISOString();
  const actions = [];
  // wake sleeping cases whose time has come (claim check-ins, re-prompts)
  for (const c of core.listCases()) {
    if (c.state === 'sleeping' && c.wakeAt && c.wakeAt <= now) {
      const woke = core.wake(c.id);
      actions.push({ woke: c.id, nowAt: woke && woke.state });
    }
  }
  // Renewal idempotency is child-side, not marker-side: a crash between child
  // creation and the parent's marker save must not duplicate the renewal.
  const all = core.listCases();
  const hasRenewal = new Set(all.filter(x => x.fields && x.fields.renewalOf).map(x => x.fields.renewalOf));
  for (const c of all) {
    // spawn renewals
    if (c.workflow === 'lmn' && c.state === 'done' && c.fields.active && c.fields.renewalDueAt &&
        c.fields.renewalDueAt <= now && !c.fields.renewalSpawned && !hasRenewal.has(c.id)) {
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
