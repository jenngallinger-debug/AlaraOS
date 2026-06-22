# Alara — Federal-Benefits & Care-at-Home Authority Engine

The plan to make Alara Home Care the single most authoritative (and most AI-cited) source on
EEOICPA / White Card / DOE & nuclear worker benefits, OWCP / FECA, federal & postal worker home
health, veteran home health, and home-based wound care, infusion, and complex-chronic care —
for Las Vegas / Clark County / Southern Nevada first, national second.

**Not a redesign.** No colors, fonts, or branding. Pure information architecture, knowledge
graph, content, schema, and AEO. Built on a real crawl of the live site (June 2026).

## The 8 phases
1. [Inventory & audit](phase-1-inventory.md) — every live page scored; keep/expand/consolidate/remove; live bugs found
2. [Knowledge graph](phase-2-knowledge-graph.md) — the entity model (+ `../content/data/knowledge-graph.json`)
3. [Content clusters](phase-3-content-clusters.md) — pillars, supporting, FAQ, glossary, intersection — the build spec
4. [Question engine](phase-4-question-engine.md) — patient-first scoring + bank (+ `../content/data/questions.csv`)
5. [Programmatic system](phase-5-programmatic-templates.md) — 7 YMYL-safe templates + the review gate
6. [Schema architecture](phase-6-schema.md) — layered JSON-LD for every page type
7. [AEO domination](phase-7-aeo-domination.md) — how Alara becomes the cited source in ChatGPT/Claude/Gemini/Perplexity
8. [Execution priorities](phase-8-execution-priorities.md) — ranked recommendations + 30/90/365-day plan

## The thesis in five lines
- The niche is **high-stakes, entity-dense, and has no incumbent authority** — winnable.
- The live site already holds **~7,000+ words of strong EEOICPA content** — build on it, don't replace it.
- **The site currently blocks AI crawlers** — flipping that is the literal on/off switch for AEO.
- **Own the entities** (glossary) + **answer the patient-intent questions** + **prove coverage**
  (benefit/intersection pages), all **clinician-reviewed and source-cited**.
- The **SME review gate is the moat**: it's exactly the cost competitors won't pay, and exactly
  what AI engines require to cite YMYL content.

## Start here (week 1, highest patient-weighted ROI)
Unblock the bots · mark up the ~30 existing FAQs · fix the (702)000-0000 bug + 301 the `-1`
dupes · activate the VA page · name credentialed clinicians · ship the top 10 glossary +
top 10 P1 question pages. See [Phase 8 → Next 30 days](phase-8-execution-priorities.md).
