# The Human Boundary — step-level assignment inside every workflow
**July 2026.** Companion to `ALARAOS-WORKFLOW-INVENTORY.md` (same IDs). Each
workflow is broken into its steps; steps are assigned **E** (engine) or **H**
(human) — and every H carries a reason code, because "a human should do this"
is only allowed for one of three reasons:

- **H:LIC** — a license or program rule requires a specific human (RN
  assessment, MD/DO signature, DON supervision, licensed visit staff).
  Non-negotiable; verify exact citations during build.
- **H:JUD** — clinical or case judgment: weighing evidence, deciding a path,
  changing a plan. The engine prepares the decision; a human makes it.
- **H:TRU** — trust moments: the conversations where a person IS the product
  for this population (an 80-year-old's callback, a physician peer call, bad
  news). Automating these loses the customer.

Anything not flagged H is the engine's job. **The operating pattern is the
same everywhere: engine prepares → human acts → engine records and follows
up.** No human should ever start from a blank page, hunt for status, or
remember a deadline.

---

## A. Intake & response

**A1 · Inbound phone answering**
1. E — route the call, surface the caller's case (if known) on screen before pickup
2. **H:TRU — the conversation** (nurse or Care Guide answers)
3. E — log outcome, spawn follow-up tasks, start any promised clocks
4. E — missed-call capture → callback queue with SLA timer

**A2 · Call-back requests (begin)**
1. E — receive, log, deliver, assign to a Care Guide, start the 1-bh clock
2. E — pre-brief: match name/phone/story against existing cases, draft talking points
3. **H:TRU — the callback conversation**
4. E — record disposition, schedule next actions, breach-alert if clock expires

**A3 · Case-review requests (wizard)**
1. E — structured intake received and logged
2. E — pre-read: worksite/employer/years/illness matched against covered-facility list, SEC classes, program rules; draft briefing with a preliminary read
3. **H:JUD — the nurse's actual read**: does the evidence support a path, which one
4. **H:TRU — the callback** that delivers it privately
5. E — disposition, next-step tasks (Resource Center handoff, referral start), follow-up cadence

**A4 · Referral receipt confirmation**
1. E — instant receipt (in-page + email/fax ingestion logged), 1-bh clock started
2. **H:TRU — the clinician confirmation call to the referrer** (peer credibility is the product)
3. E — record what was promised, spawn the patient-contact task

**A5 · Patient contact after referral**
1. E — schedule within the 4-bh window, brief from the referral
2. **H:TRU — the call to the patient/family**
3. E — record, schedule assessment, notify referrer (A7)

**A6 · Discharge referrals**
1. E — flag as discharge-class (priority queue), 1-bh clock
2. **H:JUD — accept/decline against capacity and acuity** (staffing judgment)
3. **H:TRU — coordination call with the discharge planner**
4. E — track the discharge date as a hard deadline driving every downstream task

**A7 · Referrer status updates** — 100% engine.
1. E — milestone events (patient contacted / assessment done / auth received / care started) auto-notify the referrer
2. E — exceptions escalate to a human only when something is off-track (then H:TRU call)

**A8 · VA waitlist** — engine list, human calls.
1. E — capture, tag, hold; trigger on enrollment go-live; order the first-call queue
2. **H:TRU — the calls** (now, and at go-live)

**A9 · Complex-case consult** — **H:TRU/H:JUD end-to-end** (clinical director). E only schedules and briefs.

**A10 · Coverage-area answer** — 100% engine (service-area rule on city/ZIP). H only for genuine edge negotiations (a Tonopah case worth a staffing decision → H:JUD).

## B. Benefit navigation & case review

**B1 · White Card case reading**
1. E — evidence assembly: facility match, SEC class check, employment-period overlap, illness-category mapping; preliminary score with reasons
2. **H:JUD — the judgment**: is this worth pursuing, which part (B/E), what's missing
3. **H:TRU — telling the family** (hope management: neither overpromising nor crushing)
4. E — record the read; generate the Resource Center handoff package

**B2 · Survivor case reading** — same shape as B1; the H:TRU step is heavier (grief present); everything else E.

**B3 · Program determination**
1. E — rules across White Card/OWCP/VA/Medicare/Black Lung on intake facts → ranked picture
2. **H:JUD — confirm on ambiguous/multi-program cases only**; clean single-program cases can flow on the engine's determination with nurse visibility

**B4 · Benefit maximization ("all of them")**
1. E — continuous screen of every active case against every benefit rule (consequential-condition candidates, unclaimed travel, caregiver-pay eligibility, DME/mods triggers, impairment/wage-loss timing, survivor rights)
2. E — flag with evidence attached
3. **H:JUD — clinical confirmation** that the flag is real (e.g., this diagnosis plausibly is consequential)
4. **H:TRU — raising it with the family** ("you may be owed travel money" lands better from their nurse)
5. E — track each flag to resolution; nothing raised is allowed to evaporate

**B5 · Claim-path handoff** — 100% engine (warm-context package to Resource Center / AR, logged, follow-up scheduled). H only if the family asks to talk it through.

**B6 · Hours/authorization review**
1. E — diff documented care needs vs. authorized hours; produce the gap analysis
2. **H:JUD — the clinical verdict** on what the documentation supports
3. **H:TRU — the conversation** about what happens next
4. E — spawn the updated-LMN workflow (C1/D5) if warranted

## C. Start of care

**C1 · LMN / physician-order preparation**
1. E — draft the LMN and supporting record from AlaraOS visit/assessment data
2. **H:JUD — nurse review of the draft** (clinical accuracy, completeness)
3. **H:LIC — physician signature** (MD/DO only — external, but the workflow's gate)
4. E — route for signature, track where it sits, nudge, file on return

**C2 · Physician coordination**
1. E — status board: every unsigned order, who has it, how long, next nudge
2. **H:TRU — the physician-office relationship** (calls, visits, the peer channel)

**C3 · In-home clinical assessment**
1. E — schedule, brief the clinician, structure the documentation forms
2. **H:LIC — the assessment itself** (RN in the home)
3. E — same-day completeness check; feed C1 and C8

**C4 · DON start-of-care review**
1. E — queue every SOC with the full record; block care start until cleared
2. **H:LIC — the DON's review and sign-off**

**C5 · Benefit & authorization verification** — 100% engine (portal lookups, card/condition/auth checklist). **H:JUD only on discrepancies** (card says X, family says Y).

**C6 · Authorization management**
1. E — own every authorization's status, deadline, and follow-up cadence; document the trail
2. **H:TRU/H:JUD — the agency phone calls** (DOL claims staff, Nurse Case Managers) when a human must move a human

**C7 · Start-of-care scheduling**
1. E — clock starts at authorization; propose staffing against availability and the 48–72h promise
2. **H:JUD — final staffing call** (which nurse fits this patient)

**C8 · Whole-person + consequential screening**
1. E — put the validated tools in the visit workflow; score; store; trend
2. **H:LIC — administering them in the home** (part of the RN visit)
3. E — flags route into B4

## D. Ongoing operations

**D1 · Skilled care delivery** — **H:LIC, the irreducible core.** Every visit. E schedules, briefs, and documents around it — the visit itself is the product.

**D2 · Point-of-care documentation**
1. **H:LIC — the clinician documents** (their observations, their license)
2. E — structures the capture, enforces same-day completeness, makes it the single record

**D3 · Authorization guard** — 100% engine. A hard scheduling gate; no human override without a logged DON exception (**H:LIC** if used).

**D4 · Renewal engine**
1. E — count down every authorization; assemble the renewal draft from visit data well before expiry
2. **H:JUD — nurse review of the draft**
3. **H:LIC — physician signature**
4. E — submit, track, confirm; alert on any renewal at risk

**D5 · Hours-change documentation**
1. E — detect drift (documented needs vs. authorized hours) and trigger
2. Then identical to D4 (draft → H:JUD review → H:LIC signature → E tracking)

**D6 · Proactive monitoring**
1. E — watch the record for signals: wound trajectory, falls, weight, vitals patterns, missed visits, caregiver strain scores
2. **H:JUD — a nurse triages every flag** (real, noise, or urgent)
3. **H:TRU — acting on it with the family/physician**
4. E — log the loop; tune the signals

**D7 · Multi-party coordination**
1. E — the waiting-on board: who owes what to whom, since when; auto-chase documents and status
2. **H:TRU — the conversations that move people** (physician offices, claims examiners, case managers)

**D8 · Billing integrity** — 100% engine (bill only from completed visit documentation; multi-payer routing; reconciliation). **H:JUD on denials and disputes only.**

**D9 · Family caregiver program**
1. E — eligibility rules, enrollment paperwork, payroll mechanics, hour tracking against authorization
2. **H:LIC — training and ongoing nurse supervision of the family aide**
3. **H:TRU — the initial "your daughter can be paid for this" conversation**

**D10 · Travel reimbursement** — 100% engine (claim-ready mileage from the appointment/visit record; family confirms; forms generated). H not required.

**D11 · Consequential conditions**
1. E — flag candidates from the record (new diagnoses, medication patterns)
2. **H:JUD — clinical confirmation** the link is plausible
3. **H:LIC — physician documentation** of the connection
4. E — package for the Resource Center/AR; track to decision

**D12 · Agency-switch transitions**
1. E — run the transition checklist: records request, auth continuity, timing plan, no-gap schedule
2. **H:TRU — the family's hand-holding through it** and any old-agency friction
3. **H:LIC — the new SOC assessment** (C3/C4 apply)

**D13 · Care Guide continuity**
1. **H:TRU — the Guide is a person.** Non-negotiable; the promise is a name.
2. E — everything that makes one human able to hold many cases: the record, the briefings, the task queue, coverage handoffs that don't ask the family to repeat anything

**D14 · Aide-hour scheduling** — 100% engine (hours math against the authorization, conflict detection). **H:JUD only when hours must be rationed or reshuffled.**

## E. Website layer — 100% engine already (Navigator, wizard, estimator, forms, receipts, analytics). No human in the loop by design; every conversion hands off into A2–A6.

---

## Roll-up: the complete human roster

Across all 38 workflows, only **five kinds of human moments** exist:

| Role | The moments (workflow steps) | Reason |
|---|---|---|
| **Field clinicians** (RN/LPN/therapist/aide) | Every visit (D1), in-home assessments (C3, D12), point-of-care documentation (D2), screening administration (C8), family-aide training/supervision (D9) | LIC |
| **DON** | SOC review sign-off (C4), guard-override exceptions (D3) | LIC |
| **Physicians** (external) | LMN/order/renewal signatures (C1, D4, D5), consequential-condition documentation (D11) | LIC |
| **Case nurses / Care Guides** | Case-read judgments (B1, B2, B6, D6 triage, B4 confirmations, C7 staffing, A6 accept), and every trust conversation: callbacks, deliveries of news, physician-office and agency calls, family raises (A1–A6, A8–A9, B1–B4, C2, C6, D6, D7, D9, D12, D13) | JUD + TRU |
| **Clinical director** | Complex-case consults (A9), escalations | JUD + TRU |

**The count:** of roughly 120 steps across the 38 workflows, about **34 are
human** — and more than half of those are the *same recurring moment in
different clothes*: a nurse having a conversation the engine fully briefed.

**The design rule that falls out:** the engine owns every clock, every queue,
every draft, every lookup, every chase, and every record. Humans do exactly
three things — **hold a license, make a judgment, or hold a hand** — and they
never do them from a blank page. Staffing scales with visits and
conversations; everything else scales with software.

**Build order this implies (unchanged from the inventory, now justified at
step level):** the LMN/renewal engine (C1/D4/D5) removes the most H-adjacent
toil per licensed hour; the SLA clock layer makes every promise in section A
measurable; the pre-reader (A3/B1) turns the nurse's hour into judgment
instead of research; the benefit-maximization screen (B4) is the moat.
