# AlaraOS Workflow Inventory — everything the website says we do
**July 2026.** A complete inventory of the operational promises on alarahc.com,
compiled from the live copy (grep of every "we do X" claim across 55 surfaces).
This is the input for working backwards: which workflows are 100% human, and
which the AlaraOS engine gets built to run.

**Column key (FIRST PASS — for discussion, not decided):**
- **H** = 100% human (clinical, licensed, or trust-bearing — a person must do it)
- **E** = engine (AlaraOS can run it end-to-end: clocks, queues, rules, drafts, guards)
- **H+E** = hybrid (engine prepares/flags/drafts → human reviews, signs, or delivers)

Every SLA on this list is a **published promise** — once the engine exists, it
should be measuring these clocks even for the workflows humans perform.

---

## A. Intake & response — the front door

| # | Workflow | The promise (as published) | SLA | Split |
|---|---|---|---|---|
| A1 | Inbound phone answering | "A nurse answers, usually within the hour during business hours; after 6 PM, first thing the next business day" | 1 bh / next-day | **H** (E runs the clock + missed-call queue) |
| A2 | Call-back requests (begin) | Nurse calls back | 1 bh / next-day | **H+E** — engine receives, logs, queues, assigns, starts the SLA timer; nurse makes the call |
| A3 | Case-review requests (wizard) | "A nurse reads your case… usually within one business hour," then calls back to confirm privately | 1 bh read | **H+E** — engine intakes the structured case, pre-reads it (worksite/role/years/illness → covered-facility + SEC match), drafts the nurse's briefing; nurse judges and calls |
| A4 | Referral receipt confirmation | "We confirm receipt within one business hour" (call to the referrer) | 1 bh | **H+E** — engine confirms receipt instantly (the in-page receipt already does); clinician call follows |
| A5 | Patient contact after referral | "We contact the patient within four business hours" | 4 bh | **H** (E schedules + reminds) |
| A6 | Discharge referrals | "Answer discharge referrals within the hour… coordinate timing with the discharge planner so care is not the thing waiting" | 1 bh | **H+E** |
| A7 | Referrer status updates | "We keep you updated on your patient" (the repeat-referral loop) | ongoing | **E** — engine sends milestone updates (assessment done, auth received, care started) with human-visible content; nurses only write exceptions |
| A8 | VA waitlist | "A nurse calls you back now… and calls you first the day our VA enrollment goes live" | now + at go-live | **E** — the list, the trigger, the first-call queue; nurse makes the calls |
| A9 | Complex-case consult | "Our clinical director is available to consult before you refer" | — | **H** |
| A10 | Coverage-area answer | "Pahrump, Nye County… confirmed case by case… a straight answer on the first call" | first call | **E** — a service-area rule the engine answers instantly (city/ZIP is now captured on the form) |

## B. Benefit navigation & case review

| # | Workflow | The promise | SLA | Split |
|---|---|---|---|---|
| B1 | White Card case reading | "A nurse reads your worksite, your work, and your illness together and tells you whether the card can be opened" | 1 bh | **H+E** — engine matches facility/employer/years against the covered-facility list and SEC classes and pre-scores; nurse makes the judgment and the call |
| B2 | Survivor case reading | "A nurse reads your family member's work and illness, tells you what may be owed, and points you to the free help to file" | — | **H+E** (same engine pre-read; survivor-specific rules) |
| B3 | Program determination | "We confirm what applies to you and what it covers" (White Card / OWCP / VA / Medicare / Black Lung) | — | **H+E** — the Navigator already does the educational version; the engine version runs it on real intake data |
| B4 | Benefit maximization | "Every benefit you qualify for — including the ones families miss — found and put to work. Not some of them. All of them." (consequential conditions, travel, paid family caregiver, survivor money, DME, home modifications, impairment) | ongoing | **H+E** — this is the flagship engine build: a rules engine that continuously screens every case against every benefit and flags misses; nurses confirm and act |
| B5 | Claim-path handoff | "We point you to the free Resource Center or an Authorized Representative for the claim itself" (Alara does not file claims) | — | **E** — deterministic handoff with warm context |
| B6 | Hours/authorization review | "A nurse reads your care needs and your current authorization together and tells you what the documentation supports" | — | **H+E** — engine diffs recorded care needs vs. authorized hours; nurse delivers the verdict |

## C. Start of care — the referral engine

| # | Workflow | The promise | SLA | Split |
|---|---|---|---|---|
| C1 | Physician order / LMN preparation | "We prepare the EE-17B / Letter of Medical Necessity documentation and the supporting record… drafted from recorded clinical data. Your physician signs evidence, not recollection." | — | **H+E** — THE core engine artifact: LMN drafted from AlaraOS visit data; nurse reviews; physician signs |
| C2 | Physician coordination | "We coordinate the order with your physician" / "send it for signature" | — | **H+E** — engine tracks where every unsigned order sits and nudges; humans own the relationship |
| C3 | In-home clinical assessment | "We complete the in-home clinical assessment" | — | **H** (E schedules it and structures the documentation) |
| C4 | DON start-of-care review | "Our Director of Nursing reviews every start-of-care assessment before it becomes the plan" | every SOC | **H** (E queues and gates: no care before review) |
| C5 | Benefit & authorization verification | "We verify your claim and authorizations" / "verify the card, accepted conditions, and current authorization" | — | **E** — WCMBP/portal lookups, structured verification checklist; human handles exceptions |
| C6 | Authorization management | "We manage the authorization" / "walk it through authorization" (DOL, OWCP, VA) | — | **H+E** — engine owns status, deadlines, and follow-up cadence; humans make the agency calls |
| C7 | Start-of-care scheduling | "Start of care typically within 48 to 72 hours of authorization" | 48–72h | **H+E** — engine starts the clock at auth and schedules; nurses staff it |
| C8 | Whole-person screening | "We screen for depression, malnutrition, social isolation, and caregiver strain using validated tools" + "screen for consequential conditions" | at SOC | **H+E** — nurse administers; engine scores, stores, and flags |

## D. Ongoing care operations

| # | Workflow | The promise | SLA | Split |
|---|---|---|---|---|
| D1 | Skilled care delivery | Nursing, wound care, infusion/IV (PICC/central line), PT/OT, aide — "local clinicians, no traveling or agency nurses" | per plan | **H** — the irreducible core |
| D2 | Point-of-care documentation | "Documented in the care record at the time of care" / "One record of your care, always current" | every visit | **H+E** — clinician documents; engine is the record and enforces same-day completeness |
| D3 | Authorization guard | "Our scheduling blocks visits without a valid authorization number" | every visit | **E** — a hard gate in scheduling |
| D4 | Renewal engine | "Renewals are tracked in advance… the renewal documentation is assembled before the period ends, from recorded visit data, so care does not stop over paperwork" | before expiry | **H+E** — engine counts down every authorization, assembles the renewal draft from visit data; nurse reviews, physician signs |
| D5 | Hours-change documentation | "When your needs change… we document it so your hours match your needs" (the hours black box) | at change | **H+E** — engine detects drift between documented needs and authorized hours and triggers the updated-LMN workflow |
| D6 | Proactive monitoring | "We notice what's changing and act early, so you're not the one who finds out too late" / "We act before any of it turns into a crisis" | continuous | **H+E** — engine watches the record for signals (wound trajectory, falls, weight, missed visits); nurses act |
| D7 | Multi-party coordination | "Your doctor, the DOL Claims Examiner, the Nurse Case Manager, the VA, the Resource Center, your rep — every one of them kept in step; you are never the messenger" | ongoing | **H+E** — engine tracks who's waiting on whom; humans do the talking |
| D8 | Billing integrity | "Every visit we bill is a visit that occurred, documented at the time of care… billed directly to the DOL… we never take a percentage" + "coordinate billing across multiple payers" | every claim | **E** — bill only from completed documentation; multi-payer routing; human handles denials |
| D9 | Family caregiver program | "The family member already helping can be trained and paid as a home health aide — trained, nurse-supervised, on payroll" | — | **H+E** — engine runs eligibility, enrollment steps, payroll; humans train and supervise |
| D10 | Travel reimbursement | "Hundreds a month most people never claim" — help claiming mileage (OWCP-957) | monthly | **E** — engine generates claim-ready mileage from the visit/appointment record; family confirms |
| D11 | Consequential conditions | "When your illness causes a second problem, it goes on your card too" — screen and add | ongoing | **H+E** — engine flags candidates from the record; nurse + physician confirm; points to Resource Center for the claim |
| D12 | Agency-switch transitions | "A nurse maps the transition — card, order, start of care — so there is no gap"; "coordination is the new agency's job, not yours" | no-gap | **H+E** — engine runs the transition checklist and timing; humans coordinate |
| D13 | Care Guide continuity | "One named person owns your case… you never explain yourself twice" | always | **H+E** — the Guide is a person; AlaraOS is what makes the promise survivable (anyone covering reads the record) |
| D14 | Aide-hour scheduling | "We schedule aide hours to your authorization, whoever provides them" | per auth | **E** — scheduling math against the authorization |

## E. Already automated (the website layer)

| # | Workflow | Status |
|---|---|---|
| E1 | Benefit Navigator, case-review wizard, impairment estimator, hours guide, comparison tables | live, self-serve |
| E2 | Form intake → server log → email delivery (key-ready) + in-page receipts | live |
| E3 | Anonymous funnel analytics (page views, CTA taps, wizard steps, Navigator outcomes, submit results) | live |
| E4 | 30-article education library + editorial calendar | live |

---

## First-pass reading of the split (for the working session)

**Irreducibly human (H):** the visits themselves (D1), the in-home assessment
(C3), DON review (C4), the nurse phone conversations (A1/A5/B1's call), the
clinical director consult (A9), physician relationships (C2's human half).
Everything else has an engine component.

**Pure engine candidates (E) — build first, they remove daily toil and enforce
published SLAs:** authorization guard (D3), coverage-area answer (A10), claim-path
handoff (B5), VA waitlist + go-live trigger (A8), benefit verification lookups
(C5), billing-from-documentation (D8), travel-reimbursement generation (D10),
aide-hour scheduling (D14), referrer milestone updates (A7).

**The flagship hybrids — where AlaraOS is the moat the website already sells:**
1. **The LMN/renewal engine** (C1 + D4 + D5): draft every LMN and renewal from
   recorded visit data, count down every authorization, detect needs-vs-hours
   drift. The website's single most repeated promise.
2. **The benefit-maximization screen** (B4 + D11 + D10): every case,
   continuously screened against every benefit — consequential conditions,
   travel, caregiver pay, survivor money, DME. "Not some of them. All of them"
   is only honest at scale with a rules engine.
3. **The case pre-reader** (A3 + B1–B3): structured intake matched against
   covered facilities, SEC classes, and program rules so the nurse's
   one-business-hour read starts from a briefing, not a blank page.
4. **The SLA clock layer** (A1–A6, C7): every published response time measured
   from the moment of intake, with breach alerts — the engine holds the humans
   to the numbers the website publishes.

**Suggested working-backwards order:** agree the H list first (smallest),
then pick one flagship hybrid to spec as AlaraOS build #1 — the LMN/renewal
engine is the strongest candidate: it's the most-published promise, the hours
black box is the market wedge, and every input it needs is data Alara already
generates by delivering care.
