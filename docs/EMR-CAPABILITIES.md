# Everything the EMR Does — Automynd Capability Inventory
**July 2026.** Compiled from Notion canon: the Automynd System Map (canonical,
observed in the live Alara tenant), the AutoMynd design-partner meeting notes
(June 11, 2026), Journey Validation 002, and the Launch Command Center.
Companion to `ALARAOS-WORKFLOW-INVENTORY.md` and the AES corpus.

**The one-line division (ADR-001 / AES-004):**
> **Automynd documents care and recommends. AlaraOS coordinates and carries.**
> The EMR is "one room inside the platform." AlaraOS is the platform wrapped
> around it, running the full life cycle.

---

## 1. What the EMR does — the full list

### Intake & referrals
1. **Referral tracking** — every referral logged with source facility,
   referring physician, received date; Referral Insights analytics.
2. **IntakeIQ (AI intake)** — snapshot, insurance capture, insights,
   diagnoses, medications, HPI, coordination notes.
3. **AI-generated Recommended Orders** at intake — the system proposes the
   orders from the intake picture.
4. **Physician master list** — NPI, specialty, contact, referral typing.

### Clinical decision support (the "most nurse decisions" layer)
5. **Knowledge-based Plan of Care recommendations** — POC recommendations
   drawn from knowledge bases (seeded from the owner's clinical knowledge).
6. **The draft LMN with the hours grid** — generates the draft Letter of
   Medical Necessity from the in-home nursing assessment: functional
   findings, recommended care types, and an **hours-per-day / days-per-week
   grid mapped to the accepted conditions** — delivered to the physician
   ready to review, edit, and sign ("two minutes instead of a blank page";
   physician bills CPT 99080 for the report).
7. **Acuity flagging** — patient status indicators that drive scheduling
   and coordination intensity.

### The visit itself
8. **Co-pilot scribe** — captures documentation during the visit so the
   clinician engages with the patient instead of charting manually
   (the website's "your nurse looks at you, not a laptop" — this is the
   feature behind that line).
9. **Voice-assistant visit prep** — the EMR prepares the clinician for the
   visit via voice.
10. **Visit records** — scheduling, completion, documentation, visit time;
    Visit360 analytics.

### The clinical record (system of record — the legal chart)
11. **OASIS and all clinical assessments.**
12. **Physician orders** (and their signatures).
13. **Plan of Care / 485** — the certified plan and its content.
14. **All signed clinical documentation** — the legal record of care.
15. **Episode records** — accepted date, start/end of episode, status,
    certification period.
16. **Clinical demographics of record.**

### Quality & compliance
17. **QAgent** — QA review workflow: Face-to-Face, medication review, Plan
    of Care review, review status per submission.
18. **Field validation engine** — configurable required/format rules on
    intake and profile fields.
19. **Compliance analytics** — visit compliance (vitals, med recon,
    incidents, follow-up, program), HHCAHPS monitoring, readmissions.

### Coordination & dissemination
20. **Care Coordination module** (beta at intake + review level).
21. **Patient360 + the patient app** — the patient-facing interface; the
    patient sees their own care.
22. **The physician portal** — real-time visibility for the referring/
    treating physician: visit notes, vitals, care plan. ("Family stops
    calling your pager.") This is the info-dissemination channel.
23. **Scheduler** — patient/practitioner availability, active schedules,
    calendar, MyndShift.
24. **Practitioner roster & license capacity** — who can take patients,
    tracked against licensure.

### Owner-stated capabilities (to verify & document in the tenant)
These are real per the owner but not yet written into the System Map —
confirm in the live instance and promote to the canonical list:
25. **Referrals to social programs** — likely the Care Coordination module;
    document which programs and how the referral is generated.
26. **Needs identification** — beyond acuity flagging; document the
    mechanism (IntakeIQ insights? assessment-driven?).
27. **Change-in-care alerts** — who is alerted, on what triggers.

---

## 2. "It replaces case managers" — assembled from parts

The case-manager job is: intake the referral, assess needs, build the plan,
get it authorized, schedule the right clinicians, watch for changes, keep
the physician and family informed, re-certify on time. The stack covers
every piece:

| Case-manager task | Covered by |
|---|---|
| Intake & insurance workup | EMR: IntakeIQ (AI) |
| Needs assessment & care plan | EMR: assessment + knowledge-based POC recommendations |
| Hours justification / LMN | EMR: draft LMN with hours grid → physician signs |
| Authorization & renewals | **AlaraOS**: lifecycle tracking, renewal countdown, 60-day exam window calendaring |
| Scheduling to authorization | EMR scheduler + AlaraOS authorization guard |
| Watching for changes | EMR: acuity flags, compliance analytics → **AlaraOS**: signals → nurse acts |
| Keeping the physician informed | EMR: physician portal (real-time) |
| Keeping the family informed | EMR: patient app → AlaraOS: family communication loop |
| Owning the next step | **AlaraOS**: ownership engine / Care Guide — one named owner |

**The honest public claim:** not "software replaced your case manager" (this
population would hate that) but — *"the coordination work case managers do
by phone and fax is built into the system, and one named person owns your
case."* The machine does the case-management labor; the Care Guide does the
case-management relationship.

---

## 3. The seam (what stays AlaraOS's — unchanged from canon)

AlaraOS never stores clinical content (pointers + non-PHI summaries only)
and owns what Automynd does not model: events, the Timeline, relationships,
promises, workflows, ownership/escalation, communications, benefits
intelligence, organizational learning. Automynd → AlaraOS flow via the
AES-020 connector and AES-004 Clinical Signal Engine. Alara never writes
clinical records.

---

## 4. Website copy implications (actioned July 2026)

Prior copy credited **AlaraOS** with drafting the LMN. Canon: **the EMR
generates the draft** (from the in-home assessment, with the hours grid);
**AlaraOS carries it** — to the physician for signature, through DOL
authorization, and to every renewal before it comes due. The public pages
(home, care-hours, LMN article, choosing-an-agency) now attribute drafting
to the assessment/EMR and the lifecycle to AlaraOS.

Engine note: the V1 engine drafts LMN text itself because no EMR integration
exists yet; per this canon, V2's `lmn.draft` step becomes *consume the
Automynd draft LMN* (via the AES-020 seam) rather than compose one.
