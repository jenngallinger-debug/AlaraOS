# Alara Clinical Assessment (EMR V1) — Template Specification for Automynd
**July 2026 · V1 draft — pending owner + Automynd review, and standards validation
sign-off before locking (see Appendix C).**

This is the assessment template Alara provides to Automynd. It drives the home
visit and the documentation: the fields below are both the clinician's visit
structure and the structured clinical facts the EMR uses to generate the draft
Plan of Care and the draft Letter of Medical Necessity (hours grid), and that
AlaraOS later consumes as signals.

**Doctrine (AES-000 / ADR-001):** AI prepares. Humans decide. Always.
Automynd documents care and recommends; AlaraOS coordinates and carries.
The assessment is the clinical source of truth — it lives in the EMR. AlaraOS
never stores clinical content; it receives events, flags, dates, and pointers
(AES-004 / AES-020).

---

## Guiding principles (owner-set)

Every field must satisfy at least one of these, or it comes out:

1. It is **clinically necessary** to safely care for the patient.
2. It is **required** for documentation, compliance, reimbursement, or
   accreditation.
3. It identifies **risk or change** that could alter the plan of care.
4. It creates **structured clinical facts that AlaraOS can later consume**.

Design consequence: modular, not one giant form. Sections appear or expand
based on patient and visit type. No nurse pages through hundreds of empty
fields on a routine visit.

---

## Field tags used throughout

| Tag | Meaning |
|---|---|
| `[CoP]` | Required or directly supports 42 CFR 484.55 comprehensive-assessment content (see Appendix C) |
| `[OASIS]` | Aligns with an OASIS-E item — collect once, populate both (Medicare/Medicaid episodes only) |
| `[LMN]` | Feeds the draft Letter of Medical Necessity — functional evidence, care types, or the hours-per-day / days-per-week grid |
| `[OS→]` | Emits a structured, non-PHI signal/event to AlaraOS via the AES-020 connector (event name noted) |
| `[RN]` | Nursing judgment field — the system may prompt, it never pre-fills. The clinician authors it. |

---

## Visit-type module matrix

One clinical framework across all visit types. ✅ full module ·
◐ conditional/expand-on-change · — omitted.

| Module | SOC | ROC | Recert | Routine | PRN | Discharge |
|---|---|---|---|---|---|---|
| I. Visit Context | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| II. Patient Profile | ✅ | ◐ confirm/Δ | ◐ confirm/Δ | ◐ Δ only | ◐ Δ only | ◐ confirm |
| III. Program & Benefits Context | ✅ | ◐ confirm/Δ | ✅ | ◐ Δ only | — | ◐ status |
| IV. Care Team | ✅ | ◐ Δ only | ◐ confirm/Δ | ◐ Δ only | ◐ if involved | ✅ handoff |
| V. History Since Baseline | — (baseline) | ✅ | ✅ | ✅ **entry point** | ✅ focused | ✅ |
| VI. Comprehensive Clinical Assessment | ✅ all systems | ✅ all systems | ✅ all systems | ◐ affected systems + required reassessments | ◐ triggering problem + related systems | ✅ |
| VII. Functional Assessment | ✅ | ✅ | ✅ | ◐ changed domains | ◐ if implicated | ✅ |
| VIII. Home Environment & Safety | ✅ | ✅ | ◐ reconfirm | ◐ Δ only | ◐ if implicated | ◐ |
| IX. SDOH | ✅ full screen | ◐ re-screen changed | ✅ full re-screen | ◐ Δ only | — | ◐ open needs |
| X. Clinical Risk Assessment | ✅ all screens | ✅ all screens | ✅ all screens | ◐ triggered + due reassessments | ◐ triggered | ◐ |
| XI. Care Needs & Hours Evidence | ✅ | ✅ | ✅ | ◐ if change indicates | ◐ if change indicates | ✅ closing picture |
| XII. Patient Education | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ final teaching |
| XIII. Clinical Impression | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| XIV. Recommendations | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| XV. Communication Performed | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| XVI. Verification Before Sign-Off | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

- **SOC:** complete assessment, every module. `[CoP: initial assessment visit
  within 48 hours of referral or on physician-ordered SOC date; comprehensive
  assessment completed within 5 days of SOC]`
- **ROC (resumption of care):** full reassessment within 48 hours of return
  home from inpatient stay, anchored on "what changed during the stay."
- **Recertification:** comprehensive reassessment emphasizing progress toward
  goals, ongoing needs, and continued eligibility — no later than day 60.
  For White Card patients this pairs with the LMN renewal cycle (Module III).
- **Routine:** opens on Module V ("What changed since the last visit?").
  Changes expand the affected modules; scheduled/overdue reassessments
  (e.g., quarterly risk screens) surface regardless of reported change.
- **PRN:** focused assessment of the triggering problem plus related systems.
- **Discharge:** outcomes, goal status, handoff, open-needs closure.

---

## Module I — Visit Context

*Purpose: establish why this encounter exists.*

- Visit type (SOC, ROC, Recertification, Routine, PRN, Discharge) `[OS→ visit.completed carries type]`
- Date/time; time in / time out (EVV-compatible) `[CoP]`
- Clinician (name, credential, license #)
- Referral source + referring provider `[CoP]`
- Primary diagnosis; secondary diagnoses (coded, ICD-10) `[CoP] [OASIS]`
- Reason for referral
- Recent hospitalization / ER visit since last contact (facility, dates, reason) `[OASIS] [OS→ signal.hospitalization]`
- Payer context for this episode (drives conditional fields): EEOICPA/White
  Card · RECA · OWCP/FECA · VA · Medicare · Medicaid · other
- Homebound status assessment — **only when the payer requires it**
  (Medicare); EEOICPA does not require homebound status and the form must not
  imply it does `[CoP for Medicare episodes]`
- Patient's primary concern, in their words `[RN prompt]`
- Caregiver's primary concern
- Referring provider's concern
- Goals for today's visit

## Module II — Patient Profile

*Purpose: confirm baseline identity and context.*

- Preferred name; pronouns if offered
- Preferred language; interpreter needed `[CoP] [OASIS]`
- Advance directives (type, location of document, copy on file?) `[CoP]`
- Code status
- Decision-making capacity `[RN]`
- POA / authorized representative (name, scope, contact) `[CoP]`
- Emergency contact
- Living arrangement (alone / with spouse / with family / facility) `[OASIS]`
- Caregiver availability: who, relationship, schedule of availability,
  willingness and ability to assist `[CoP] [LMN — the coverage side of the hours case]`
- Patient goals, preferences, and what "good" looks like to them `[CoP] [RN]`
- Veteran status / other benefit-relevant history (see Module III)

## Module III — Program & Benefits Context *(Alara-specific)*

*Purpose: the assessment must know which conditions pay for care, because the
LMN can only claim hours against them. This module is the bridge between the
clinical picture and the benefits case.*

- Program(s) active: EEOICPA Part B / Part E · RECA · OWCP/FECA · VA ·
  Medicare · Medicaid · private `[OS→ benefits.status]`
- White Card / claim number status (active, pending, denied-appealing) `[OS→]`
- **Accepted conditions on the card** — the list, verbatim from DOL
  documentation `[LMN — every hours claim maps to one of these]`
- Current authorization: hours/day, days/week, care types, start and **end
  date** `[OS→ authorization.window — drives the AlaraOS renewal countdown]`
- **Consequential-condition screening** `[LMN] [RN]`: conditions plausibly
  caused or aggravated by an accepted condition or its treatment, not yet on
  the card (e.g., neuropathy after chemotherapy for an accepted cancer;
  depression secondary to accepted illness). For each candidate: the accepted
  condition it stems from, clinical basis, supporting findings, and whether a
  physician workup is indicated. `[OS→ benefits.consequential-candidate — a
  flag and pointer, no clinical narrative]`
- Employment/exposure history relevant to program eligibility (site, years,
  role) — SOC only, confirm thereafter
- Other benefits the picture suggests but the patient doesn't have
  (screening prompt, not adjudication) `[OS→ benefits.gap-candidate]`

## Module IV — Care Team

- PCP; specialists (per specialty, with role in this patient's care)
- Home health physician (signs the POC and LMN) `[LMN]`
- DOL/program case or claims examiner contact, if known *(Alara-specific)*
- Case manager (external, if any)
- Pharmacy; DME provider
- Other agencies involved; community resources already involved
- Gaps: needed team members not yet in place `[OS→ careteam.gap]`

## Module V — History Since Baseline

*Purpose: capture clinically meaningful change. On Routine visits this module
is the front door: "What changed since the last visit?"*

Domains: falls · hospitalizations/ER · medication changes · weight/appetite ·
pain · skin · respiratory symptoms · cardiac symptoms · neurological changes ·
functional decline · mood/behavior · sleep · caregiver changes or concerns ·
home environment changes.

Each reported change records:

- Status (new · worse · improved · stable-but-notable)
- Onset/date
- Reporter (patient, caregiver, clinician, other)
- Clinical significance `[RN]`
- Modules it expands (system does the expansion; clinician can add)

`[OS→ signal.change — domain, status, severity; this is the AES-004 clinical
signal that puts change in front of the nurse while it is still small]`

A change in condition that meets the regulatory threshold (major decline or
improvement) triggers a full reassessment `[CoP 484.55(d)]`.

## Module VI — Comprehensive Clinical Assessment

*Organized by body system. Each domain captures: findings · pertinent
negatives where appropriate · change from baseline · clinical concern `[RN]`.*

- General appearance
- Vital signs (with patient-specific alert parameters from the POC)
- Neurological (incl. cognition screen — see Module X for instruments)
- Cardiovascular (incl. edema, telehealth/weight trends if monitored)
- Respiratory (incl. O2 use, dyspnea scale) `[OASIS]`
- Gastrointestinal (incl. bowel pattern, nutrition intake)
- Genitourinary (incl. continence — cross-filled from Module VII)
- Endocrine/metabolic (as relevant — e.g., diabetic foot exam cadence)
- Musculoskeletal (strength, ROM, assistive devices)
- Skin/wounds (full skin inspection; wound measurements, staging, photos per
  policy) `[OASIS]`
- Pain (scale, location, character, what it prevents the patient from doing —
  the functional phrasing feeds the LMN) `[LMN]`
- Mental health / behavior (affect, mood; PHQ-2 gateway — Module X)
- **Medication assessment** `[CoP 484.55(c) drug regimen review]`:
  full reconciliation; potential adverse effects, drug reactions,
  ineffective therapy, significant interactions, duplicate therapy,
  noncompliance; who administers; high-risk meds flagged
  `[OS→ signal.med-issue on clinically significant findings]` `[OASIS]`

## Module VII — Functional Assessment

*For each item: current assistance level (independent · setup ·
supervision/cueing · partial assist · substantial assist · dependent) ·
change from baseline · safety implications. Assistance levels use the same
scale as OASIS-E Section GG so one observation populates both.* `[OASIS]`

**ADLs** `[LMN — primary hours evidence]`: bathing · dressing · grooming ·
toileting · feeding · transfers · ambulation/locomotion.

**IADLs** `[LMN]`: medication management · meal preparation · shopping ·
housekeeping · laundry · transportation · telephone/communication device use ·
financial management (when relevant).

**Additional:** continence (bladder/bowel) `[OASIS]` · vision · hearing ·
communication/speech · ability to summon help in an emergency (device, phone
reach, cognition to use it).

**For every item scored below independent** `[LMN]`:
- What specifically the patient cannot do (task-level, observable)
- Which accepted or documented condition drives the deficit (link to
  Module III list where applicable)
- Frequency the need occurs (times/day, days/week)
- Who provides the help today, and what is **not** covered (the gap)

This block is the evidence chain for the draft LMN's hours grid: deficit →
condition → frequency → uncovered need → recommended hours.

## Module VIII — Home Environment & Safety *(physical environment)*

- Home layout/barriers (stairs, bathroom access, bed location)
- Fall hazards (rugs, lighting, clutter, cords, pets underfoot)
- Utilities and basic needs functioning (heat/AC, water, electricity,
  refrigeration for meds) `[OS→ sdoh.need if failing — see Module IX]`
- Food in the home adequate for the diet ordered (gateway to Module IX
  food-security screen)
- Medication access and storage (can they obtain refills; safe storage)
- Equipment availability and condition (DME present, working, appropriate) `[LMN — equipment alternative/adjunct to hours]`
- Oxygen safety, smoking in home, other environmental risk
- Firearms/weapons storage (safety-relevant only, non-judgmental)
- Emergency preparedness: evacuation ability, backup power for
  life-sustaining equipment, emergency plan on file `[CoP emergency
  preparedness alignment]`
- Caregiver reliability as observed in the home `[RN]`

## Module IX — Social Drivers of Health (SDOH) *(dedicated module)*

*Purpose: unmet social needs change outcomes, hours needed, and program
eligibility. Structured screening → the EMR's social-program referral engine
and AlaraOS's benefits intelligence both key off these facts. Screen at SOC
and every recertification; re-screen a domain whenever Module V reports a
change touching it. Use validated micro-screens so results are comparable
across visits.*

| Domain | Screen (V1 instrument) | Structured result |
|---|---|---|
| Food security | Hunger Vital Sign (2-item) | secure · at risk · food insecure |
| Housing stability | Housing worry + condition items (AHC-style) | stable · at risk · unstable/unsafe |
| Utilities | Shut-off threat past 12 mo | none · threatened · shut off |
| Transportation | Missed care/meds/errands for lack of transport | adequate · limited · barrier to care |
| Financial strain | "How hard is it to pay for basics?" | none · somewhat · very hard |
| Social isolation | UCLA-3 loneliness (or PROMIS single item) | not isolated · at risk · isolated |
| Caregiver presence | From Module II — coverage map | adequate · partial · none |
| Health literacy | Single-item confidence with medical forms | adequate · limited |
| Digital access | Phone/internet/video capability + comfort | full · limited · none |
| Language/culture | Interpreter need met; cultural factors affecting care | met · unmet |
| Personal safety / abuse / neglect / exploitation | Private, direct screen (see Module X for the clinical abuse screen) | no concern · concern |

Each positive screen records: severity · patient priority ("do you want help
with this?") · action taken (education, referral generated in EMR, provider
notified) `[OS→ sdoh.need — domain + severity + referral-status only; no
narrative]`.

Notes:
- Patient may decline any screen; document declination — never force.
- SDOH needs are also **benefits signals**: transportation and
  home-modification needs may be coverable under the patient's program;
  the `sdoh.need` event lets AlaraOS raise that with the Care Guide.
- Never blocks care: a positive screen creates a referral and a signal, not
  a gate.

## Module X — Clinical Risk Assessment

*Structured screening. Each positive finding records: supporting evidence ·
severity · immediate concern (yes/no) `[OS→ risk.flagged — risk type +
severity + immediate flag]`. V1 instruments named so scores are comparable
across clinicians and visits; Automynd may substitute equivalent validated
tools with owner approval.*

| Risk | V1 instrument / method | Cadence |
|---|---|---|
| Falls | MAHC-10 (home-care validated) | SOC, ROC, recert, post-fall |
| Pressure injury | Braden Scale | SOC, ROC, recert, on skin change |
| Medication risk | Drug regimen review (Module VI) + high-risk med list | Every visit touch |
| Infection | Signs/symptoms screen + device inventory (catheter, port, wound) | Every visit |
| Hospitalization risk | Composite flag (prior admits, polypharmacy, condition instability) `[OASIS]` | SOC, recert |
| Nutrition/hydration | MNA-SF (or MST) + weight trend | SOC, recert, on weight/appetite change |
| Respiratory compromise | Dyspnea scale + O2 dependence | Per clinical picture |
| Cardiac instability | Symptom screen + vitals trend vs. parameters | Per clinical picture |
| Cognitive impairment | BIMS (or Mini-Cog) | SOC, recert, on observed change |
| Delirium | CAM (screen when acute change observed) | Triggered |
| Depression | PHQ-2 → PHQ-9 if positive `[OASIS]` | SOC, recert, on mood change |
| Anxiety | GAD-2 → GAD-7 if positive | Triggered |
| Suicide risk | Direct-ask pathway when PHQ item 9 positive; safety plan + immediate escalation | Triggered |
| Abuse / neglect / exploitation | Private observation + direct screen; **mandatory-reporting obligations per Nevada law noted in-form** | SOC, recert, on suspicion |
| Caregiver strain | Modified Caregiver Strain Index (CSI) | SOC, recert, on caregiver change `[LMN — strain evidence supports hours]` |
| Home safety | Module VIII composite | SOC, ROC, recert |
| Nonadherence | Pattern observation + barrier exploration (link SDOH) | Ongoing |

Immediate-concern positives require Module XV communication before sign-off —
the form enforces the linkage.

## Module XI — Care Needs & Hours Evidence *(Alara-specific — the LMN input)*

*Purpose: this is where the assessment becomes the draft LMN. The EMR
generates the draft Letter of Medical Necessity from this module plus
Modules III, VII, and X. The nurse records observed need; the physician
reviews, edits, and signs. The system prepares — clinicians and the
physician decide.*

For **each care type indicated** (skilled nursing · home health aide/personal
care · PT · OT · SLP · MSW · other):

- Tasks required (task-level, observable — from Module VII deficits)
- **Accepted or documented condition** each task maps to (from Module III —
  for White Card patients, hours can only be claimed against accepted
  conditions; needs driven by non-accepted conditions are flagged as
  consequential-condition candidates instead)
- Skilled-need justification where applicable (why a licensed clinician,
  not a lay caregiver)
- Frequency and duration observed: **hours per day · days per week** —
  the grid `[LMN]`
- Caregiver coverage: hours reliably covered by family/caregiver vs.
  uncovered (from Modules II and IX) `[LMN]`
- Change vs. current authorization (more · same · less) with the clinical
  reason `[OS→ lmn.evidence-ready — care types + grid deltas + condition
  mapping status; triggers the AlaraOS LMN lifecycle (signature →
  authorization → renewal). No clinical narrative crosses the seam.]`
- Equipment or environmental alternatives considered (an honest LMN
  documents what was considered besides hours)

**Discharge variant:** closing needs picture — what remains, who covers it,
and the handoff plan.

## Module XII — Patient Education

- Topics discussed (structured list + free text)
- Who received education (patient · caregiver · both · other)
- Patient/caregiver understanding (demonstrates · verbalizes · needs
  reinforcement) `[RN]`
- Teach-back performed (if applicable) and result
- Materials left in home; language/literacy-appropriate (link Module IX
  health-literacy result)
- Remaining educational needs (carries forward to next visit's prep)

## Module XIII — Clinical Impression

*This is where nursing judgment lives. The system may surface trends and
prompts; it never composes this section.* `[RN — entire module]`

Prompts:

- Overall clinical assessment
- Primary concerns, ranked
- Improvement since prior assessment (tie to POC goals)
- Deterioration risks before the next visit
- Factors affecting recovery
- Barriers to goals (clinical, functional, social — link Module IX)
- Rehabilitation potential and discharge planning outlook `[CoP]`

## Module XIV — Recommendations

*Clinical recommendations only — recommendations, not task assignments.
Dispatch, ownership, and follow-through live in AlaraOS.* `[RN]`

- Notify provider · request new orders · medication reconciliation ·
  therapy evaluation (PT/OT/SLP) · social work evaluation · dietitian
  referral · DME evaluation · social-program referral (from Module IX) ·
  increase/decrease visit frequency · LMN update indicated (from Module XI) ·
  continue current plan · emergency escalation
- Each recommendation: rationale + urgency (routine · prompt · immediate)
  `[OS→ recommendation.raised — type + urgency; AlaraOS assigns ownership
  and runs the clock]`

## Module XV — Communication Performed

*Document clinically relevant communication that already happened this visit.*

- Provider notified · family/caregiver updated · case manager contacted ·
  internal clinical consultation · patient informed of findings
- For each: who · method · summary · response/orders received
- `[OS→ communication.logged — party + method + timestamp; content stays in
  the EMR]`

## Module XVI — Verification Before Sign-Off

*Final safety check. Hard stops (⛔) block signature; soft confirms (☑︎)
require attestation.*

- ⛔ Immediate-concern risk findings (Module X) have a corresponding
  communication entry (Module XV) or documented escalation
- ⛔ Critical findings communicated to the provider
- ☑︎ Orders pending are listed and routed
- ☑︎ Follow-up clinically indicated is captured as a recommendation
- ☑︎ Assessment complete for this visit type (matrix-required modules done
  or affirmatively deferred with reason)
- ☑︎ Plan of care remains appropriate — or a POC update is flagged `[CoP]`
- ☑︎ For SOC/Recert: eligibility content complete for the payer in play
  (homebound only where required)
- Signature: clinician, credential, date/time `[OS→ visit.completed]`

---

## Appendix A — Structured outputs to AlaraOS (the AES-020 seam)

The assessment stays in the EMR. AlaraOS receives **events** — type,
severity, dates, statuses, and a pointer back to the record. Never clinical
narrative, never PHI beyond the case identifier the connector is scoped to.

| Event | Source module | AlaraOS consumes it for |
|---|---|---|
| `visit.completed` (type, date) | I, XVI | Timeline, visit cadence tracking, family loop |
| `signal.hospitalization` | I, V | ROC clock, physician/family notification workflow |
| `signal.change` (domain, status, severity) | V | Early-change surfacing to the nurse; Timeline |
| `signal.med-issue` | VI | Provider-notification workflow |
| `benefits.status` / `authorization.window` | III | Renewal countdown, authorization guard on scheduling |
| `benefits.consequential-candidate` | III | Care Guide workup workflow → physician → DOL filing |
| `benefits.gap-candidate` | III | Benefits-intelligence review |
| `careteam.gap` | IV | Coordination workflow |
| `sdoh.need` (domain, severity, referral status) | IX | Community-referral follow-through; benefits crossover |
| `risk.flagged` (type, severity, immediate) | X | Escalation and ownership clocks |
| `lmn.evidence-ready` (care types, grid deltas) | XI | LMN lifecycle: draft → signature → authorization → renewal |
| `recommendation.raised` (type, urgency) | XIV | Ownership assignment + SLA clock |
| `communication.logged` (party, method) | XV | Promise/communication tracking |

Engine note: V1 of the AlaraOS engine drafts LMN text itself because no EMR
integration exists yet. Once this template is live in Automynd,
`lmn.evidence-ready` is the trigger and the engine's `lmn.draft` step becomes
*consume the Automynd draft* (per `EMR-CAPABILITIES.md` §4).

## Appendix B — What makes this template Alara's *(vs. a generic HH assessment)*

1. **Module III (Program & Benefits Context)** — accepted-conditions mapping
   and consequential-condition screening built into the clinical visit. No
   generic EMR template carries the DOL card into the assessment.
2. **Module XI (Care Needs & Hours Evidence)** — the deficit → condition →
   frequency → coverage-gap chain that makes the draft LMN's hours grid
   defensible instead of asserted.
3. **Module IX (SDOH as structured screens)** — validated micro-instruments
   producing comparable, referral-ready facts, doubling as benefits signals.
4. **The `[OS→]` seam** — every event AlaraOS needs to run the life cycle is
   emitted by a named field, so coordination never depends on someone
   remembering to re-key information.
5. **`[RN]` doctrine markers** — the sections AI must never pre-fill are
   marked in the spec itself, so the boundary survives implementation.

## Appendix C — Standards validation (to complete before locking)

Mapping already reflected in the modules above; formal sign-off outstanding.

- **42 CFR 484.55 (Comprehensive Assessment of Patients):** current health,
  psychosocial, functional, and cognitive status ✅ (VI, VII, IX, X) ·
  eligibility incl. homebound where payer requires ✅ (I, XVI) · drug regimen
  review ✅ (VI) · patient goals/preferences ✅ (II) · rehab potential and
  discharge planning ✅ (XIII) · caregiver willingness/ability ✅ (II, IX) ·
  timing rules (48-hour initial visit, 5-day completion, 60-day update,
  ROC within 48 hours, reassessment on major change) ✅ (matrix + V).
- **OASIS-E:** `[OASIS]`-tagged items are collected once and populate the
  OASIS data set for payers that require it; Automynd to confirm item-level
  crosswalk (esp. Section GG assistance scale, M-items for wounds/dyspnea/
  continence, PHQ-2/9, high-risk meds).
- **Instruments:** MAHC-10, Braden, MNA-SF, BIMS/Mini-Cog, CAM, PHQ-2/9,
  GAD-2/7, UCLA-3, Hunger Vital Sign, Modified CSI — all validated for or
  commonly used in home care; substitutions require owner approval.
- **Nevada-specific:** mandatory reporting (elder/vulnerable-adult abuse,
  neglect, exploitation) surfaced in-form at Module X; confirm current
  statute cites before locking.
- **Accreditation (ACHC/CHAP/TJC as applicable):** confirm survey-readiness
  of the verification module and education documentation.
- **EEOICPA/OWCP program rules:** confirm with the DOL district office /
  billing that the Module XI evidence chain matches current LMN expectations
  (hours grid mapped to accepted conditions; CPT 99080 physician report).

### Open items before locking
1. Owner + Automynd review of module boundaries and the visit-type matrix.
2. Automynd feasibility pass: conditional-expansion logic (Module V driving
   module expansion), hard-stop enforcement (Module XVI), event emission
   (Appendix A).
3. Item-level OASIS-E crosswalk (Automynd).
4. Verify the three owner-stated EMR capabilities in the tenant
   (social-program referrals, needs ID, change alerts) so Module IX/V events
   land in real features.
5. Clinical review by a second home-health RN against current CoPs before
   any patient use.
