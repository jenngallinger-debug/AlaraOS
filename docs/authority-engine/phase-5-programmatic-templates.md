# Phase 5 — Programmatic Content System (Healthcare-Grade)

> Scale without sludge. Templates supply **structure**; SME-reviewed data supplies
> **substance**. No page indexes until it clears the gate. This is what makes the corpus
> AI-citable *and* defensible — and what competitors won't replicate.

## The non-negotiable gate (every generated page)
```
data row → validity check (is this TRUE for Alara, per a cited authority?)
         → render (HTML + JSON-LD)
         → QUALITY GATE:  ☐ truthful + cited  ☐ ≥50% unique body  ☐ SME-reviewed (named)
                          ☐ answers a real asker  ☐ schema valid in CI
         → pass → Published + in sitemap        fail → noindex/draft
```
Re-review cadence: **quarterly** (benefits rules change; `lastReviewed` keeps E-E-A-T fresh).

## Universal page contract (shared by all templates)
1. **H1** = the question/claim, in the asker's words.
2. **Direct answer block** (40–60 words) — the citable passage — + a visible **source line**
   (DOL/VA/CMS link). Models extract this; humans trust it.
3. **Body** (cell-specific, ≥50% unique) with extractable lists/tables.
4. **"How Alara helps"** (local + trust: nurse-led, DON review, 2-hr response).
5. **Related links** (pillar ↑, siblings ↔, glossary terms, matching question).
6. **FAQ block** (FAQPage schema).
7. **Contextual CTA** (P/R/C/L per page).
8. **Byline + reviewer + lastReviewed** (E-E-A-T → `author`/`reviewedBy` in JSON-LD).
9. Breadcrumbs (+ schema).

---

## TEMPLATE A — FAQ page  (`/questions/{slug}`, pillar FAQ blocks)
**Fields:** `question, leadAnswer(40-60w), sourceUrl, detail, relatedQuestions[], programRef, serviceRef, reviewer, lastReviewed`
**Schema:** `FAQPage` (or `QAPage` for single-Q) + `BreadcrumbList` + org ref.
**Rule:** one accepted answer, sourced. Long-tail Qs render as entries inside a pillar's
FAQPage rather than thin standalone pages.

## TEMPLATE B — Benefit page  (`/eeoicpa-home-health`, `/owcp-home-health`, `/va-home-health-eligibility`)
**Fields:** `program, benefit, coversFlags{}, eligibilitySummary, costStatement, authorizationSteps[], sourceUrls[], faqs[], reviewer`
**Sections:** What's covered (table) · Who qualifies · What it costs ("generally $0 for approved…") · How to start · FAQ.
**Schema:** `MedicalWebPage` + `Service` + `FAQPage` + `GovernmentService` ref.
**YMYL rule:** coverage stated as "generally covered / may be covered when authorized," never a guarantee; every claim cites the program authority.

## TEMPLATE C — Glossary / DefinedTerm page  (`/glossary/{term}`)
**Fields:** `term, shortDefinition(2-3 sentences), longExplanation, whoItAffects, relatedTerms[], sourceUrls[], reviewer`
**Sections:** Definition (quotable, first) · In plain terms · Who it affects · Related terms · Sources.
**Schema:** `DefinedTerm` (in `DefinedTermSet`) + `MedicalWebPage` + optional `FAQPage`.
**Why:** highest citation yield per page; the answer-engine workhorse.

## TEMPLATE D — Condition page  (`/conditions/{condition}`)
**Fields:** `condition, plainDescription, homeCareApproach, treatingServices[], coveringPrograms[], whenToSeekCare, sourceUrls[], reviewer`
**Sections:** What it is · How it's managed at home · Services that treat it (→ links) · Programs that cover that care (→ links) · FAQ.
**Schema:** `MedicalCondition` (+ `possibleTreatment` → service `@id`s) + `FAQPage`.
**YMYL rule:** educational, not diagnostic; "talk to your physician" framing; reviewed by clinician.

## TEMPLATE E — Service page  (`/services/{service}`)
**Fields:** `service, clinicalDescription, conditionsTreated[], howVisitsWork, coveringPrograms[], localArea, faqs[], reviewer`
**Sections:** What it is · What our nurses/therapists do · Conditions treated (→ links) · Coverage by program (→ links) · Service area · FAQ.
**Schema:** `Service` / `MedicalProcedure` / `MedicalTherapy` + `HomeHealthCare` provider ref + `FAQPage`.

## TEMPLATE F — Comparison / coordination page  (`/eeoicpa-vs-owcp`, `/can-i-have-eeoicpa-and-va-benefits`, `/white-card-and-medicare`)
**Fields:** `entityA, entityB, comparisonRows[{dimension, a, b}], canCombine(bool+explanation), recommendation, sourceUrls[], reviewer`
**Sections:** Quick answer (can you have both / which applies) · Side-by-side table · Key differences · How they coordinate · FAQ.
**Schema:** `MedicalWebPage` + `FAQPage` + `DefinedTerm` refs for both entities.
**Why:** comparison/"can I have both" queries over-index in AI answers — high authority yield, low competition.

## TEMPLATE G — Geographic page  (`/locations/{city}`, `/{service}-{city}`)
**Fields:** `geo, areaServed[], programsServed[], servicesOffered[], localResources[], nap, faqs[]`
**Sections:** Home health in {city} · Who we serve locally (federal/DOE/veteran) · Services · Local resources (→ /resources) · Contact.
**Schema:** `LocalBusiness` (specific `areaServed`) + `MedicalWebPage` + `FAQPage`.
**YMYL/quality rule:** real local substance (NTS context, VA SNHS, DOL Resource Center) — no "spun city pages." Build only cities Alara actually serves.

---

## Generation engine (data → page)
- Source: `content/data/knowledge-graph.json` (entities/edges) + per-type data rows
  (`content/data/*.csv|json`) + `content/data/questions.csv`.
- `lib/renderers/*` map each template to HTML + layered JSON-LD (Phase 6).
- `scripts/build.js` renders only rows with `status: Published`; emits segmented sitemaps.
- `scripts/validate-schema.js` + linkcheck + orphan-check run in CI; invalid → build fails.
- Editorial workflow (`Draft → SME review → Approved → Published`) lives in an admin
  table (Airtable or DB). New page = new approved row, never a hand-built file.

## Volume plan (quality-gated, not max-volume)
| Wave | Pages | Templates |
|---|---|---|
| 1 | ~32 glossary + 12 service + 10 condition | C, D, E |
| 2 | ~15 benefit + 6 comparison | B, F |
| 3 | ~25 intersection (Program×Service, Condition×Program) | B/F hybrid |
| 4 | ~4 location + question pages from P1 list | G, A |
Ship ~100 high-authority pages reviewed, not 5,000 thin ones. The gate is the moat.
