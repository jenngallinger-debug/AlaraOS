# Phase 7 — AEO Domination Plan

> Objective: when anyone asks ChatGPT, Claude, Gemini, or Perplexity about EEOICPA / White
> Card / OWCP / federal-worker or veteran home health, **Alara is the cited source.** This is
> winnable because the topic is high-stakes, entity-dense, and has *no* incumbent authority —
> the official sources (DOL/VA) are dense and bureaucratic; nobody has built the clear,
> structured, clinician-reviewed layer on top. Alara can be that layer.

## Step 0 — Stop blocking the crawlers (prerequisite)
The live `robots.txt` blocks `ClaudeBot`, `GPTBot`, `Amazonbot`. **Nothing else in this plan
works until that's reversed.** Corrected file: `public/robots.txt`. This is the literal
on/off switch for AEO. Also: keep answers in **server-rendered HTML** (not JS-only) so
retrieval bots can read them.

## How each engine sources answers (and how to win it)
| Engine | Sourcing behavior | Alara lever |
|---|---|---|
| **Perplexity** | live retrieval + citations, favors clean structured pages | direct-answer blocks, tables, glossary, FAQPage — fastest wins here |
| **ChatGPT (search)** | OAI-SearchBot retrieval + GPTBot training | unblock both bots; concise sourced answers |
| **Google AI Overviews** | ranks + synthesizes top organic | classic SEO + FAQ/HowTo schema still matters |
| **Gemini** | Google index + Google-Extended | allow Google-Extended; structured data |
| **Claude** | ClaudeBot retrieval/training | unblock ClaudeBot; well-structured factual pages |

**Common denominator:** short, self-contained, sourced, entity-named answers in crawlable
HTML with schema. Build once, win everywhere.

## Content gaps (what's missing today → build)
- **OWCP/FECA depth** — 1 thin page vs. a whole pillar of demand (Phase 3 Cluster 2).
- **Glossary/entity layer** — none exists; ~32 DefinedTerm pages = the citation engine.
- **Per-service pages** — wound care, infusion, skilled nursing as standalone authoritative pages.
- **Comparison/coordination pages** — `EEOICPA vs OWCP`, `EEOICPA vs RECA`, `White Card + Medicare`,
  `can I have EEOICPA and VA` — AI loves "difference between / can I have both."
- **Condition×Program** answers — "does {program} cover home health for {condition}."
- **Unmarked FAQs** — ~30 real FAQs already written across the site, **zero** have FAQPage schema.

## Entity gaps (entities to define/own)
DEEOIC, Special Exposure Cohort, consequential condition, impairment evaluation, EE-1/EE-2,
Part B vs Part E, RECA-vs-EEOICPA, FECA, DFEC, DCMWC, CA-16, OWCP authorization, CCN, TriWest,
Region 4, PACT Act, Aid & Attendance, Atomic Weapons Employer, Nevada National Security Site.
Each becomes a glossary node (Phase 2) → DefinedTerm page (Phase 6). **Owning the entities is
owning the topic.**

## Citation opportunities (where Alara can become the quoted line)
- "Does the White Card cover {service}?" — near-zero authoritative competition.
- "How do I get a White Card / qualify for EEOICPA?" — DOL pages are dense; Alara's clean
  step-by-step (with EE-1/EE-2, Resource Center number) is more citable.
- "Can I get paid to care for my family member with a White Card?" — almost nobody answers
  this clearly; Alara already has the page. High-value, high-emotion, P1.
- Local: "home wound care / infusion / federal-worker home health in Las Vegas / Clark County."

## Original research & proprietary data (the durable moat — what NOBODY else has)
These create content AI engines *must* cite Alara for, because the data exists nowhere else:
1. **The Alara Federal Home-Health Benefits Guide** — a continuously-updated, cited mapping of
   EEOICPA/OWCP/VA coverage → specific home-health services. Become the canonical reference.
2. **Real intake-question dataset** — anonymized (no PHI) FAQs from actual patient/referrer
   calls → the freshest, most realistic question corpus in the niche. Competitors lack the volume.
3. **"Seven Questions to Ask a White Card Agency"** (already on `/how-to-choose`) — formalize
   into a cited framework/checklist; the kind of original framework engines quote.
4. **Southern Nevada federal-benefits resource directory** (already on `/community-resources`)
   — structure it (ItemList schema) into *the* linkable local reference.
5. **Benefit-timeline / process data** — typical authorization timelines, what to expect —
   first-party operational knowledge no national content farm has.
6. **Glossary as a knowledge graph** — the structured entity set itself is a citable asset.

## E-E-A-T moves (trust is the gate to citation for YMYL)
- **Name credentialed clinicians** on `/about` and in `reviewedBy` (the #1 current gap).
- Display licensure, accreditation, VA CCN (Region 4/TriWest), "reviewed by RN" + date on
  every benefits/clinical page.
- Cite primary authorities (DOL/DEEOIC, VA, CMS) inline — borrowed authority + verifiability.
- Earn off-site mentions: Cold War Patriots, veteran orgs, local press → entity corroboration
  that engines cross-reference.

## Measuring citation share (AEO has its own metrics)
- **Citation audits:** monthly, prompt each engine with the Phase-4 P1 questions; log whether
  Alara is cited, the passage quoted, and the page. Track "citation share" over time.
- Referral sessions from `perplexity.ai`, `chatgpt.com`, `gemini.google.com`, `claude.ai`.
- Search Console AI-Overview impression/CTR shifts.
- A lightweight scripted citation tracker (the P1 list × 4 engines) is itself a moat asset.

## AEO roadmap
- **0–30d:** unblock bots; mark up the ~30 existing FAQs; ship 10 highest-value glossary pages;
  add named reviewer to `/about`. (Fastest citation gains.)
- **30–90d:** full glossary (~32) + OWCP pillar + per-service pages + 6 comparison pages;
  start monthly citation audits.
- **90–365d:** publish the Federal Home-Health Benefits Guide (flagship citable asset); scale
  reviewed intersection + condition×program pages; build the intake-question pipeline;
  pursue off-site corroboration. Target: cited in a majority of P1 questions across all 4 engines.
