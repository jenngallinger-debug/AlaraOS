# Alara — Website Experience + Functionality Blueprint

*Source of truth: the repo (Constitution, THE-FACE-OF-ALARA.md, BRAND.md, public/home.html, data/*.json) governs. Notion is the long-form copy quarry, reconciled term-by-term, never pasted. This document is for owner direction before build. Derived from a full map of AlaraOS across the repo and Notion (8 facets).*

---

## 1. The thesis

The Alara website is not a description of the care team. It is the first member of it. A frightened, overloaded person arrives at the worst moment of a family's life, and the site's only job in the first three seconds is to make them think *these people understand my world* and to let them set the weight down. From there it does what every other member of the team does: it carries burden. It teaches the federal benefits no one else will explain, in plain language and cited; it lets a person discover, in a few clicks, the no-cost care they have already earned but were never told about; it takes a single phone number and turns it into someone who is already on it; and once a person is known, it remembers them so they never have to explain themselves twice or chase anyone. It earns trust not by claiming to be trustworthy but by behaving that way: one calm action per screen, no urgency, no dark patterns, the gravest choices left in human hands. Everything it does traces to the Constitution and resolves into three words a family says afterward: *they had us.*

---

## 2. The patient journey the site carries

The site is built around five stages of a single descent from fear to relief. Each stage is one thing the visitor does and one burden the site lifts. This is the spine; every surface in Section 3 hangs off it.

| Stage | What the visitor does | What the site does for them | Burden removed | Moment / commitment |
|---|---|---|---|---|
| **1. Discover** | Lands from AI search, Google, or a referral. Reads the threshold. Is recognized before anything is sold. | Names the visitor's exact situation before any program or credential. One quiet action. | "I'm alone and I don't even know where to start." | Recognition first; Human Primacy; Preamble |
| **2. Understand** | Reads a glossary term, opens an education card, or browses a program guide at their own depth. | Teaches the benefits no competitor explains, clinician-reviewed and source-cited, at an 8th-grade reading level, with no sales. | "I have to decode a government website alone." | Truth told plainly; Integrity; "education is care delivered before clinical services" |
| **3. See what you qualify for** | Starts the Benefit Navigator from wherever they already are ("my dad worked at the Test Site," "a wound that won't heal") and reaches a cited answer. | Surfaces what they MAY qualify for and, critically, what they are MISSING (consequential conditions, paid family caregiver, White Card + Medicare). Never determines, always routes to DOL/VA/physician. | "No one ever told me this care could be free." | Burdens disappear; one step ahead; Authority & Consent (informs, never decides) |
| **4. Begin** | Tells the site what's going on in their own words and a phone number. Or just calls. | Infers who they are, collects only name + phone, assumes ownership, and (live mode) creates real OS state. Returns a named owner, an honest contact window, a reference ID. | "The burden of beginning." | Nothing falls through; promises kept; Accountability |
| **5. Be carried** | Returns via a tokenized link to see status. Family gets their own view. Survivors find quiet help. A satisfied family points a neighbor. | Shows outcomes only (received, requested, scheduled, handled), never the machinery. Remembers them across the consent boundary so no one re-explains. | "Did my inquiry vanish? Do I have to chase this?" | Never chase anyone; someone remembers; Human Sovereignty; Continuity |

The through-line: **the visitor stops being the coordinator.** The page begins carrying before any human speaks.

---

## 3. The functional surfaces

Ordered by patient value and asset-readiness. Build-state tags: **[asset exists]** running or coded today; **[spec only]** designed, not built; **[needs content]** blocked on a human decision/copy.

### A. The Threshold homepage — *the first member of the care team* **[asset exists]**
- **Does:** The six-stop emotional descent already shipped in `public/home.html`: Threshold hero → The Tangle → family-voice Moments + the "They had us" seal → anonymous founder → "And it's real" credential strip → the arched Invitation. One calm action per screen, single 220ms reduced-motion-safe fade.
- **Powers it:** `public/home.html`, `public/tokens.css`, `BRAND.md`, `THE-FACE-OF-ALARA.md`. Real phone `(702) 814-9630`. Hero photo `hero-arches.webp`.
- **Experience:** Arriving feels like relief, not shopping. Cortisol drops because the anxiety-producing things (pop-ups, countdowns, lunging chat) are simply absent.
- **Serves:** Preamble; Human Primacy; the experience moments; restraint = Authority & Consent + Human Sovereignty.
- **Conflict to flag:** the live hero leads with a benefits *claim*, which is closer to BRAND.md/Notion than to THE-FACE-OF-ALARA's "recognition-only hero, programs as reward" rule. Owner decision (§6).

### B. Federal Benefits Library (glossary) — `/glossary` + `/glossary/:slug` **[asset exists, needs content]**
- **Does:** One quotable entity per page. H1 as a question, a 2–3 sentence citable definition, an "In plain terms" 8th-grade explanation, "who it affects," related-term links, and a visible Trust block (reviewer, last-reviewed, version, sources). Emits layered DefinedTerm + MedicalWebPage + FAQPage JSON-LD.
- **Powers it:** `data/glossary.json` (14 terms, rendering), `lib/schema.js`, `content/_examples/glossary-white-card.jsonld` as template. Knowledge graph (`content/data/knowledge-graph.json`, 57 nodes) wires the @ids and anticipates ~32 terms.
- **Serves:** Integrity (true, sourced, clinician-reviewed); the AEO citation workhorse.
- **Blocker:** every `reviewer` field is `"TODO Reviewer, RN"` and every term is `status: draft`. Nothing here should be indexed until a named credentialed reviewer is wired in. Single biggest E-E-A-T lever.

### C. Benefit Navigator — `/navigator` (+ `?node=` deep links) **[asset exists]**
- **Does:** Start-anywhere wizard (my program / who I am / a condition / a service / a question / my location) walking 25 tree nodes to one of 19 plain-language answer cards. Each card: a clear title, plain answer, a "Generally included" list, your next step, a primary DOL/VA/CMS source link, a glossary "Learn more" link, and a "general information, not a coverage determination" disclaimer. Verified back/start-over/deep-link, no-JS fallback.
- **Powers it:** `data/navigator.json` (25 nodes, 19 `ans-*` cards including missing-benefit paths `ans-paid-caregiver`, `ans-consequential`, `ans-white-card-medicare`, `ans-survivor`, `ans-nts`), `public/navigator.js`, `/api/navigator`. Anonymous `POST /api/event` demand capture.
- **Experience:** in under a minute, without a form, an exhausted caregiver discovers they might be paid and supported for care they already give.
- **Serves:** Human Primacy; Authority & Consent ("AI recommends, never decides"); Benefit Intelligence Engine "no opportunity missed because no one remembered."

### D. Phone-first intake → real OS handoff **[asset exists, fixture mode]**
- **Does:** Conversational intake that starts with the visitor's story in free text, infers visitor type and program hint, collects only name + best phone, then confirms with a named owner, an honest contact window, and a reference ID. Plus tap-to-call everywhere.
- **Powers it:** `apps/web/app/components/IntakeFlow.tsx`, `api-client.ts` → `startConversation()` → `POST /commands/referrals` → `orchestrator.handleReferralReceived()` (creates Patient + Promise + Workflow + Task + Communication + Timeline + DigitalCareTwin). 200 core tests; M0–M3 complete.
- **Serves:** Accountability ("what it says it will do, it does"); "a nurse answers, usually within the hour."
- **Honest gaps:** (1) currently **fixture mode** — returns a hard-coded confirmation, not the live `honestWindow`. (2) web inquiry modeled as a *referral*; Journey Engine not yet wired to web intake. (3) `apps/web` is a *different* visual brand (sage) from `home.html`. One stack must win (§6).

### E. Education cards — layered-depth learning **[asset exists]**
- **Does:** Expandable cards (Overview → More detail → Examples → Expert view) over 6 audience-tagged topics. `getCardsForAudience()` filters by visitor type. Self-contained, no backend.
- **Powers it:** `apps/web/app/lib/education.ts` (real prose), `EducationCard.tsx`.
- **Serves:** "education is journey-driven, taught differently per audience."

### F. "Check my status" / capability-token return path **[spec only]**
- **Does:** A tokenized link (no account) to a read-only status view: referral received, records requested, authorization submitted, SOC scheduled — outcomes only. Shows current owner, next step + honest window, any human-surfaced obstacle.
- **Powers it (designed):** `journey_capability_tokens` + `journey_projections` in `migrations/011`; `engine.ts` issues the token on `start()`. Not wired to web.
- **Serves:** Continuity; never chase anyone; engine invisible.
- **Honest gap:** patient Timeline doesn't yet capture all domain events; v1 should show coarse milestone status, not a granular timeline.

### G. Program pillar pages — `/programs/:slug` (EEOICPA, OWCP, Veterans) **[asset exists in Python, needs content]**
- **Does:** Definitive program references: at-a-glance facts, eligibility, what's covered at home, common misunderstandings, FAQs (FAQPage JSON-LD), related links, sources.
- **Powers it:** `preview_server.py` (3 pillar pages in the Python twin); `content/_examples/programs.json` (some coverage flags marked `verify`); Notion FINAL copy as quarry.
- **Blocker:** coverage facts marked `verify` need SME sign-off before being shown as covered.

### H. Plain-language White Card guide + "commonly missed benefits" **[needs content]**
- **Does:** Public, audience-segmented version of the DON-authored 10-benefit White Card guide and the "10 most commonly missed benefits" table (travel reimbursement, paid family caregiver, consequential conditions, Rx/DME).
- **Powers it:** Notion "White Card Benefits — Complete Plain-Language Guide" — richest, most-quotable source, currently internal-facing.
- **Serves:** burdens disappear; Integrity.
- **Blocker:** internal SOC-training content; needs a voice/compliance pass and removal of the `(702) 000-0000` placeholder before public use.

### I. Community Resources directory **[needs content]**
- **Does:** ~50-entry local directory (food, transport, respite, crisis lines, DOL Resource Center, VA SNHS) as CollectionPage/ItemList — trust + local-authority asset.
- **Blockers:** placeholder phone; a flagged listing needs healthcare-attorney review (anti-kickback); confirm whether "AlaraEco" is retired sitewide.

### J. Trust & Sources register — `/trust` + per-page review chrome **[asset exists, needs content]**
- **Does:** Live content register (term · status · reviewer · last-reviewed · version), the Draft→SME→Approved→Published workflow, citation policy, sitewide disclaimer.
- **Powers it:** `server.js /trust`, glossary metadata.
- **Blocker:** same reviewer-placeholder issue.

### K. Referrer / professional path **[partial asset]**
- **Does:** A co-equal referrer path ("Refer a patient," "Your patients. Our paperwork.") with a program-laned minimal referral form and a one-hour-response promise; later a closed-loop milestone status. Captures source attribution.
- **Powers it:** IntakeFlow visitorType physician/case_manager/attorney; `referralSourceStrength` projection.

### L. Knowledge graph + machine JSON — `/graph`, `/api/graph` **[asset exists]**
- **Does:** Renders the entity/relationship model for humans and exposes it as JSON for AI ingestion.
- **Powers it:** `content/data/knowledge-graph.json`, `lib/schema.js`.

### M. Anonymous demand-signal capture **[asset exists]**
- **Does:** Logs which entry points/questions/answers visitors use and where they dead-end (no PII) to `analytics.log`, feeding which terms/FAQs to write next.
- **Powers it:** `navigator.js logEvent` → `POST /api/event`.

### N. Future-state: authenticated personal benefit map **[spec only]**
- **Does:** The same benefit lens behind login — Current / Pending / Expiring / Potential. Out of scope for v1.

---

## 4. Information architecture

Recognition-first discipline (no generic Services/Who-We-Serve grid) holds throughout; the nav is small and quiet.

```
/                         Threshold homepage (home.html, six-stop descent)        [asset exists]
│   header: wordmark + one phone affordance only
│
├── /qualify (or /navigator)  Benefit Navigator — start-anywhere wizard            [asset exists]
│      ?node=ans-paid-caregiver, ?node=ans-white-card-medicare, …  (deep links)
│
├── /learn                  Education hub (library + cards + guides)
│   ├── /glossary           Federal Benefits Library index                         [asset exists]
│   │   └── /glossary/:slug  one term per page (DefinedTerm/FAQPage JSON-LD)        [needs reviewer]
│   ├── /learn/:cardId      layered education cards (audience-filtered)             [asset exists]
│   ├── /white-card         flagship plain-language guide + commonly-missed         [needs content]
│   └── /questions/:slug    inverted-pyramid FAQ answers (FAQPage schema)           [spec only]
│
├── /programs               program discovery
│   ├── /programs/eeoicpa                                                           [asset: Python only]
│   ├── /programs/owcp                                                              [needs content]
│   └── /programs/veterans                                                          [asset: Python only]
│
├── /begin   (intake)       phone-first conversational intake → /commands/referrals [asset, fixture mode]
│      confirmation: named owner · honest window · reference ID
│
├── /status/:token          capability-token return path — outcomes only            [spec only]
├── /refer                  referrer/professional path (co-equal CTA)               [partial]
├── /resources              Community Resources directory (ItemList)                [needs content]
├── /survivors              quiet survivor & bereavement help                       [spec only]
├── /trust                  Trust & Sources register + review workflow              [asset, needs reviewer]
├── /graph + /api/graph     knowledge graph (human + machine)                       [asset exists]
├── /api/navigator          navigator tree JSON                                     [asset exists]
└── /api/event              anonymous demand capture                                [asset exists]
```

Sitewide chrome: the "helps, does not replace / not a coverage determination" disclaimer; layered JSON-LD with the global `#organization` node (real NAP); one primary action per view; phone-first.

**Unresolved IA fork (foundational):** there are two running stacks — the zero-dependency Node/Python site (`server.js`/`preview_server.py`, currently deployed, owns navigator + glossary + graph + trust + pillar pages) and the Next.js `apps/web` (different sage brand, owns IntakeFlow + the only live OS-backed referral loop). `home.html` is a third, standalone artifact in the canonical brand. The IA assumes a **single consolidated site on the canonical brand**, but which engine hosts it is owner-gated (§6).

---

## 5. Build sequence

### Phase 0 — Decisions + unblockers
- **Pick the stack and brand.** Consolidate onto one engine; `home.html` brand wins. **[decision]**
- **Wire the named clinical reviewer** into `glossary.json` and `lib/schema.js`; move reviewed terms `draft → published`. **[needs content]**
- **Confirm crawlers unblocked** (ClaudeBot/GPTBot/Amazonbot) on the live host. **[verify]**
- **Lock contested copy:** hero positioning, response-time figure, founder anonymous vs named. **[decision]**

### Phase 1 — Ship the carry (highest value, mostly built)
1. **Threshold homepage** — port `home.html` into the chosen stack as `/`. **[asset exists]**
2. **Benefit Navigator** at `/qualify` — already live; most differentiating surface. **[asset exists]**
3. **Federal Benefits Library** `/glossary` — rendering 14 terms; publishable once reviewer wired. **[asset exists]**
4. **Phone-first intake → live OS** — flip IntakeFlow fixture→live; bind to real `honestWindow`. **[asset exists, fixture]**
5. **Trust register** `/trust` — publishable once reviewer wired. **[asset exists]**
6. **Education cards + knowledge graph + demand capture** — carry over. **[asset exists]**

### Phase 2 — Deepen authority + reach
7. **Program pillar pages** (EEOICPA, OWCP, Veterans) — port the 3 Python pillars; resolve `verify` flags. **[asset + content]**
8. **Plain-language White Card guide + commonly-missed benefits** — after voice/compliance pass. **[needs content]**
9. **Expand glossary to ~32 terms** to match the knowledge graph's dangling @ids. **[needs content]**
10. **Question/FAQ pages** with FAQPage schema. **[spec + content]**
11. **Community Resources directory** — after placeholder/legal fixes. **[needs content]**

### Phase 3 — Continuity + the family
12. **Capability-token "check my status"** `/status/:token` — coarse milestones first. **[spec]**
13. **Referrer closed-loop status** via `referralSourceStrength`. **[partial]**
14. **Caregiver/family hub** + **survivor/bereavement path**. **[spec]**
15. **Consent capture surface** → `/commands/consent`. **[spec]**

### Phase 4 — Authenticated benefit lens (deliberately last)
16. **Personal benefit map** (Current/Pending/Expiring/Potential) behind login. **[spec]**

---

## 6. Open decisions for the owner

1. **One stack, one brand.** Consolidate onto a single site in the `home.html`/BRAND.md brand — and which engine hosts it (Node/Python site owns the live education tooling; `apps/web` owns the only live OS referral loop).
2. **Founder: anonymous or named.** *(Owner has confirmed: ANONYMOUS — experience only, no name/face.)* Note this interacts with decision 3.
3. **The named clinical reviewer.** YMYL pages need a real credentialed reviewer name on the glossary/JSON-LD, or they should not be indexed. If the founder stays anonymous, name a clinical reviewer of record (DON) for the content register only. Highest-leverage unlock.
4. **Hero positioning.** Recognition-first vs benefits-claim. Final hero wording still open.
5. **Real vs aspirational, for public claims.** "most families pay nothing," Medicare/CHAP cert + NPI to state publicly, claims-paid timing, one-hour vs two-business-hour response, the `verify`-flagged coverage facts.
6. **v1 scope line.** Recommendation: v1 = Phase 1 + Phase 2. Hold the status page, family/survivor hubs, consent surface, and authenticated benefit map for later (they depend on Journey-Engine-to-web wiring not yet built).
7. **Naming + cleanup:** is "AlaraEco" retired sitewide? Apply the no-em-dash rule to all published patient-facing copy.
