# 04 — Programmatic Content Engine

> A system that generates many high-quality, schema-rich intersection pages from a small
> set of structured data + reviewed templates — **without** producing thin, duplicative,
> or non-compliant YMYL pages that get penalized.

---

## The hard truth about programmatic + healthcare/benefits
Mass-templated pages are exactly what Google's helpful-content / medical E-E-A-T systems
and AI engines distrust. For a YMYL site, naive "spin 5,000 pages" tanks the whole domain.
**So the engine is built around a quality gate, not just a template.** The moat is that
competitors *can't* cheaply replicate reviewed, expert, locally-grounded intersection pages.

**Non-negotiable rule:** every generated page must clear the gate before it can be indexed.

## The three matrices

### 1. Program × Service
Axes: `{EEOICPA, OWCP, Veterans/VA, Medicare}` × `{wound care, infusion therapy, skilled
nursing, PT, OT, home health aide, medical social work, care coordination, hospice,
hospital-at-home}`.
Examples: EEOICPA + Wound Care, EEOICPA + Infusion, OWCP + Home Health, OWCP + Skilled
Nursing, Veterans + Physical Therapy. URL: `/programs-services/{program}-{service}/`.

### 2. Condition × Program
Axes: `{COPD, chronic radiation illness, chronic beryllium disease, Parkinson's, heart
failure, diabetes, stroke, cancer, CKD, …}` × `{EEOICPA, OWCP, Veterans, Medicare}`.
Examples: COPD + EEOICPA, Radiation Illness + EEOICPA, Parkinson's + Veterans, Heart
Failure + OWCP. URL: `/conditions-programs/{condition}-{program}/`.

### 3. Question × Program
Real questions templated across programs/services.
Examples: "Does EEOICPA cover wound care?", "Can OWCP pay for infusion therapy?",
"Does the VA cover home physical therapy?" URL: `/questions/{slugified-question}/`.

**Combinatorics:** these matrices imply hundreds of potential pages. **Do not ship them
all.** Ship the cells that (a) have real search/answer demand, (b) are clinically true for
Alara, and (c) pass review. Start with ~30–50 high-intent cells; expand as data proves them.

## How a page is generated (pipeline)

```
 [content model entry]  →  [eligibility/validity check]  →  [template render]
        (data)                 (is this cell TRUE &              (HTML + JSON-LD)
                                in-scope for Alara?)                    │
                                       │ fail → skip                    ▼
                                       └────────────────►  [QUALITY GATE]
                                                                  │
                              ┌───────────────────────────────────┤
                       reviewer approves                     reject / revise
                              │                                    │
                              ▼                                    ▼
                      published + in sitemap                 stays noindex/draft
```

### Quality gate (must pass ALL to index)
1. **Truthfulness:** the program genuinely covers that service/condition for Alara's
   patients — verified against a cited DOL/VA/CMS source. No speculative coverage claims.
2. **Uniqueness:** ≥ ~50% of body is cell-specific (not boilerplate). Templates supply
   *structure*, humans/SMEs supply the *specific* clinical + benefits substance.
3. **Expert review:** named clinician/benefits SME signs off → populates `reviewedBy`.
4. **Value:** answers a question a real person/referrer actually asks. If you can't name
   the searcher, don't build the page.
5. **Schema valid:** passes Rich Results Test in CI.

## Page template anatomy (intersection page)
Each generated page shares a skeleton but is filled with cell-specific content:
1. **H1 = the intersection as a question/claim** ("Does EEOICPA Cover Wound Care at Home?")
2. **Direct answer block** (40–60 words, the citable passage) + source line.
3. **What's covered** (cell-specific, bulleted/tabled — extractable).
4. **How it works for this program** (authorization path, costs, who qualifies).
5. **Alara's role** (services, local, trust signals).
6. **Related** — links to the 3 parents (program pillar, service/condition page, related
   questions) + 2–4 sibling cells.
7. **FAQ block** (FAQPage schema) — cell-specific Q&As.
8. **Contextual CTA** (patient + referrer pathways — see `06`).

## Data model (drives generation — see `content/_examples/`)
- `programs.json` — id, name, authority, source URLs, covered-service flags, eligibility copy.
- `services.json` — id, name, clinical description, conditions served.
- `conditions.json` — id, name, program-relevance flags, related services.
- `intersections.json` — one row per APPROVED cell: program+service/condition, status
  (draft/review/published), reviewer, lastReviewed, unique body, FAQs, sources.
- `questions.json` — question, answer (lead), program/service refs, sources, reviewer.

The renderer reads these, validates, emits HTML + layered JSON-LD. New page = new reviewed
data row, **not** a new hand-built file. That's the scale lever — gated by the human review
that competitors won't invest in.

## Governance
- A simple **editorial dashboard / table** (Airtable or DB-backed admin) holds the
  intersection rows with a status workflow: `Draft → SME review → Approved → Published`.
- Quarterly re-review cadence (benefits rules change; `lastReviewed` keeps E-E-A-T fresh).
- Sitemap only includes `Published`; everything else is `noindex`.
