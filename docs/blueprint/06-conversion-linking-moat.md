# 06 — Conversion Architecture, Internal Linking & Data Moat

---

## Part 1 — Conversion architecture (trust-first, no aggressive marketing)

This audience — ill DOE workers, injured federal/postal employees, veterans, and their
families and physicians — converts on **trust and clarity**, not urgency tactics. Every page
offers a calm, contextual next step toward the right pathway.

### Three pathways, always available
1. **Patient / family pathway** → `Find Out If You Qualify — Free 10-Minute Call`
   (preserve this excellent existing CTA), `Request Care`.
2. **Physician / referrer pathway** → `Refer a Patient` (the 2-business-hour response
   guarantee is a strong, real differentiator — feature it).
3. **Eligibility/learn pathway** → for top-of-funnel readers not ready to call:
   "Check what your White Card covers," guides, glossary — capture via soft asset.

### Page-type → primary CTA mapping
| Page type | Primary CTA | Secondary |
|---|---|---|
| Glossary / question | "See if you qualify — free 10-min call" | link to relevant program pillar |
| Service page | "Request care" | "Refer a patient" |
| Program pillar (EEOICPA/OWCP/VA) | "Find out if you qualify" | "Get a White Card" / eligibility |
| Condition page | "Talk to a nurse about [condition] care" | service links |
| Programmatic intersection | both patient + referrer | related links |
| Physician pages | "Refer a patient" (form + direct line) | "What to expect" |

### Conversion design rules
- **Contextual, not generic:** CTA copy references the page topic ("Ask about EEOICPA wound
  care coverage"), not a blanket "Contact us."
- **Reduce friction:** phone (tel: link, prominent), 10-minute call framing, 2-hour response
  promise, "no cost to approved beneficiaries" reassurance.
- **Trust blocks on every page:** nurse-led, DON reviews every case, licensure, real reviews,
  named clinical reviewer (also feeds E-E-A-T schema).
- **Forms feed a real pipeline** (`05` endpoints → CRM/email), with referral vs patient
  routing and instant acknowledgment.
- Microconversions tracked: call clicks, form starts/finishes, guide downloads, eligibility
  checks — so AEO/SEO traffic quality is measurable.

---

## Part 2 — Internal linking strategy

Internal links do three jobs here: distribute authority to money pages, help engines build
the entity graph, and guide humans to conversion.

**Rules:**
- **Hub-and-spoke:** every spoke links up to its pillar; every pillar links down to all spokes.
- **Entity mesh:** first mention of any entity (White Card, OWCP, consequential condition,
  CCN) links to its `/glossary/` page. Consistent anchor text = consistent entity signals.
- **Intersection triangulation:** each programmatic page links to its program pillar + its
  service/condition page + the matching `/questions/` page (and 2–4 siblings).
- **Question clusters:** related `/questions/` interlink and roll up to the pillar.
- **Contextual, descriptive anchors** (never "click here"); cap ~3–6 in-body links per
  ~1,000 words to stay natural.
- **No orphans:** CI link-graph check fails the build if any page has < 2 internal inlinks.
- **Breadcrumbs** provide a structural link on every page (+ Breadcrumb schema).
- Linking is **templated from the content model** (`lib/links.js`) so it scales correctly
  and stays consistent as pages are generated.

---

## Part 3 — Data moat (what competitors can't copy)

The defensible asset is **proprietary, expert, locally-grounded knowledge about federal
benefits + home health** — compiled, structured, reviewed, and continuously refreshed.

### Moat sources
1. **Real intake-call question bank.** Every call surfaces real questions patients/referrers
   ask. Logged + (anonymized, no PHI) turned into glossary/question/FAQ content. This is the
   richest, least-copyable AEO fuel — competitors don't have Alara's call volume.
2. **Benefits-rules knowledge base.** A maintained, cited mapping of EEOICPA/OWCP/VA coverage
   to specific services/conditions — kept current as rules change. Hard to assemble, harder
   to keep fresh; `lastReviewed` dates make the freshness visible to engines.
3. **Local depth.** Nevada Test Site / DOE worker context, VA Southern Nevada specifics,
   Clark County resource directory — hyper-local authority national competitors won't build.
4. **Clinical E-E-A-T.** Named, credentialed RN/DON reviewers on every YMYL page — a real
   signal that generic content farms and out-of-state agencies can't fake.
5. **Citation-tracking feedback loop.** Monitor which pages get cited by AI engines, then
   double down on those formats/topics — a compounding advantage.
6. **Structured glossary/entity set** as a reusable knowledge graph powering every page,
   FAQ, and intersection — the more it grows, the cheaper each new authoritative page becomes.

### Moat compounding
Volume of reviewed, cited, locally-specific answers → more citations → more authority →
more referrals → more calls → more real questions → more content. The flywheel, not any
single page, is the moat. **Guard it:** keep the review bar high; thin generated pages would
poison the well.

### Compliance guardrails (protect the moat AND the business)
- No PHI in published content or logs; anonymize all call-derived material.
- Every benefits/coverage claim cites a primary authority (DOL/VA/CMS) and is SME-reviewed.
- "May be covered / generally covered" framing, not guarantees, on eligibility-dependent claims.
- Human approval before any outreach; nothing about a specific patient is published.
