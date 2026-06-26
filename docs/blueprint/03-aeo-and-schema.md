# 03 — AEO Strategy & Schema Architecture

> AEO = Answer Engine Optimization: being the **cited source** inside ChatGPT, Claude,
> Gemini, Perplexity, and Google AI Overviews. Different from SEO: the goal isn't a click,
> it's becoming the sentence the model quotes. Schema is the machine-readable substrate
> that makes that reliable, so the two are designed together.

---

## Part 1 — AEO strategy

### Why Alara can win this
AI answer engines reward **specific, well-structured, authoritative answers on narrow
topics with little competition.** "EEOICPA home health," "White Card covered services,"
"OWCP infusion coverage," "consequential conditions" are exactly that: high-stakes,
under-served, entity-dense niches. No large publisher owns them. A focused operator with
real clinical + benefits expertise can become *the* source.

### The four AEO content types (build in this order)

**1. Entity definitions (`/glossary/`)** — one page per entity, each opening with a clean,
quotable 2–3 sentence definition. This is the single most "citable" format.
Pattern for every glossary page:
> **What is a White Card?** *(H1 as the question)*
> A **White Card** is the medical benefits identification card issued under the Energy
> Employees Occupational Illness Compensation Program Act (EEOICPA) that lets approved
> workers receive covered medical care — including home health — at no out-of-pocket cost…
> *(then: who issues it, what it covers, who qualifies, related terms, sources)*

Seed entities: White Card, EEOICPA, OWCP, FECA, Consequential Condition, Special Exposure
Cohort, DEEOIC, Community Care Network (CCN), Skilled Nursing, Infusion Therapy, Wound Care,
Hospital-at-Home, Care Coordination, Home Health Aide.

**2. Structured answer pages (`/questions/`)** — one URL per real question, answered in the
**inverted-pyramid** shape models love: direct answer first (40–60 words), then detail, then
context, then FAQ schema. Seed from the 7 EEOICPA FAQs already on the live site, then expand:

- What is a White Card?
- How do I qualify for EEOICPA?
- Does OWCP cover home health?
- Can veterans receive home health services?
- What is the difference between EEOICPA and OWCP?
- How do federal workers qualify for home care?
- Does EEOICPA cover wound care?
- Can OWCP pay for infusion therapy?
- Does the White Card cover home health care? *(live)*
- Do I pay anything for White Card home health services? *(live)*
- What is a consequential condition under EEOICPA? *(live)*
- Can I use the White Card and Medicare at the same time? *(live)*

**3. FAQ hubs** — every pillar (EEOICPA, OWCP, VA, each service) ends with an FAQ block
marked up with FAQPage schema. Questions are mined from: existing site, "People Also Ask,"
real intake-call questions (huge moat — see `06`), and Perplexity/ChatGPT follow-ups.

**4. Question clusters** — groups of related `/questions/` pages interlinked + rolled up
into the relevant pillar, so a model crawling one answer finds the whole authoritative set.

### Content rules that make answers get cited (the "answer contract")
- **Lead with the answer.** First sentence directly answers the H1 question.
- **Self-contained passages.** Each section makes sense quoted in isolation (models extract
  passages, not whole pages).
- **Name the entity explicitly and consistently** ("the White Card," not "it").
- **Cite primary authorities** (DOL/DEEOIC, dol.gov/owcp, va.gov) with visible source lines
  → builds the trust models look for and keeps YMYL claims defensible.
- **Date-stamp** ("Reviewed June 2026 by [RN/credential]") — freshness + E-E-A-T.
- **Tables and short lists** for "what's covered" — highly extractable.
- **Plain language**, 8th–9th grade reading level.

### Measuring AEO (it's not in classic analytics)
- Track referral traffic from `chat.openai.com`, `perplexity.ai`, `gemini`, `claude.ai`.
- Periodically **prompt the engines** with target questions and log whether Alara is cited
  (manual at first; scriptable later — a lightweight "citation tracker" is part of the moat).
- Watch Search Console for AI-Overview-driven impression/CTR shifts.

---

## Part 2 — Schema architecture

> Strategy: **layered JSON-LD**, server-rendered on every page. A site-wide organization
> graph establishes the entity "Alara Home Care"; page-level types describe each page;
> they connect via `@id` references so engines build one coherent knowledge graph.

### Global graph (every page, in `<head>`)
- `MedicalOrganization` **+** `HomeHealthCare` **+** `LocalBusiness` describing Alara, with
  stable `@id` (e.g. `https://www.alarahomecare.com/#organization`), NAP, `geo`, `areaServed`
  (Clark County / Las Vegas / Henderson / North Las Vegas), `medicalSpecialty`, `telephone`,
  `openingHours`, `sameAs` (GBP, social, NPI if applicable).
- `WebSite` with `SearchAction`.

### Per-page-type mapping
| Page type | Primary schema | Notes |
|---|---|---|
| Homepage | `MedicalOrganization` + `WebSite` | the canonical org node |
| Service page | `MedicalProcedure` / `Service` + `HomeHealthCare` | one per service |
| Condition page | `MedicalCondition` | symptoms, possibleTreatment links to services |
| Glossary page | `DefinedTerm` (+ `DefinedTermSet` for the glossary) | the citation workhorse |
| Question page | `FAQPage` or `QAPage` | `Question`/`Answer` with the lead answer as `acceptedAnswer` |
| Pillar w/ FAQ | `MedicalWebPage` + `FAQPage` | |
| Guide / article | `Article` / `MedicalWebPage` + `author`/`reviewedBy` | E-E-A-T: real, credentialed reviewer |
| Program × Service | `MedicalWebPage` + `Service` + `FAQPage` | links org + service |
| Physician pages | `MedicalWebPage` + `Physician`/referral intent | |
| All pages | `BreadcrumbList` | |
| Location pages | `LocalBusiness` w/ specific `areaServed` | |

### E-E-A-T fields that matter for medical/YMYL
- `author` and **`reviewedBy`** (a real, named, credentialed clinician — RN/DON).
- `dateModified` / `lastReviewed`.
- `citation` / `isBasedOn` pointing to DOL/VA/CMS primary sources.
- `MedicalOrganization.medicalSpecialty`, `availableService`.

### Example: glossary page JSON-LD (the citable workhorse)
See `content/_examples/glossary-white-card.jsonld` for a complete, copy-pasteable example
combining `DefinedTerm` + `FAQPage` + `BreadcrumbList` + org reference.

### Implementation note
Schema must be **server-rendered and templated from the content model** (not hand-authored
per page) so it stays correct at programmatic scale. The content model (`05`) carries the
fields; the renderer emits JSON-LD deterministically. Validate every template against
Google Rich Results Test + schema.org in CI.
