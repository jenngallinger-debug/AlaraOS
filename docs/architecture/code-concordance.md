# AlaraOS — Architecture ↔ Code Concordance

## 1. Purpose

This document maps the frozen architecture vocabulary (see `core.md`,
`capabilities.md`, `implementation-pins.md`) to the **existing `@alara-os/core`
implementation** on `main`, so Claude Code can implement against real code
**without inventing architecture**.

It is reconciliation, not implementation. Nothing is renamed, refactored, or
changed here. Where the docs and code diverge, **code is the source of truth**
(engineering-rules.md). Source state: `git HEAD f80dfa1`.

---

## 2. Architecture → Code Mapping

| Architecture concept | Definition (frozen) | Existing code module(s) | Existing tests | Status | Notes |
|---|---|---|---|---|---|
| **Constitution** | Supreme law (Build Constitution + Decision Filter) | _none — law, not code_; `docs/architecture/*` + project memory | — | documented (not a module) | Canonical full text not in-repo → documentation gap. |
| **Reality Graph** | Canonical truth substrate: identity, objects, relationships, events, observations, promises, journeys, knowledge, external refs | `object-graph/`, `events/store.ts`, `relationship-engine/`, `knowledge-engine/`, `promise-engine/`, `journey-engine/` | `object-graph`, `event-store`, `m6-relationship`, `m7-knowledge`, `m2-workflow-task-promise`, `m10-5-journey` | **implemented** | Realized as the union of these stores, not one "graph" module. External IDs isolated in `external_references` (never identity). |
| **Reality Understanding** | Synthesis capability; reads Graph → synthesizes Models; owns no canonical truth | `reasoning-engine/` (`ReasoningEngine`, `prompt-assembler` `assembleContext`/`buildEvidenceChain`, `providers`) | `m9-reasoning` | **implemented** | Reads via its **own** read-only `ReasoningRepository`, **not** through the Permission Gate → see §4/§5 (pin #6 incomplete). |
| **Reality Model** | Synthesized, regenerable understanding of a subject's reality; no canonical state; regenerable from Graph | `projection-engine/` (`projections/*`, `rebuilder.ts`, `store.ts`, `registry.ts`) | `m3-projection` | **implemented** | Regenerable via `rebuilder`. Pin #2 (tie to Graph-version + synthesis-version) **not verified** in this pass → engineering TODO. |
| **Reality Lenses** | Reading facets over a Reality Model (benefit, risk, opportunity, eligibility, journey, promise, financial, operational, clinical, growth, reputation, future). Lenses read; they do not decide. | _no dedicated module_; lens-like readings emerge from `projection-engine/projections/*` + `reasoning-engine` narratives | (none specific) | **partially implemented / unclear** | No first-class Lens abstraction enumerating the facets; readings are ad hoc. Documentation + engineering gap. |
| **Organizational Judgment Model** | Many readings → one judgment; Actors→readings; safety+continuity gate; humans decide consequential/low-confidence/irreversible/rights-bearing/clinical/legal/ethical/financial | `rules-engine/` (decision aggregation; outcomes `ALLOW`/`DENY`/`REQUIRE_HUMAN`/`DEFER`) + `organizational-brain/` + `reasoning-engine` confidence + `policies/ai-act-policy`, `policies/data-integrity-policy` | `rules-engine`, `m8-organizational-brain`, `ai-act-policy`, `emr-boundary-and-data-integrity` | **implemented** | `REQUIRE_HUMAN` = the "humans decide" gate. One judgment from many readings = RulesEngine policy aggregation by priority. |
| **Operating Cycle** | Perceive → Understand → Judge → Orchestrate → Act → Communicate → Verify → Learn | distributed: `trigger-engine` (perceive), `reasoning-engine` (understand/judge), `rules-engine`+`organizational-brain` (judge/learn), `workflow-engine`/`task-engine`/`promise-engine` (orchestrate/act), `communication-engine` (communicate), `projection-engine` (verify/understand); `intake-orchestrator` = one concrete cycle slice | `m4-vertical-slice`, `m0-e2e`, `trigger-engine`, `communication-engine` | **partially implemented** | Steps realized as choreography; no unified "Operating Cycle Runtime" module. Consistent with pin #10 (logical dependency order, not a synchronous pipeline). |
| **Experience Contract** | The why: stakeholder need, intended experience, evidence of fulfillment, failure signature | _not implemented as such_; adjacent: `promise-engine/` (promises), `journey-engine/` (journeys) | `m2` (promise), `m10-5` (journey) | **not implemented** | No Experience Contract object with a **failure signature**. Pin #15 (classify failure signatures before Assure automation) applies. |
| **Engage** | Bring relationships/opportunities to deliberate disposition; invariant: disposition | `intake-orchestrator/` (referral → disposition) + `relationship-engine/` | `m4-vertical-slice` | **partially implemented** | Not a first-class capability owning cycle instances; `intake-orchestrator` covers a slice. |
| **Deliver** | Fulfill obligations; invariant: obligation | `promise-engine/` (promise → obligation) + `workflow-engine/` + `task-engine/` + `communication-engine/` | `m2-workflow-task-promise`, `communication-engine` | **partially implemented** | Obligation lifecycle present; not organized as a Deliver capability cycle. |
| **Sustain** | Preserve organizational continuity; invariant: continuity | _no capability module_; continuity-relevant signals in `workforce-engine/` + `organizational-brain/` | `m10-workforce`, `m8` (indirect) | **not implemented** | Machinery exists (capacity, patterns); no Sustain capability. |
| **Assure** | Verify reality matches intended standard + correct gap; invariant: intended standard; Standard resolves to Knowledge (no Standard object) | substrate: `knowledge-engine/` (Knowledge = what should be); "what is" from `projection-engine`/`reasoning-engine` | `m7-knowledge` | **not implemented** | Substrate (Knowledge) present; no verify-and-correct loop; failure-signature evaluation (pin #15) not built. |
| **Experience Surfaces** | PEL/OEL surfaces where stakeholders experience the Operating Cycle; not architectural layers | `apps/web/`, `apps/api/` | (not inspected) | **unclear / scaffolded** | Surfaces exist as apps; depth not inspected in this concordance. |
| **Permission Gate** | Authorization that gates Graph reads **before Reality Understanding sees data** (pin #6) | `retrieval-engine/permission-gate.ts` (`RetrievalPermissionGate`) → `rules-engine` (`consent` + `participation` + `ai-act` + `emr-boundary` + `data-integrity` policies); fail-closed, ALLOW-only. **Reality Understanding read boundary:** `reasoning-engine/authorized-context.ts` (`assembleAuthorizedContext`) + `reasoning-engine/read-authorization-policies.ts` (adapters delegating to the real BD-014/ADR-014/ADR-015 modules) | `m11-retrieval`, `consent-policy`, `participation-policy`, `rules-engine`, **`reasoning-authorization-boundary`** | **implemented** (M11 retrieval **and** Reality Understanding reads) | Reasoning evidence/context now passes through the existing gate before reaching synthesis — pin #6 satisfied at context assembly. Residual production wiring noted in §4. |
| **Identity Resolution** | Resolve/dedup the same real-world entity across sources (pin #12: own spec before production) | `shared/ids.ts` (ID **generation** only) + `object-graph.findByExternalReference` (lookup) | `object-graph` | **not implemented** | Only ID generation (UUIDv4 object / UUIDv7 event) + external-ref lookup. No entity matching/merge. Pin #12 requires a dedicated spec first. |
| **Event Store** | Durable append-only event log; deterministic causal ordering (pins #5, #11) | `events/store.ts` (`EventStore`) + `events/types.ts` | `event-store` | **implemented** | Append-only, idempotent, per-stream monotonic `seq`, transactional append+state, causation/correlation IDs, UUIDv7. Satisfies pins #5, #11. |
| **Object Model** | Canonical objects; Objecthood is a design-time schema gate (pin #9) | `object-graph/repository.ts` (`AlaraObject`, `ObjectType`, `isValidObjectType`/`OBJECT_TYPES`, version-gated updates) + `shared/types.ts` | `object-graph` | **implemented** | Objecthood Principle (BD-013) enforced design-time; optimistic concurrency via `version` (pins #8, #9). |
| **External Reference Boundary** | External IDs are references, never identity | `object-graph` `external_references` (`addExternalReference`/`getExternalReferences`/`findByExternalReference`) | `object-graph` | **implemented** | External IDs never PK/FK; isolation enforced in the repository. |
| **Automynd Boundary** | EMR is the legal clinical record; Alara integrates, never owns clinical doc | `automynd-adapter/` (`fixture-adapter`, `types`) + `rules-engine/policies/emr-boundary-policy.ts` | `automynd-adapter`, `emr-boundary-and-data-integrity` | **implemented** (fixture) | `EMRBoundaryPolicyModule` enforces the write boundary; only a fixture adapter exists — a real EMR adapter is future work. |

---

## 3. Code → Architecture Mapping

| Module | Architectural concept it implements | Name: keep or legacy? | Rename later? | Safe to build on now? |
|---|---|---|---|---|
| `object-graph` | Reality Graph (Object Model + External Reference Boundary) | keep (current) | no | **yes** |
| `events` / `event-store` | Reality Graph (Event Store) | keep | no | **yes** |
| `projection-engine` | Reality Model (Projections) | keep | no | **yes** |
| `reasoning-engine` | Reality Understanding | keep | optionally document as "Reality Understanding"; no rename now | **yes** — but its reads must be gated before its outputs count as authorized (§4) |
| `knowledge-engine` | Knowledge (Assure standard substrate) + Reality Graph (observations/knowledge) | keep | no | **yes** |
| `organizational-brain` | Organizational Judgment Model (pattern judgments) | keep | no | **yes** |
| `relationship-engine` | Reality Graph (relationships); Engage/Deliver substrate | keep | no | **yes** |
| `promise-engine` | Experience Contract (promise) + Deliver (obligation source) | keep | document as Experience-Contract-adjacent; no rename now | **yes** |
| `workflow-engine` | Operating Cycle (Orchestrate) / Deliver | keep | no | **yes** |
| `task-engine` | Operating Cycle (Act) / Deliver | keep | no | **yes** |
| `rules-engine` | Organizational Judgment Model (decision aggregation, `REQUIRE_HUMAN`) + Permission Gate substrate | keep | no | **yes** |
| `journey-engine` | Reality Graph (journeys) / journey lens | keep | no | **yes** |
| `workforce-engine` | Deliver / Sustain substrate (workforce) | keep | no | **yes** |
| `communication-engine` | Operating Cycle (Communicate) | keep | no | **yes** |
| `retrieval-engine` | Reality Understanding read path + **Permission Gate** (read authorization) | keep | no | **yes** — this is where the gate lives; extend it (§6) |
| `trigger-engine` | Operating Cycle (Perceive → Orchestrate) | keep | no | **yes** |
| `intake-orchestrator` | Engage (capability slice) / Operating Cycle slice | keep | later document under Engage; no rename now | **yes** |
| `automynd-adapter` | Automynd Boundary / External Reference Boundary | keep | no | **yes** (fixture now; real adapter later) |
| `consent-policy` | Permission Gate (consent dimension) | keep | no | **yes** |
| `participation-policy` | Permission Gate (participation dimension) | keep | no | **yes** |
| `ai-act-policy` | Organizational Judgment Model (AI governance / `REQUIRE_HUMAN`) | keep | no | **yes** |

> No module in this tree is **legacy**. The legacy implementation is the prior
> Python `ops/` package, which is **not present** on `main`. Also live but not in
> the user's list: `emr-boundary-policy` (Automynd Boundary), `data-integrity-policy`
> (Organizational Judgment Model — REQUIRE_HUMAN for integrity-sensitive writes).

---

## 4. Permission Gate Determination

> **UPDATE (Read Authorization Boundary implemented).** The gap below is now closed
> for Reality Understanding. `reasoning-engine/authorized-context.ts`
> (`assembleAuthorizedContext`) routes every evidence record (subject object +
> patterns + knowledge + observations) through the **existing**
> `RetrievalPermissionGate` before calling `assembleContext`, so no record an actor
> may not see can reach evidence assembly, context assembly, Reality Model synthesis,
> or downstream judgment. `reasoning-engine/read-authorization-policies.ts` provides
> read-boundary adapters that **delegate to the real** Consent (BD-014) /
> Participation (ADR-014) / AI-Act (ADR-015) modules — no new policy logic, no second
> engine. Fail-closed, ALLOW-only; proven by `reasoning-authorization-boundary.test.ts` (7 cases).
>
> **Residual production wiring (do not overstate):** (a) a deployment must register
> the read-boundary policies (`registerReadAuthorizationPolicies`) for
> `retrieval-read`; with an empty registry the RulesEngine default-allows. (b) Records
> must carry the per-(actor,subject) consent/participation/ai-act **facts** for those
> adapters to gate them — resolving and attaching those facts from the graph is the
> remaining step. (c) A lone `DEFER` is collapsed to `ALLOW` by the RulesEngine; read
> policies must use `DENY`/`REQUIRE_HUMAN` to block (the boundary is ALLOW-only, so it
> correctly suppresses `DENY`/`REQUIRE_HUMAN`/error).
>
> **UPDATE 2 (Fact Resolution implemented).** `reasoning-engine/fact-resolver.ts`
> (`GraphFactResolver`) resolves authorization **facts** from canonical state, and the
> read adapters now honour a per-read **requirements** envelope — so **absence of a
> required fact no longer becomes permission**. Participation resolves from the
> relationship participation edges (`RelationshipReadPort`); ai-act derives from the
> caller's intended AI use; consent resolves via an optional `ConsentFactSource`. A
> required-but-unresolved fact **fails closed**: consent/participation delegate to the
> real module with an undefined fact (→ DENY); ai-act returns `REQUIRE_HUMAN`. The
> resolver resolves facts only — authorization stays with the Gate/RulesEngine. Proven
> by `reasoning-fact-resolution.test.ts` (9 cases). **Remaining gaps (do not overstate):**
> (1) Consent has no canonical query-by-subject path yet, so real consent **ALLOW**
> requires wiring a Consent store behind `ConsentFactSource`; until then consent
> resolves to undefined → fails closed when required (safe, but cannot positively allow
> on real consent). (2) Callers opt in: register the read adapters and pass a `resolver`
> + `requires` (+ a `ConsentFactSource`) to `assembleAuthorizedContext`; with neither,
> behaviour is unchanged (manual facts honoured; absent-and-not-required facts pass) —
> backward compatible. (3) The `DEFER` nuance above is unchanged.
>
> **UPDATE 3 (Consent Store / ConsentFactSource wired).** `ConsentFactSource` is now
> backed by a canonical query path: `consent-store/repository.ts` (`ConsentRepository`)
> reads `Consent` objects from the unified object graph (`Consent` is an existing
> `OBJECT_TYPE` — no new type introduced) and maps them to the existing `ConsentFact`;
> `consent-store/consent-fact-source.ts` (`GraphConsentFactSource`) selects the consent
> relevant to (subject, actor) and hands it to the resolver. **Valid canonical consent
> now allows; revoked/expired/wrong-subject/wrong-actor/wrong-permission/missing all
> fail closed** — the existing `ConsentPolicyModule` makes the decision (no policy
> logic duplicated). Proven by `consent-store.test.ts` (9 cases). **Remaining gaps (do
> not overstate):** (1) only the consent **read/query** path is added — there is no
> consent **issuance/lifecycle** flow yet, so `Consent` objects must be created
> elsewhere before positive consent can resolve (until then resolution returns none →
> fails closed when required). (2) Production must construct the resolver with
> `new GraphConsentFactSource(new ConsentRepository(db))` and pass `requires:{consent:true}`
> (callers opt in). (3) The query lists `Consent` objects by (tenant, type) and filters
> subject in code — a subject-indexed column/query is a later optimisation. The
> `ConsentFact` type already carries status / revokedAt / expirationDate / permissionTypes
> / recipientId, so **no missing consent fields** were needed.

**Original finding — Permission Gate existed as a combination and was PARTIALLY implemented.**

It is composed of:
- `retrieval-engine/permission-gate.ts` → `RetrievalPermissionGate.isVisible()` — the read/visibility gate. Fail-closed; **only `ALLOW` admits**; `DENY`/`REQUIRE_HUMAN`/`DEFER` suppress the record.
- `rules-engine` (`RulesEngine.evaluate`) aggregating the five policy modules by priority: `data-integrity` (1) → `emr-boundary` (2) → `ai-act` (5) → `consent` (20) → `participation` (30).

What it does **not** yet do (the gap vs pin #6 "authorization must gate Graph reads **before Reality Understanding sees data**"):
- The gate is referenced **only inside `retrieval-engine`** (`engine.ts` call site `this.gate.isVisible(...)`). No other engine uses it.
- `reasoning-engine` (Reality Understanding) gathers evidence via its **own read-only `ReasoningRepository`** and `assembleContext`/`buildEvidenceChain` — **bypassing the gate**. Projections similarly read repositories directly.

Therefore: the **read-permission decision mechanism is implemented and proven** (M11 + consent/participation/rules tests green), but it is **not yet enforced at the boundary feeding Reality Understanding**. This is **incomplete implementation**, not a contradiction — the existing gate + RulesEngine are directly reusable.

**Exact next implementation task (do NOT implement yet):**
> **Read Authorization Boundary.** Route Reality Understanding's evidence gathering
> (`reasoning-engine` `ReasoningRepository` / `assembleContext`, and projection
> inputs) through the existing permission gate — i.e., apply `RetrievalPermissionGate`
> (or an equivalent gate at the `object-graph`/`knowledge`/`event` read boundary) so
> that **no record an actor may not see can reach synthesis**. Reuse `RulesEngine` +
> the five policy modules; invent no new permission logic. Add unit + integration
> tests proving an unauthorized record is excluded from a reasoning context.

---

## 5. Contradictions

**No contradictions found.** No existing code makes the frozen architecture
impossible to implement faithfully. Everything maps cleanly with naming differences
and incomplete pieces. Classified per the rubric:

| Item | Classification |
|---|---|
| Permission Gate not applied before Reality Understanding (pin #6) | **RESOLVED** — Read Authorization Boundary added (§4); residual production wiring noted |
| Lone `DEFER` is collapsed to `ALLOW` by the RulesEngine | **engineering note** — read policies must use `DENY`/`REQUIRE_HUMAN` to block; gate is ALLOW-only |
| Architecture vocabulary vs code engine names | **documentation / naming mapping** (resolved by this concordance) |
| Reality Lenses has no first-class abstraction | **incomplete implementation / documentation gap** |
| Operating Cycle has no unified runtime (distributed choreography) | **incomplete implementation** (and arguably intended — pin #10) |
| Experience Contract (with failure signature) not built | **incomplete implementation** |
| Capabilities (Engage/Deliver/Sustain/Assure) not first-class | **incomplete implementation** |
| Identity Resolution = ID generation + external-ref lookup only | **incomplete implementation** (pin #12: needs own spec) |
| Reality Model ↔ Graph-version + synthesis-version tying (pin #2) | **engineering TODO** (not verified this pass) |
| Constitution canonical text not in-repo | **documentation gap** |

---

## 6. Recommended Next Build Step

> **DONE.** The Read Authorization Boundary recommended here has been implemented
> (`assembleAuthorizedContext` + read-boundary adapters; 7 tests green). The next
> candidates, in dependency order, are: (a) **fact resolution** — attach per-(actor,
> subject) consent/participation/ai-act facts to read records and register the
> read-boundary policies in production wiring; then (b) **Identity Resolution**
> (build-order, pin #12 — needs its own spec first). The original recommendation is
> retained below for traceability.

**→ Read Authorization Boundary** (complete the Permission Gate, build-order item #1).

**Justification (dependency order + existing implementation):**
- Build order puts **Permission Gate first**; this concordance shows it is *partially*
  implemented — the decision mechanism exists but does not yet gate the reads that feed
  Reality Understanding.
- Pin #6 makes this the binding precondition: until Graph reads are gated *before*
  Reality Understanding, no synthesized Model/judgment can be trusted as authorized,
  so every layer above (Reasoning, Judgment, Operating Cycle, Capabilities) inherits
  the gap.
- The substrate it depends on is already implemented and **green**: Event Store,
  Object Model, External Reference Boundary, Reality Graph stores, and the RulesEngine
  permission decision. So this is the **smallest faithful step** that reuses existing
  code (`RetrievalPermissionGate` + `RulesEngine` + the five policies) and **invents no
  architecture**.
- It is strictly smaller and lower-risk than building Identity Resolution (which pin #12
  says needs its own spec first) or a new Reality Graph (already implemented).
