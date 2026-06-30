# The Alara Website — Full Outline (derived from locked canon)

> Status: DRAFT for owner sign-off, 2026-06-30. This is the **skeleton**: every page,
> its one job, the realities it serves, its sections, and where it hands off. It is
> derived from `docs/VISION.md`, `docs/ARCHITECTURE-OF-EXPERIENCE.md`, and
> `docs/REALITY-ENTRY-ARCHITECTURE.md`. Headlines here describe *intent*, not final copy.
> We agree the structure here, then write the words.

## 1. The logic the whole site runs on

- **The site is one Interaction surface of AlaraOS.** Inbound, it *perceives* (captures the
  visitor's reality); outbound, it delivers that visitor's *participant obligation* (what they
  may know and should receive). It is never built straight from architecture to pixels.
- **Reality organizes it, not personas.** Each page exists to meet a reality a visitor brings
  (from the Reality Entry Catalog). The visitor's identity only bounds what they're shown.
- **Two lanes + one bridge + one reveal.**
  - *Education lane* (build trust, get found): Benefits hub, the pillars, Library.
  - *Service lane* (convert): Services, About, Begin.
  - *The bridge*: the Navigator ("See what you qualify for") — always one click away.
  - *The reveal*: The AlaraOS difference — why Alara is not like other agencies.
- **Engagement progression:** Learn → Engage → Organizational Response. Never rush a visitor
  from Learn to a phone call.
- **Hard rules (Public Experience Layer):** never make someone more anxious; no manipulation;
  no dead ends; show outcomes, never machinery; never bypass the consent gate.
- **Rendering rule:** concrete numeric promises (one-hour discharge response, physician SLAs)
  appear only on *referrer* surfaces; patient surfaces get outcome language.

## 2. Navigation & site map

```
TOP NAV:  Services   Benefits   Library   About        [Call]  [See what you qualify for]

HOME ─ the threshold: recognize your reality, see what Alara does + why it's different, route.
│
├─ BENEFITS (hub) ─ index of programs; routes to each pillar, teaches nothing deeply.
│   ├─ White Card (EEOICPA) pillar        [built]
│   ├─ OWCP / FECA pillar                 [built]
│   └─ VA Community Care pillar           [to build]
│
├─ LIBRARY ─ plain-language definitions that support the pillars; cites them.
│
├─ THE ALARAOS DIFFERENCE ─ the reveal: anticipation, orchestration, appropriate awareness.
│
├─ SERVICES ─ what Alara clinically does (service lane).
├─ ABOUT ─ who Alara is, why to trust them (service lane).
│
├─ NAVIGATOR ("See what you qualify for") ─ the bridge: personalize → cited answer + next step.
├─ BEGIN ─ start care / be contacted (conversion).
│
├─ PHYSICIANS / REFERRAL ─ separate lane: competence + speed, concrete SLAs.   [to build]
└─ EEOICPA FILING (no card yet) ─ the longer path, lifted out of the pillar.    [to build]
```

**Open nav decision:** whether "The AlaraOS difference" earns a top-nav slot, or stays
surfaced from Home + About. (Recommendation: surface from Home prominently; add to nav only if
it tests as a primary destination.)

## 3. Page-by-page outline

Each page: **Job** (the one thing) · **Realities it serves** (from the Catalog) · **Sections**
(in order, by their job) · **Hands off to**.

### HOME — the threshold
- **Job:** let the right person recognize their situation and draw them in, show what Alara does
  and why it's different, and route them to their reality.
- **Realities:** all patient/family entries (Catalog rows 1–10) + a door for referrers.
- **Sections:**
  1. *Hero* — what Alara is, in one clear line (positioning), with the AlaraOS difference implied.
  2. *Reality recognition* — the entry realities in the visitor's own words; each routes to its place. (This is how the organization perceives them.)
  3. *What happens when you reach out* — the first commitment, outcome-rendered (a named owner; we do the work).
  4. *The AlaraOS difference* — the moat (knows before, everyone in concert, each person informed), → the reveal page.
  5. *Benefits you may be missing* — the revelation, backed by `data/programs.json`.
  6. *The standard is ours* — proof (DON reviews every start of care; only MSW agency; nurse-led, local).
  7. *Doors* — patients → Navigator; professionals → referral (with the one-hour SLA).
- **Hands off to:** the matching reality (pillar / navigator), or Begin.

### BENEFITS — the hub
- **Job:** route, don't teach. One card per program → its pillar.
- **Realities:** "I have a White Card," "I was hurt at work (OWCP)," "I'm a veteran," "I need home care (unsure which)."
- **Sections:** short intro; a card per program (what it is in one line, who it's for, → pillar); a line to the Navigator for the unsure.
- **Hands off to:** the pillars; the Navigator.

### WHITE CARD (EEOICPA) PILLAR — education [built]
- **Job:** the clearest explanation of the White Card anywhere, authored by Alara as the expert; convert trust at the end.
- **Realities:** "I have a White Card and need care" (primary); "I think I might qualify" (forks to the filing path).
- **Sections (the pillar arc):** recognition hook → benefits most miss → what it covers → what the card is → the cardholder/no-card fork → your specific question (consequential / Medicare / file) → what Alara does / does not do → FAQ → where to go next (Navigator + Begin + print).
- **Hands off to:** Navigator, Begin, the filing path (no-card).

### OWCP / FECA PILLAR — education [built]
- **Job:** same template; answer "does workers' comp cover home care, and how is it authorized?"
- **Realities:** "I have an accepted OWCP claim," "I was just injured at work."
- **Sections:** recognition → does comp cover home care (yes, when…) → what's covered → the authorization path others get wrong → what Alara handles → FAQ → next step.
- **Hands off to:** Navigator, Begin.

### VA COMMUNITY CARE PILLAR — education [to build]
- **Job:** answer "can I get home care without the VA wait, and without Medicare?"
- **Realities:** "I'm a veteran and need home health," "I'm a veteran, not sure what I need."
- **Sections:** same arc; goals-first, no-pressure tone (per the veteran journeys).

### LIBRARY — supporting definitions
- **Job:** define the terms the pillars use; never re-teach the pillar; cite it.
- **Sections:** searchable/scannable definitions (White Card, EEOICPA Part B/E, consequential condition, OWCP, FECA, VA Community Care, authorization, Authorized Representative…), each linking to its pillar.

### THE ALARAOS DIFFERENCE — the reveal
- **Job:** make the visitor *feel* and believe why Alara is different, without explaining machinery.
- **Realities:** anyone who's intrigued ("why is this different / why should I spend time here").
- **Sections:**
  1. *Hero* — the distinctive promise (care that's ahead, in concert).
  2. *What sets it apart* — the three pillars: knows before (anticipation) · everyone in concert (orchestration) · each person already knows their part (appropriate awareness).
  3. *Reason-why* — one living picture of you, read continuously; people make every decision; nothing without consent.
  4. *CTA* — Navigator.
- **Hands off to:** Navigator, Begin.

### SERVICES — what Alara clinically does (service lane)
- **Job:** show clinical competence and the whole-person standard.
- **Sections:** the clinical services (skilled nursing, wound care, therapy, aide, MSW, caregiver training); the whole-person screen; the operating commitments (DON review, one-hour response, zero authorization gaps).
- **Hands off to:** Begin; back to education for the not-ready.

### ABOUT — who Alara is (service lane)
- **Job:** earn trust; why these people.
- **Sections:** why Alara exists (care moved home, help didn't); the founder (experience, anonymous by brand rule); the operating commitments; credentials + service area.
- **Hands off to:** Begin; Navigator.

### NAVIGATOR ("See what you qualify for") — the bridge
- **Job:** personalize education into a plain, cited answer + the one next step. The bridge every pillar hands to.
- **Realities:** all of them — it triages "I need home care (unsure which)" into the right program.
- **Sections:** a few plain questions → a plain answer with its source → the one next step (Begin, or a pillar, or print). No account, no long form.
- **Hands off to:** Begin; the matching pillar.

### BEGIN — start care / be contacted (conversion)
- **Job:** the lowest-friction way to hand the work to Alara; honor the first commitment.
- **Realities:** anyone ready; also referrers.
- **Sections:** minimal capture (only the Catalog's first-contact fields); what happens next (named owner, fast human follow-up); reassurance.
- **Hands off to:** the organization (a Care Guide).

### PHYSICIANS / REFERRAL — separate lane [to build]
- **Job:** competence + speed, not benefits education; make referring effortless.
- **Realities:** "my patient needs home health," "my patient is being discharged."
- **Sections:** what Alara handles for them; how to refer (their workflow); the closed loop and **concrete SLAs** (one-hour discharge response, SOC ack, etc.).
- **Hands off to:** referral submission.

### EEOICPA FILING (no card yet) — the longer path [to build]
- **Job:** serve "I think I might qualify" honestly as a separate, longer path (filing EE-1/EE-2, the Resource Center, appeals) — not implying a quick start.
- **Sections:** what the path is, what's required, where Alara fits (and does not), the Resource Center.

## 4. Build status

| Page | Status |
|---|---|
| Home | built (live), copy being refined |
| Benefits hub | built |
| White Card pillar | built |
| OWCP / FECA pillar | built |
| Library | built |
| The AlaraOS difference | built (PR #12), copy being refined |
| Services | built |
| About | built |
| Navigator | built — flagged for an expert-grade upgrade |
| Begin | built |
| VA Community Care pillar | to build |
| Physicians / referral | to build |
| EEOICPA filing (no card) | to build |

## 5. What I recommend we lock before writing more words

1. This page set and the nav (incl. the AlaraOS-difference nav decision).
2. Home's seven-section order (above).
3. The pillar arc (used by White Card, OWCP, VA).
4. That the Navigator is the single patient CTA, and Begin is the conversion endpoint.

Once these are signed off, copy is filling a known frame, not searching for one.
