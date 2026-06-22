# AlaraOS — Architecture

**The Federal Benefits Intelligence Platform.** A trusted information, navigation, education,
and care-at-home resource for everyone in the federal healthcare-benefits ecosystem — EEOICPA
claimants, DOE / Nevada Test Site / Tonopah Test Range / Atomic Weapons Employer workers,
federal & postal workers, veterans, families, physicians, Resource Centers, authorized
representatives, case managers, and home-health providers.

> **Core stance:** AlaraOS *helps* Resource Centers, physicians, attorneys, authorized
> representatives, and federal agencies — it does not replace them. Every page and tool
> carries that disclaimer in the chrome. It reduces confusion and improves navigation to
> benefits people **already** have.

This MVP is **running and verified** (see "Status" per objective). It builds directly on the
prior deliverables: the [knowledge graph](../authority-engine/phase-2-knowledge-graph.md),
[schema](../authority-engine/phase-6-schema.md), [AEO](../authority-engine/phase-7-aeo-domination.md),
and [programmatic](../authority-engine/phase-5-programmatic-templates.md) plans.

---

## Run it
**Production (canonical):** Node, zero dependencies → `cd alaraos && npm start` → http://localhost:3000
Deploys to Render as a Node web service. `server.js` is the source of truth.

**Dev-preview (no Node needed):** `python3 alaraos/preview_server.py` → same pages from the same
data + client assets. Used to verify in environments without a JS runtime. Keep in parity with `server.js`.

**Pre-flight check:** `python3 alaraos/scripts/validate_data.py` — validates that every Navigator
branch resolves, every answer maps to a real glossary term, and every graph edge references a real
node. Currently **0 errors**.

---

## The 8 objectives → architecture

### 1. Knowledge graph — ✅ BUILT
`content/data/knowledge-graph.json` — 57 entities, 24 relationships across five domains
(programs, beneficiaries, services, conditions, geography). Loaded by `lib/content.js`, rendered
at `/graph`, exposed as JSON at `/api/graph`. Edges use typed relationships
(`administeredBy`, `qualifiesFor`, `covers`, `treats`, `coordinatesWith`, `serves`) — the exact
paths an AI engine traverses to decide whom to cite. Entity model detail in
[phase-2](../authority-engine/phase-2-knowledge-graph.md).

### 2. Content operating system — ✅ BUILT (glossary) · 🧩 DESIGNED (full set)
Content is **data, not pages.** `data/glossary.json` carries each entry's definition, plain
explanation, audience, relations, sources, **and trust metadata** (reviewer, lastReviewed,
version, status). `lib/render.js` + `lib/schema.js` turn a data row into HTML + layered JSON-LD
deterministically — so SEO, AEO, internal linking, conversion, and schema are produced by the
renderer, not hand-authored. The 9 content types (pillars, guides, FAQs, glossary, comparisons,
program/condition/service/geographic pages) share this model; glossary is implemented as the
reference type. Templates for the rest: [phase-5](../authority-engine/phase-5-programmatic-templates.md).

### 3. Navigation layer — ✅ BUILT
Users **start anywhere → reach an answer.** The home page exposes six entry points (program,
who-I-am, condition, service, question, geography); each opens the Benefit Navigator at the right
node. The Navigator is a single data-driven decision tree (`data/navigator.json`, 28 nodes, 15
answer cards, all reachable) served at `/api/navigator` and driven by `public/navigator.js`.
*Verified end-to-end:* EEOICPA → home health → "Yes — the White Card generally covers home health"
with covered list, DOL citation, glossary link, CTA, and trust note.

### 4. Tools — ✅ BUILT (Benefit Navigator) · 🧩 SCAFFOLDED (rest)
The home `/` lists the tool suite with status tags. **Benefit Navigator** is live. White Card
Explainer, Consequential Condition Guide, Impairment Evaluation Timeline, OWCP Home Care Guide,
and Veteran Benefit Navigator are scaffolded (currently route to their glossary entries) and
become guided flows by adding nodes/templates — no new framework required. Each tool is a
thin view over the same graph + content model.

### 5. Trust infrastructure — ✅ BUILT
Engineered, not assumed — appropriate for YMYL. Every content row carries `reviewer`,
`lastReviewed`, `version`, and `status` (`draft → review → approved → published`); only
`published` is meant to be indexed/cited. Source citations (DOL/VA/CMS) are required fields and
surface on every page + in JSON-LD `citation`/`reviewedBy`. The `/trust` page renders a live
content register (term · status · reviewer · last-reviewed · version) and documents the review
workflow, citations, version history, and update tracking. The platform never determines
eligibility or files claims — stated in the chrome on every page.

### 6. Data moat — ✅ BUILT (capture) · 🧩 DESIGNED (insight layer)
`POST /api/event` captures **anonymous** navigation signal (no PII, no IP) to `data/analytics.log`
as JSONL: which entry points are used, which questions are chosen, which answers are reached,
where users dead-end. *Verified:* a full journey logged as `navigate → choose → … → reach_answer`.
This is the raw material for the four moat datasets (question demand, benefit gaps, navigation
patterns, educational analytics) — the proprietary, hard-to-copy asset. Strategy:
[phase-7 §moat](../authority-engine/phase-7-aeo-domination.md) and
[data-moat doc](../docs/06-conversion-linking-moat.md).

### 7. AI visibility — ✅ BUILT (substrate) · 🧩 ONGOING (program)
Every page is **server-rendered HTML with layered JSON-LD** (DefinedTerm, MedicalWebPage,
FAQPage-ready, BreadcrumbList, MedicalOrganization) — directly readable by ClaudeBot/GPTBot/
PerplexityBot. The org node declares `knowsAbout` for the core topics. Self-contained, sourced,
entity-named answers are the citation format. The remaining work is the *program* (unblock
crawlers on the live site, citation audits, original-research assets) in
[phase-7](../authority-engine/phase-7-aeo-domination.md).

### 8. Roadmap — 🧩 DESIGNED
- **Phase 1 — Authority & knowledge graph:** ✅ graph + glossary + schema + trust infra built; expand glossary to the full entity set; publish (SME-review) the draft terms.
- **Phase 2 — Tools & navigation:** ✅ Navigator + nav layer built; build out the remaining five tools; widen the decision tree (OWCP/VA/condition depth).
- **Phase 3 — Research & insights:** turn the analytics capture into dashboards (question demand, benefit gaps); publish the proprietary Federal Home-Health Benefits Guide.
- **Phase 4 — Federal Benefits Intelligence Platform:** open APIs/partner views for Resource Centers, case managers, and providers; national expansion beyond Southern Nevada.

---

## System shape
```
 data/ (source of truth)                lib/ (deterministic renderers)          routes (server.js / preview_server.py)
 ├─ knowledge-graph.json  ──┐           ├─ content.js  (load + graph helpers)   /                home (entry points + tools + stats)
 ├─ glossary.json         ──┼─────────► ├─ schema.js   (layered JSON-LD)  ────► /navigator        Benefit Navigator (tool)
 ├─ navigator.json        ──┘           └─ render.js   (HTML + chrome)          /glossary[/:slug]  content OS (DefinedTerm + schema)
 └─ analytics.log  ◄── POST /api/event (data moat)                              /graph             knowledge graph + /api/graph
                                                                                /trust             trust infrastructure register
 public/ app.css · navigator.js (client wizard)                                 /api/navigator     decision tree JSON
```

## Why this stack
Structured, mostly-stable content → **server-rendered, data-driven, near-zero-JS** pages: fastest
loads, perfect crawlability, server-rendered schema, lowest operating complexity — exactly what
SEO, AEO, and Core Web Vitals reward. Node for production (Render); the Python adapter exists only
so the platform is runnable/verifiable anywhere. Complexity is added only when a real need appears
(e.g., authenticated partner portal in Phase 4).
