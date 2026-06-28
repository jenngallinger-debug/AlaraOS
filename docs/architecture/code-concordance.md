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
>
> **UPDATE 4 (Consent issuance / lifecycle implemented).** `consent-store/engine.ts`
> (`ConsentEngine`) is the canonical path to **grant / revoke / expire** consent as
> `Consent` objects, reusing the existing object+event write pattern
> (`ObjectCommandHandler` → `ObjectCreated` / `ObjectUpdated`, atomic and
> event-sourced) and the existing `ConsentFact` fields (status / revokedAt /
> expirationDate). No new Consent model and no new event types. The **full loop is
> closed and proven** (`consent-lifecycle.test.ts`, 9 cases): grant → read allowed;
> revoke → next read blocked; expired (past `expirationDate` or explicit `expire()`) →
> blocked; missing → fail closed; wrong subject/actor/permission → blocked; and the
> consent object's event stream (`ObjectCreated`→`ObjectUpdated`) reconstructs to
> status `revoked` (canonical + auditable). **The Permission Gate / RulesEngine /
> ConsentPolicyModule are unchanged** — the engine only creates/changes state; the
> gate reads and enforces. **Remaining gaps:** (1) no automatic time-based expiry
> sweep — `expirationDate` is enforced at read time by the policy (DENY when past) and
> `expire()` flips status on demand, but no background job ages consents to `expired`;
> (2) no higher-level consent-capture flow yet (intake/portal/who-may-grant) — the
> engine is the primitive; (3) Identity Resolution remains a separate step (pin #12).
>
> **UPDATE 5 (Consent capture / intake integration implemented).**
> `consent-store/capture.ts` (`ConsentCaptureService`) is the smallest application
> boundary where consent is **captured** during an intake/portal interaction: it
> validates the captured input and **calls the canonical `ConsentEngine`** (`capture`
> → `grant`, `withdraw` → `revoke`). It owns **no authorization and no lifecycle
> logic** — the engine owns canonical state; the Permission Gate / RulesEngine remain
> read/enforcement-only. (A dedicated service rather than `IntakeOrchestrator` because
> that orchestrator is a referral-received pipeline; consent capture is a distinct,
> reusable concern for intake **and** portal.) Full loop proven
> (`consent-capture.test.ts`, 6 cases): capture → canonical Consent object + event;
> required-consent read allowed after capture; captured withdrawal → next read blocked;
> missing required fields rejected; wrong subject/actor/permission still blocks.
> **Remaining gaps:** (1) the service is the boundary — it is not yet *called from* a
> concrete surface (the referral pipeline / an HTTP or portal handler); (2) capture
> validates fields but does not itself authorize **who may grant** consent (a separate
> application/policy concern, not enforced here); (3) no automatic expiry sweep (as
> above).
>
> **UPDATE 6 (Consent surface wired).** The `ConsentCaptureService` is now called from
> a concrete application boundary in the existing API app (`apps/api`, Fastify):
> `POST /commands/consent` (capture → `ConsentCaptureService.capture` → `ConsentEngine.grant`)
> and `POST /commands/consent/withdraw` (→ `ConsentCaptureService.withdraw` →
> `ConsentEngine.revoke`), wired via the DI container (`shared/container.ts`). The
> handler holds **no authorization logic** — it validates request shape (JSON schema),
> delegates to the service (which performs business validation → `422`), and the
> engine writes canonical state; **the Permission Gate / RulesEngine remain
> enforcement-only**. Full loop proven over the same store (`apps/api/tests/consent.test.ts`,
> 5 cases): capture → canonical Consent object + a later required-consent read allowed;
> withdraw → next read blocked; invalid input → validation failure. **Notes / remaining
> gaps:** (1) the surface is **REST only** (GraphQL not wired); (2) `apps/api` is **not**
> a member of the `workspaces` array (kept that way to avoid destabilising the install
> / pulling in `apps/web`), so the npm `--workspaces` flag still covers core only — but
> standard root verification now includes apps/api via added root scripts: **`npm run
> verify`** (= `test:all` + `build:all`, which run core `--workspaces` **and** apps/api),
> with `npm run install:api` to install apps/api deps. So the endpoints are no longer
> invisible to project-level verification. (3) the endpoint itself has no
> caller auth (who-may-grant) — **addressed in UPDATE 7**; (4) no automatic
> expiry sweep.
>
> **UPDATE 7 (Who-may-grant consent authorization).** The consent capture/withdraw
> surface now authorizes the **caller**, with the decision in the rules/policy layer —
> `rules-engine/policies/consent-authority-policy.ts` (`ConsentAuthorityPolicyModule`,
> rule set `ruleset.consent.capture`). `consent-store/authorizer.ts`
> (`ConsentAuthorizer`) resolves the facts (the actor's participation role on the
> subject via the shared `resolveParticipationFact`, and the consent's real subject for
> withdrawal via `ConsentRepository.findById`) and **delegates the decision to the
> RulesEngine** — it is not a policy engine. `ConsentCaptureService` gained an
> **optional** `authority` it *calls* before any canonical write (no policy logic in
> the service); the API container wires it, and the routes map
> `ConsentAuthorizationError` → **403**. **Authorized actors:** (a) the subject
> themselves (self), (b) an organizational actor with an `Owner`/`Actor` participation
> role on the subject (from canonical relationship edges). Everything else — including
> missing actor/subject context or an unreadable consent on withdrawal — **fails
> closed**. The Permission Gate / RulesEngine / ConsentEngine are unchanged. Proven by
> `consent-authorization.test.ts` (core, 6 cases: self/participation allow, stranger
> deny, missing-context fail-closed, authorized/denied withdraw with no state change)
> and `apps/api/tests/consent.test.ts` (endpoint 403s). **Remaining limitations:** no
> guardian/representative model beyond participation roles (deferred until the graph
> carries those facts); the optional authority means a direct/internal
> `ConsentCaptureService` without an authorizer still performs no authz (by design for
> system use — the API always supplies one); endpoint transport-level authn (who the
> caller *is*) is still assumed upstream — **addressed (dev boundary) in UPDATE 8**.
>
> **UPDATE 8 (Transport authentication boundary).** The consent endpoints now derive
> the **authenticated actor from the request transport** and authorize *that* actor —
> never a body field. `apps/api/src/shared/auth.ts` (`getAuthenticatedActor`) reads the
> principal from the **`x-actor-id` header**; the capture/withdraw routes fail closed
> with **401** when it is absent, and pass the authenticated actor into
> `ConsentCaptureService` as the authorization actor (the body's `capturedBy` is no
> longer trusted and cannot impersonate the subject). `ConsentAuthorizer` remains the
> authorization decision path (403 on denial). **Current mechanism — be clear:** this
> is a **minimal development/test transport boundary**, NOT real authentication — there
> is no login, session, or JWT verification; the header is taken at face value. A real
> auth provider would replace `getAuthenticatedActor` (verifying a token/session)
> without changing the downstream authorization path. Proven by `apps/api/tests/consent.test.ts`
> (401 when unauthenticated for capture+withdraw; body `capturedBy` cannot impersonate;
> authorized authenticated subject succeeds; unauthorized authenticated actor → 403).
> **Remaining:** real token/session authentication is not built; guardian/POA modeling
> still deferred.

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

---

## UPDATE 9 — Event Store append concurrency hardened (P0 substrate)

`EventStore.append` (`events/store.ts`) previously computed `seq = MAX(seq)+1` inside a
default-isolation transaction with **no lock and no retry** — and a docstring that
falsely claimed an advisory lock existed. Concurrent appends to the *same* stream could
race (duplicate/lost `seq`); the `UNIQUE(stream_id, seq)` constraint would turn the loser
into an unhandled error.

Fix (smallest robust): the append transaction now takes a transaction-scoped
`pg_advisory_xact_lock(hashtext(tenant_id), hashtext(stream_id))` before reading the next
seq. Same-stream appends serialize into a contiguous sequence; different streams take
different locks and stay concurrent. The `UNIQUE(stream_id, seq)` constraint is retained
as a backstop. The misleading comment was corrected to match the implementation.

Semantics preserved: append-only, per-stream ordering, event ids, payloads, idempotency.
No event schema, no higher-level engine, and no public signature changed.

Test double: `tests/helpers/in-memory-store.ts` now simulates `pg_advisory_xact_lock` as a
per-key async mutex that is **re-entrant within a transaction** and released when the
transaction settles — faithfully mirroring Postgres so the new concurrency regression
tests (`event-store.test.ts`) prove the fix (they fail when the lock is removed).

Residual (not addressed here): no bounded retry-on-unique; a transaction that appends to
multiple streams in conflicting lock order could deadlock and depend on Postgres deadlock
detection (single-stream appends, the common case, cannot). Event-table partitioning and
object-reconstruction snapshots remain open scale items.

---

## UPDATE 10 — Rules Engine fail-closed default (P0 substrate)

`RulesEngine.evaluate` (`rules-engine/engine.ts`) previously returned **ALLOW** when no
policy module was registered for a rule set ("no-policy ⇒ permit"). For a healthcare
operating system this is unsafe: an unconfigured rule set silently permitted the action,
and the retrieval read gate (`RetrievalPermissionGate.isVisible`, which admits only on
ALLOW) would therefore admit records when its engine had no read policy registered.

Change: the no-policy branch now **fails closed (DENY)** with an explicit
`engine.no-policy` applied rule and explanation. Intentional allow is no longer implicit
— it must be expressed by registering a policy for the rule set (e.g.
`DefaultAllowPolicyModule`, `ruleSetIds: ['*']`). This is the "make intentional allow
visible in registration" posture.

Blast radius (audited, all preserved):
- Production (`apps/api/shared/container.ts`) already registers `BUILT_IN_POLICY_MODULES`
  including `DefaultAllowPolicyModule('*')` → unaffected.
- Consent authority (`ruleset.consent.capture`) and identity review
  (`ruleset.identity.review`) always register their policy → unaffected; both fail closed
  via their own DENY/REQUIRE_HUMAN logic.
- M1b integration registers Consent/Participation for `ruleset.intake` → unaffected.
- Test pipelines that relied on implicit ALLOW for `ruleset.intake` (m2 `makeAllowEngine`,
  m4 `buildPipeline`, identity-resolution-intake `buildPipeline`) now register
  `DefaultAllowPolicyModule` explicitly — same behavior, now visible.
- The retrieval read gate now suppresses records when no read policy is registered (a
  latent fail-open closed); proven in `m11-retrieval-engine.test.ts`.

DEFER nuance (NOT changed — documented follow-on): a lone `DEFER` still does not
fail-fast and collapses to ALLOW after the loop. No in-repo policy emits DEFER; current
behavior is pinned by a test (`rules-engine.test.ts`). Tightening DEFER for
safety-sensitive rule sets is tracked as a follow-on.

---

## UPDATE 11 — Consent read path is subject-targeted (P0 substrate)

`ConsentRepository.findForSubject` (`consent-store/repository.ts`) previously loaded
EVERY Consent object in the tenant (`SELECT * FROM objects WHERE tenant_id=$1 AND
type='Consent'`) and filtered by `subjectId` in JavaScript — a full per-tenant scan on
the hottest authorization read path.

Change: the read is now subject-targeted —
`WHERE tenant_id=$1 AND type='Consent' AND attributes->>'subjectId'=$3` — so it never
loads consents for other subjects. The in-app subject filter is removed (the query
guarantees the scope). Result semantics are unchanged: it still returns every well-formed
consent for the subject in ANY status, so `GraphConsentFactSource` continues to select
active vs revoked vs expired and the ConsentPolicyModule / Permission Gate decide.

Index: migration `012_consent_subject_index.sql` adds a partial expression index
`idx_objects_consent_subject ON objects ((attributes->>'subjectId')) WHERE type='Consent'`
to back the query in production. (Migrations are applied out-of-band; tests run against
the InMemoryStore, which now models the targeted query.)

Unchanged: ConsentEngine lifecycle, the Consent object model (still a canonical graph
object), the Permission Gate, the RulesEngine, and all authorization policy behavior.

Remaining read-path limitations (not addressed here): consent has no scope/purpose-of-use
granularity (HIPAA / 42 CFR Part 2 segmentation); merge-aware reads (a merged-away
subject id) remain deferred with the Identity merge model.

---

## UPDATE 12 — Tenancy/RLS reconciliation + tenant-filter guard (audit-driven, zero behavior change)

The architecture review flagged a tenancy mismatch. Audit result (no code changed):
RLS is **enabled** with `tenant_isolation` policies on 29 tables, but it is **not a live
backstop** — there is no `FORCE ROW LEVEL SECURITY` (so the owner role bypasses RLS), the
app never sets `app.tenant_id` (so a non-owner role would return zero rows), and the
policies are `USING`-only (no `WITH CHECK`, so writes are unconstrained even when
enforced). Tenant isolation today is enforced entirely by application-level
`WHERE tenant_id` predicates, which the audit found near-comprehensive (no leak; two
benign by-id reads; safe joins).

Added (this step):
- `docs/architecture/tenancy-rls.md` — the authoritative statement of the real state, the
  owner-bypass / non-owner-outage / no-`WITH CHECK` facts, why `SET LOCAL app.tenant_id`
  needs a transaction/request-scoped connection, why full RLS is deferred, and the future
  milestone.
- `packages/core/tests/tenancy-guard.test.ts` — a static guard that scans SQL literals in
  `packages/core/src` and fails if a tenant-scoped table is queried without a `tenant_id`
  predicate, unless explicitly allow-listed with a documented reason. Only the two audited
  by-id reads are allow-listed (EventStore idempotency; ObjectGraph post-insert re-fetch).
  This closes the unit-test blind spot (InMemoryStore filters by tenant independently of
  the SQL shape, so it cannot catch a forgotten tenant predicate).

NOT changed: no RLS enablement, no `FORCE`, no `WITH CHECK`, no `DatabaseClient` change,
no tenant behavior. RLS remains scaffolded defense-in-depth; app-level filtering is the
contract and the guard is its enforcement point.

---

## UPDATE 13 — API auth hardening Phase 1 (mutating-command auth + webhook signature)

The post-P0 review flagged the public REST mutation surface (A1–A4). Closed in this step
(apps/api only; no core change):

- **`/commands/events`** (raw canonical event append) — was unauthenticated. Now requires
  an authenticated actor (401 if missing) AND a **privileged system actor** (403
  otherwise); the configured allowlist is `ALARA_SYSTEM_ACTORS` (default `system`). The
  event actor is the authenticated principal — body `actor` is ignored (removed from the
  schema's required fields).
- **`/commands/referrals`** — was unauthenticated. Now requires an authenticated actor
  (401 if missing); the intake actor is the principal, not body `actor`.
- **`/commands/consent` + `/withdraw`** — already authenticated (unchanged).
- **`/webhooks/automynd`** — was unsigned. Now requires a valid shared secret in the
  `x-automynd-secret` header (constant-time compare; 401 on missing/invalid/unconfigured).
  Configured via `AUTOMYND_WEBHOOK_SECRET`; **fails closed** when unset.

New helpers: `apps/api/src/shared/config.ts` (`getSystemActors`/`isSystemActor`,
`getAutomyndWebhookSecret`, `AUTOMYND_SECRET_HEADER`) and `auth.ts` (`getHeader`,
`secretsMatch`). GraphQL (`/graphql`) is **read-only — no `Mutation` type** — so it is out
of scope for mutation auth (documented, not changed).

**This is NOT a production auth provider.** `x-actor-id` remains a spoofable dev/test
transport boundary (no token/session/JWT verification), and the Automynd secret is a
shared-secret header, not an HMAC over the raw request body. Both are explicit MVP
boundaries to be replaced by a real auth provider / signed-webhook scheme. Remaining
risks: no real authN, no rate limiting, no replay/idempotency keys, GraphQL read surface
unauthenticated.

---

## UPDATE 14 — Automynd webhook idempotency / replay protection (API Auth Phase 2)

The signed webhook (UPDATE 13) could still create duplicate events on replay, because
`EventStore.append` generated a fresh event id per call. Closed here:

- **`AppendEventOptions` gains an optional `eventId`** (`events/store.ts`) — additive,
  semantics-preserving (defaults to `newEventId()`; existing callers unchanged). This
  wires the idempotency the append docstring already promised ("caller can pass a
  deterministic ID"). No other Event Store change.
- **`/webhooks/automynd` now requires an `idempotency-key` header** (400 if missing,
  after the secret check). The canonical event id is derived deterministically from
  (tenant, `automynd`, key) via `deterministicEventId` (`shared/config.ts`, a UUIDv5-shaped
  digest using Node `crypto` — no new dependency). A replay maps to the same id, so the
  Event Store's idempotency-by-id makes it a no-op (no second event).
- **Conflict detection:** the id is derived from the KEY, not the payload, so a key reused
  with a different payload still maps to the same id (no divergent event). The handler
  compares the stored event's payload to the freshly-computed payload (the adapter is
  deterministic) and returns **409** on mismatch; identical replays return **200**.

Behavior: missing key → 400; invalid/missing secret → 401; same key+payload → 200, one
event; same key+different payload → 409; different keys → separate events.

MVP boundary (unchanged scope): replay protection is keyed on a client-supplied header
and a deterministic id — it is NOT HMAC-over-raw-body and has no replay timestamp window.
Production still needs signed bodies + a freshness window. No core Event Store semantics
changed.

---

## UPDATE 15 — Referral command idempotency (API Auth Phase 3)

Retrying a referral previously re-ran the whole intake saga: identity resolution reused
the Patient (UPDATE: external-ref match), but `workflowEngine.start` never dedupes, so a
retry produced duplicate workflow/task/promise/communication. The workflows table has no
`correlation_id` column (the referral id was only on the events' correlation_id), so there
was no query path to find prior intake output by referral id.

Fix — **orchestrator-level idempotency** (protects the canonical operation for any caller,
not just HTTP):

- `IntakeOrchestrator.handleReferralReceived` derives a deterministic per-referral
  **receipt stream id** from (tenant, `automynd-referral`, `automyndReferralId`) via the
  new `deterministicId` helper (`shared/ids.ts`, crypto-based, no new dependency).
- **Step 0:** `loadStream(receiptStreamId)`. If a receipt exists: a matching content
  fingerprint replays the original result (no saga, no new artifacts); a different
  fingerprint is a **conflict** (no silent overwrite, no duplicate).
- **Step 9:** after a successful saga it appends an `IntakeReceiptRecorded` event (new
  additive `EVENT_TYPES` entry) to that stream, holding the result ids + fingerprint.
- A **missing referral id** is rejected before any work.
- The API maps a conflict result to **409**; replay returns the original 201 result.

Keyed by (tenant, referralId): a different tenant with the same id is independent; the same
id with a different patient/payload is a conflict. Reuses `loadStream`/`append` only — no
new query method, no workflow-table change.

Residual (documented): the receipt is written after the saga, so two **concurrent
first-time** identical referrals could still both run the saga before either receipt
exists (a pre-saga claim/lock or a unique constraint would close this). Sequential retries
(the dominant real case — a client retrying after a lost response) are fully idempotent.
`deterministicId` (core) duplicates the API's `deterministicEventId`; consolidation is a
later cleanup.

---

## UPDATE 16 — Basic in-memory rate limiting (API Auth Phase 4)

Closes part of the post-P0 DoS/retry-storm risk (A8/S6). `@fastify/rate-limit` is not
installed, so this is a dependency-free, process-local fixed-window limiter
(`apps/api/src/shared/rate-limit.ts`) registered as a Fastify `onRequest` hook in
`server.ts`.

- Applies ONLY to mutating routes — POST `/commands/*` and `/webhooks/automynd`
  (`isLimitedRoute`). `/health`, `/graphql`, and all GETs are never limited.
- Keyed by the authenticated actor (`x-actor-id`) when present, else client IP.
- Over-limit → **429** with a `retry-after` header.
- Config (env): `RATE_LIMIT_ENABLED` (default ON outside tests, **OFF under
  `NODE_ENV=test`** so existing tests are unaffected), `RATE_LIMIT_WINDOW_MS` (default
  60s), `RATE_LIMIT_MAX` (default 100/window). When disabled, the hook is not installed.

Scope/limits (stated plainly): **process-local only** — counters are per-instance, so
behind multiple API instances the effective limit multiplies. It is a coarse abuse/DoS
brake, not a precise quota. No core engine change, no new persistence, no Redis. Shared
distributed rate limiting and per-route quotas remain future work; GraphQL is out of scope
(read-only today).

## UPDATE 17 — Raw event command production gate (Hardening Phase 2)

`POST /commands/events` (raw canonical event append onto any stream) is the most
privileged write surface. Auth + the `x-actor-id` system-actor gate are necessary but not
sufficient: `x-actor-id` is an MVP transport header with no real verification, so a spoofed
`system` actor would unlock it. We therefore fail closed and gate the surface itself.

- New config helper `isRawEventCommandEnabled()` (`apps/api/src/shared/config.ts`):
  `ALLOW_RAW_EVENT_COMMAND` (true/false/1/0) overrides; otherwise the surface is enabled
  ONLY under `NODE_ENV=test` (where the AC-3 suite exercises it) and **disabled by default
  in dev/prod**. Setting `ALLOW_RAW_EVENT_COMMAND=true` is the explicit operator escape hatch.
- When disabled the handler answers with `reply.callNotFound()` — the framework's standard
  **404**, byte-identical to an unregistered route. This is the least-revealing response:
  it does not disclose that a privileged surface exists (vs. a 403 which confirms it). The
  gate runs before the auth/system-actor checks, so a disabled surface is 404 regardless of
  credentials, and no event is appended.

Scope/limits: the system-actor gate and transport auth still apply when the surface is
enabled — this change only removes the surface from the default production attack surface.
Real authN for the enabled case remains future work (see UPDATE notes on auth boundary).

## UPDATE 18 — PHI-safe audit/logging review (Hardening Phase 2)

Audit of the write/log surfaces for PHI leakage. Findings and disposition:

- **No PHI is logged today.** The Fastify logger (`server.ts`, on outside `NODE_ENV=test`)
  uses pino defaults — request *metadata* only (method/url/status/responseTime), never
  request or webhook bodies. Domain error messages carry field names / canonical ids
  (`consentId`, `permissionTypes`), not PHI values. The only concrete `IAuditSink` wired
  anywhere is `NoopAuditSink` (discards entries), so no audit row is persisted or logged.
- **Narrow fix applied** — `rules-engine/engine.ts` audit-failure path. It previously did
  `console.error('[RulesEngine] Audit sink error:', err)`, dumping the raw error. A future
  real sink could throw an error that echoes the row it tried to persist (which carries the
  full `RuleContext` = `eventPayload`/`objects` = PHI), leaking it to stdout. Now it logs
  only the error TYPE plus the entry's UUID (`entry ${id} not persisted`) — enough to
  correlate, no PHI. Locked in by a test that fails the build if the entry/PHI reappears in
  the log line.

### Decision packet (DEFERRED — do not implement speculatively)

`RuleAuditEntry.context` retains the **entire** `RuleContext`, including `eventPayload` and
`objects`, which carry PHI. This is latent: no persistent audit sink exists yet, so nothing
stores it today. When a real audit sink is built, it MUST NOT persist raw PHI. Options to
decide at that time (not now — building redaction with no consumer would be speculative and
out of scope for this hardening pass):

1. **Minimize at the entry boundary** — change `RuleAuditEntry` to store a redacted/derived
   context (ids, types, outcome, applied-rule reasons) instead of the raw payload/objects.
   Cleanest, but changes a shared type and what auditors can see.
2. **Redact in the sink** — keep the entry shape, require each `IAuditSink` to redact before
   persistence. Localizes the policy to the sink but is easy to get wrong per-sink.
3. **Encrypt-at-rest + access-controlled audit store** — retain full context but treat the
   audit log as a PHI store with its own encryption/retention/access policy.

Recommendation when the sink is built: (1) for the default sink (store derived, PHI-free
fields) with (3) available for a regulated full-fidelity audit store. Tracked here; no code
change in this slice beyond the narrow logging fix above.

## UPDATE 19 — GraphQL read-surface auth gate (Hardening Phase 2)

The `/graphql` read surface returns PHI / tenant-scoped read models (`object.attributes`,
`digitalCareTwin.patientAttributes`, `timeline`, `referralSourceStrength`; some list
resolvers are still `[]` stubs). It was registered in `server.ts` with **no auth hook**,
outside the transport-auth boundary and excluded from rate limiting — i.e. readable by any
caller on the network. The schema is read-only (no Mutation type) and GraphiQL is already
off in production, so the issue is purely access control on reads.

Narrow hardening applied (`shared/graphql-gate.ts`, wired in `server.ts`):

- **Auth gate** — an `onRequest` hook on the `/graphql` data path requires an authenticated
  actor (`x-actor-id`); missing → **401** before Mercurius runs. This puts the read surface
  on the SAME transport-auth boundary as the mutating REST commands. Config:
  `GRAPHQL_REQUIRE_AUTH` (true/false/1/0) overrides; otherwise **required outside tests,
  relaxed under `NODE_ENV=test`** so the existing AC-5/6/7 suite (which sends no header) is
  unaffected unless it opts in.
- **Availability kill-switch** — `GRAPHQL_ENABLED` (default ON; the read API is a real
  product surface). When `false`, Mercurius is not registered, so `/graphql` returns the
  framework's standard **404** (surface not disclosed). Read at build time.
- Tests cover all four: default-relaxed-in-test, explicit-required→401, explicit-required +
  valid actor→200, disabled→404.

### Decision packet (DEFERRED — needs real authN + resolver changes; HARD STOP for this slice)

The gate closes *unauthenticated* access but NOT **cross-tenant** access: every query takes
`tenantId` as a client-supplied argument and resolvers read that tenant's data directly, so
an authenticated caller can still name *any* tenant and read its PHI. Closing this correctly
requires deriving the caller's tenant/identity from a verified principal (real authN, not the
spoofable `x-actor-id` dev header) and enforcing it in the resolvers (or via RLS / a
tenant-scoped read gate). That is identity/authN + tenant-aware resolver work — explicitly
out of scope for this hardening pass. Options to decide later:

1. **Resolver-level tenant check** — compare the authenticated principal's tenant claim
   against the query `tenantId`; reject mismatches. Requires a real tenant claim on the
   principal.
2. **Tenant-scoped read gate** — route GraphQL reads through the same authorization/consent
   gate the reasoning engine uses, so PHI reads honor consent/participation, not just tenancy.
3. **RLS** — enforce tenant isolation in the database read path (note: full RLS enablement is
   itself a separately-scoped, deferred track).

Recommendation: (1) as the minimum once real authN lands, with (2) for PHI-bearing resolvers.
No resolver change in this slice.

## UPDATE 20 — Consent capture idempotency (Hardening Phase 2)

`POST /commands/consent` (capture/grant) was not idempotent: `ConsentCaptureService.capture`
→ `ConsentEngine.grant` → `createObject` always mints a fresh Consent id, so a double-click /
retry created **two distinct active Consent objects**. Closed by reusing the already-landed
**referral receipt-stream pattern** (UPDATE 15), keyed for consent.

- `ConsentCaptureService` gained an optional `eventStore` (3rd ctor arg). When wired (the API
  container passes it), capture is idempotent; when omitted (existing core tests) behaviour is
  unchanged — no dedup, no breakage.
- **Key derivation:** a content *fingerprint* = `deterministicId(tenant, subject, grantor,
  recipient, sorted permissionTypes, effectiveDate||'', expirationDate||'')`. The idempotency
  key is the caller's explicit `idempotency-key` header when present, else the fingerprint —
  so a duplicate submit dedups either way (no required new header; backward compatible).
- **Flow:** validate → **authorize (assertMayGrant)** → idempotency check. Authorization runs
  BEFORE the replay so an unauthorized actor gets 403 and never learns a matching consent
  exists. A per-capture receipt stream `deterministicId(tenant, 'consent-capture', key)` records
  `{fingerprint, consentId, eventId}` via a new `ConsentCaptureReceiptRecorded` event. On retry
  the receipt is replayed (same consentId/eventId, no second Consent); an explicit key reused
  with a DIFFERENT fingerprint throws `ConsentIdempotencyConflictError`.
- **REST mapping:** replay → **200** (nothing created) vs first capture **201**; conflict →
  **409**. `idempotency-key` header is read in the route (optional).
- Tests: core (first→one Consent; identical replay→same id + single ObjectCreated; different
  content→distinct; different explicit key→distinct; missing key→content-dedup; same key+diff
  content→conflict) and API end-to-end (200 replay, 201 distinct, 409 conflict).

Scope/limits & residuals (stated plainly):
- **Withdraw idempotency: now CLOSED in UPDATE 25** (was a residual here). A repeated withdraw
  of an already-revoked consent no longer appends a redundant `ObjectUpdated`.
- Same first-time **concurrency** window as the referral pattern: the Consent is created and the
  receipt appended in separate transactions, so two simultaneous first-time identical captures
  could still both create before either records a receipt. Documented platform-wide residual
  (needs a pre-write claim); unchanged by this slice.

## UPDATE 21 — HTTP security headers + CORS (Hardening Phase 2)

Audit of the HTTP edge: no security headers were set on any response, and although
`@fastify/cors` was a dependency it was **never registered** (so the API sent no CORS headers
— cross-origin was blocked by the browser default, safe but not a deliberate policy).
`@fastify/helmet` is not installed. Both pieces added in `apps/api/src/shared/http-security.ts`,
wired early in `server.ts` (before routes).

- **Security headers** — a dependency-free `onSend` hook (matches the rate-limit slice's
  "no new dep" convention; no Helmet) adds to EVERY response (routes, errors, 404s):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-DNS-Prefetch-Control: off`,
  `X-Permitted-Cross-Domain-Policies: none`. Default ON (`SECURITY_HEADERS_ENABLED`). No CSP —
  this is a JSON API plus the dev-only GraphiQL HTML, and a restrictive CSP would break GraphiQL.
- **HSTS** — opt-in (`HSTS_ENABLED`, default **OFF**; `HSTS_MAX_AGE` default 180d). HSTS pins a
  host to HTTPS and can lock out a misconfigured domain, and there is no known production origin
  in-repo, so it is deliberately not on by default. Enable per-environment once TLS is confirmed.
- **CORS** — registers the installed `@fastify/cors` with an env allowlist
  `CORS_ALLOWED_ORIGINS` (comma-separated). **Empty → `origin: false` (cross-origin DENIED, no
  ACAO)** — safer than a wildcard. A non-empty list reflects only those origins; preflight
  (OPTIONS) honors the same list. `credentials: false` (header auth, no cookies);
  `allowedHeaders` = content-type + the API's `x-actor-id` / `x-automynd-secret` /
  `idempotency-key`.
- Tests (`tests/http-security.test.ts`): default headers present (+ on 404), HSTS off by
  default / on when enabled, headers disablable; CORS denied by default, allowed origin
  reflected, non-allowlisted origin not reflected, preflight for an allowed origin.

### Owner decision (documented, not blocking)

`CORS_ALLOWED_ORIGINS` ships **empty (deny)** because no production frontend origin exists in
the repo or env. When a browser client (e.g. the portal) is deployed, the owner must set this
to that origin's exact URL(s) — do NOT use `*`. Same for `HSTS_ENABLED` once the API is served
over TLS behind its real hostname.

## UPDATE 22 — Webhook HMAC signing (DECISION PACKET — design only, NOT implemented)

Status: **DESIGN ONLY.** No runtime change. This records the agreed design so the
implementation slices can be approved and executed later. Supersedes the inline note in
`rest/routes.ts` ("Production: HMAC over the raw request body").

### Current behavior (as shipped)

`POST /webhooks/automynd` (`apps/api/src/rest/routes.ts`) authenticates with a **shared
secret header**: `secretsMatch(getHeader(req, 'x-automynd-secret'), getAutomyndWebhookSecret())`
— constant-time compare (`shared/auth.ts`) against env `AUTOMYND_WEBHOOK_SECRET`; fails closed
(401) when unconfigured/absent/mismatched. Replay protection is separate: a required
`idempotency-key` header drives `deterministicEventId(tenantId, 'automynd', key)`, and the
Event Store dedups by id (UPDATE 14). Fastify 4 uses its **default JSON parser — the raw
request bytes are not retained**.

### Threat model

The shared-secret header is the weak link:
- **Static bearer token.** The same secret is sent on every request. Anything that observes a
  request header (a logging proxy, an APM trace, a mis-set `console.log`, a compromised
  intermediary) captures a credential that grants full forgery ability until rotated.
- **No body integrity.** The secret does not bind to the payload, so a party that holds the
  secret can submit any body. There is no proof the body is the one Automynd produced.
- **No freshness.** A captured valid request can be replayed; today only the `idempotency-key`
  + Event-Store dedup blunts the *effect* of an exact replay, and only if the attacker reuses
  the same key. A new key with the same (captured) secret is accepted as fresh.

HMAC-over-raw-body with a timestamp fixes all three: the signing key is never transmitted, the
signature binds to the exact bytes, and the timestamp bounds freshness.

### Recommended signature scheme

- **Algorithm:** `HMAC-SHA256`, hex-encoded. Constant-time compare (reuse the
  `timingSafeEqual` approach in `shared/auth.ts`).
- **Signed payload (canonical string):** `"{timestamp}.{rawBody}"` — Stripe-style. Signing the
  timestamp *and* the raw body together prevents both body tampering and timestamp tampering.
  MUST sign the exact received bytes, never a re-serialized object (key order / whitespace
  differ → signature would never verify).
- **Versioned** so the algorithm can be upgraded without a flag day (`v1=` today).

### Headers / names

- `X-Automynd-Signature: t=<unix_seconds>,v1=<hex>,kid=<key-id>` (Stripe-style, atomic — the
  timestamp and signature travel together; `kid` selects the signing key for rotation, optional
  during single-key operation).
- Keep `idempotency-key` exactly as today (orthogonal; still required).
- Retire `x-automynd-secret` only at the end of rollout (see plan).

### Timestamp tolerance / replay window

- Reject when `|now − t| > TOLERANCE`. **Default ±300s (5 min)**, env-configurable
  (`WEBHOOK_TIMESTAMP_TOLERANCE_SEC`). Rationale: tolerate clock skew + delivery latency while
  keeping the replay window small.
- Defense-in-depth with the existing idempotency: an exact replay inside the window still
  produces **no duplicate event** (Event-Store dedup by `idempotency-key`); a replay outside the
  window is rejected by the timestamp check before any work. The two layers are complementary.

### Raw-body capture in Fastify 4 (dependency-free)

Register the webhook route inside an **encapsulated plugin context** and add a content-type
parser *only there* that retains the raw string before parsing JSON:

```
app.register(async (webhook) => {
  webhook.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body;
    try { done(null, JSON.parse(body)); } catch (e) { done(e as Error); }
  });
  webhook.post('/webhooks/automynd', { schema: automyndWebhookSchema }, handler);
});
```

Content-type parsers are **encapsulated** to the registering instance, so only the webhook route
buffers the raw body; every other route keeps the default parser. No new dependency (avoids
`fastify-raw-body`), consistent with the rate-limit / security-header slices.

### Key rotation

- **Keyset config** instead of a single secret: `AUTOMYND_WEBHOOK_KEYS` = comma-separated
  `kid:secret` pairs (the existing single `AUTOMYND_WEBHOOK_SECRET` maps to an implicit default
  `kid` for the dual-accept phase).
- **Verify:** if the request carries `kid`, verify against that key; if absent (or to support an
  overlap), try each active key with constant-time compare and accept on first match.
- **Rotate:** add new key (both active) → ask Automynd to switch sending key → after a soak,
  remove the old key. No downtime, no flag day.

### Interaction with existing idempotency

Unchanged and complementary. New ingress order: **(1) HMAC verify (signature + timestamp) →
(2) `idempotency-key` presence → (3) deterministic event id + Event-Store dedup append.** The
idempotency mechanism (`deterministicEventId`, UPDATE 14) is untouched; HMAC is an additional
gate in front of it. A valid-signature exact replay is still deduped to the same event.

### Rollout / backward-compatibility plan (no flag day)

Env flag `WEBHOOK_HMAC_MODE` with three states:
1. **`off`** (today's behavior): shared secret only.
2. **`dual`** (rollout): accept a request if **either** a valid HMAC **or** the legacy
   `x-automynd-secret` is present; emit a deprecation log/metric whenever a delivery passes on
   the legacy secret alone. Ship `dual` first so the current sender keeps working.
3. **`required`**: HMAC mandatory; legacy secret rejected. Flip once Automynd is confirmed
   signing and the deprecation metric is zero.

### Test plan (for the implementation slices)

- Raw-body slice: `request.rawBody` equals the exact bytes sent; other routes unaffected.
- HMAC helper (unit): correct signature verifies; wrong key / tampered body / tampered timestamp
  fail; non-hex / malformed header fails; constant-time path covered.
- Timestamp: within tolerance passes; just-outside fails; missing `t` fails.
- Modes: `off` → legacy only; `dual` → valid HMAC passes, legacy passes (+ deprecation signal),
  neither → 401; `required` → valid HMAC passes, legacy → 401.
- Rotation: signature under either active `kid` verifies; removed key fails.
- Idempotency unchanged: signed exact replay → still one event; signed-but-different payload
  under a reused `idempotency-key` → still 409.

### Exact implementation slices (if approved)

1. **Raw-body capture** — encapsulated webhook context + `request.rawBody`. Pure plumbing, no
   auth change; prove raw bytes captured and no other route affected. **✅ DONE (UPDATE 23).**
2. **HMAC verify helper + config** — `verifyWebhookSignature` (pure, unit-tested) and config
   helpers (`AUTOMYND_WEBHOOK_KEYS`, `WEBHOOK_TIMESTAMP_TOLERANCE_SEC`, `WEBHOOK_HMAC_MODE`). No
   wiring yet. **✅ DONE (UPDATE 24).**
3. **Wire `dual` mode** into the route (accept HMAC or legacy secret; deprecation signal on
   legacy). Default `dual`. Full ingress-order + mode tests.
4. **Flip to `required`** and remove the legacy secret path (separate, later, after sender
   migration).

Owner decision needed before slice 3: confirm Automynd's actual signing capability/header
format. If Automynd dictates a different header or scheme, adapt scheme/headers above to match
their contract — the rest of the design (raw-body, timestamp, rotation, modes) still holds.

## UPDATE 23 — Webhook raw-body capture (HMAC slice 1 of 4 — IMPLEMENTED)

Implements packet slice 1 from UPDATE 22. **No auth, idempotency, or shared-secret change** —
this is pure plumbing that makes the exact request bytes available for the later HMAC check.

- New `apps/api/src/shared/raw-body.ts`: `registerRawBodyJsonParser(instance)` installs a JSON
  content-type parser that stashes the exact received string on `req.rawBody`, then delegates to
  `instance.getDefaultJsonParser('error', 'error')` — Fastify's own default parser with the
  framework-default poisoning actions — so empty-body, prototype/constructor-poisoning, and
  400-on-malformed are byte-for-byte identical to every other JSON route. `getRawBody(req)`
  accessor + `RawBodyRequest` type. No new dependency.
- `rest/routes.ts`: the `/webhooks/automynd` route is now registered inside an encapsulated
  `app.register(async (webhook) => { registerRawBodyJsonParser(webhook); webhook.post(...) })`
  context. Content-type parsers are encapsulated, so **only** the webhook buffers the raw body;
  all other routes keep the default parser. The handler body is unchanged.
- Nothing reads `req.rawBody` yet — it is captured for slice 2's `verifyWebhookSignature`.
- Tests (`tests/raw-body.test.ts`): the helper in a mini app proves byte-exact capture (with
  irregular whitespace), faithful JSON parse, 400-on-malformed, and **encapsulation** (a sibling
  route on the parent gets no `rawBody` and still parses); the real `/webhooks/automynd` route
  still returns 200 for a valid delivery and 400 for malformed JSON. The existing webhook suite
  (`rest.test.ts`) passing is the regression proof that auth/idempotency are unaffected.

Next: slice 2 — `verifyWebhookSignature` helper + config (`AUTOMYND_WEBHOOK_KEYS`,
`WEBHOOK_TIMESTAMP_TOLERANCE_SEC`, `WEBHOOK_HMAC_MODE`), still unwired.

## UPDATE 24 — Webhook HMAC verifier + config (HMAC slice 2 of 4 — IMPLEMENTED, UNWIRED)

Implements packet slice 2. **Pure helper + config only — NOT called by the route.** The
webhook still authenticates with the shared secret exactly as before; nothing here changes
runtime behavior.

- New `apps/api/src/shared/webhook-hmac.ts` (pure, no Fastify, no env):
  - `parseSignatureHeader('t=,v1=,kid=')` → `{timestamp, v1, kid?}` or null (order-independent;
    rejects missing/non-integer `t`, missing/non-hex `v1`).
  - `computeWebhookSignature(secret, t, rawBody)` = `HMAC-SHA256(secret, "{t}.{rawBody}")` hex.
  - `verifyWebhookSignature({header, rawBody, keys, toleranceSec, nowSec?})` →
    `{valid:true, kid?}` or `{valid:false, reason}` where reason ∈ `malformed_header` /
    `timestamp_out_of_tolerance` / `no_keys_configured` / `unknown_kid` / `signature_mismatch`.
    Order: parse → timestamp tolerance (`|now−t| ≤ toleranceSec`, signed `t` so tampering also
    fails the signature) → key resolution → constant-time compare (reuses `secretsMatch`).
  - **Key rotation:** a named `kid` must exist in the keyset (else `unknown_kid` — no silent
    fallback to other keys); an absent `kid` tries every active key and accepts the first match
    (supports an overlap window). Removing a key stops its signatures verifying.
- Config (`shared/config.ts`, parsed but unenforced): `WEBHOOK_SIGNATURE_HEADER`
  (`x-automynd-signature`); `parseWebhookKeys` / `getWebhookKeys` (`AUTOMYND_WEBHOOK_KEYS`,
  `kid:secret` comma list — first `:` splits, malformed entries skipped, dup kid last-wins);
  `getWebhookTimestampToleranceSec` (`WEBHOOK_TIMESTAMP_TOLERANCE_SEC`, default 300, invalid→300);
  `getWebhookHmacMode` (`WEBHOOK_HMAC_MODE` → `off`|`dual`|`required`, default `off`, invalid→`off`).
- Tests (`tests/webhook-hmac.test.ts`, 47 cases): valid (with/without kid), wrong secret,
  tampered body, tampered timestamp (in-window → mismatch), expired/future timestamp, boundary,
  malformed headers, unknown kid, no keys, uppercase-hex, rotation overlap + key removal, uniform
  failure reason, and all config defaults/invalid values.

Slice 2 deliberately does NOT pick a runtime default beyond `off`; slice 3 will move the
operative default to `dual` when it wires the verifier into the route. **Owner confirmation of
Automynd's actual signature header/format is still required before slice 3.**

## UPDATE 25 — Consent withdraw idempotency (Hardening Phase 2)

Closes the withdraw residual noted in UPDATE 20. `ConsentEngine.transition` (the shared
revoke/expire path) loaded the consent and then **unconditionally** called `updateObject`, so a
repeated withdraw of an already-`revoked` consent appended a redundant `ObjectUpdated`
re-setting `status`/`revokedAt` (same terminal state, but a spurious event each time).

- `consent-store/engine.ts` `transition`: after loading `current`, short-circuit when the
  consent already holds the target status — `current.attributes.status === changes.status` →
  return the current state with **no** `updateObject` call. Only the *exact same-status* repeat
  short-circuits; a transition to a DIFFERENT status (e.g. revoke an expired consent) still
  proceeds, so behavior is otherwise unchanged. Applies to `expire` too (idempotent expire).
- `ConsentMutationResult` / `WithdrawConsentResult` gain an additive `idempotentReplay?: boolean`;
  on a no-op `eventId` is `''` (no new event id). Response shape is preserved (every result still
  carries `eventId`); the API withdraw still returns **200** on the repeat, so the response is
  stable and successful.
- Preserved: authorization (`assertMayWithdraw` still runs first in `ConsentCaptureService`),
  validation, and the optimistic-concurrency guard on the REAL update path (first withdraw still
  updates with `expectedVersion: current.version`). The no-op path performs no write, so it does
  not touch the version.
- Tests: core `consent-capture.test.ts` (first withdraw → one `ObjectUpdated`; repeat → none +
  `idempotentReplay`/empty eventId; stable response across repeats; a *different* consent still
  appends its own event; version bumps on the real update, unchanged on the no-op) and API
  `consent.test.ts` (repeat withdraw → 200, stable, no extra event).

Out of scope (unchanged): consent *capture* idempotency (UPDATE 20) and the first-time
concurrency window. This slice does not touch the webhook, HMAC, GraphQL, CORS, or rate limiting.

## UPDATE 26 — Identity & tenant boundary (DECISION PACKET — design only, NOT implemented)

Full packet in `docs/architecture/identity-tenant-boundary.md`. Records the design for the first
production-grade identity + tenant boundary — the remaining true production blocker after the P0/P2
hardening. **No runtime change.**

Core finding: AlaraOS already has rich **policy-based AuthZ** (ADR-014 participation roles,
`ConsentAuthorizer`, `RetrievalPermissionGate`) but **no AuthN** — `x-actor-id` and `tenantId` are
both unverified client inputs, so impersonation (incl. a `system` actor) and cross-tenant PHI
access are open. The packet introduces a verified `Principal` (user/service/system/external) whose
claims (tenant membership, roles, scopes) replace trust in the header; tenant is **derived from the
principal**, not the request; cross-tenant requests are blocked at the boundary (closes the UPDATE
19 GraphQL gap and the REST body-tenant gap). AuthZ stays two-layer: coarse boundary RBAC + the
existing per-subject policies. Migration mirrors the HMAC rollout (`AUTH_MODE` legacy→dual→required).
This packet is the **prerequisite for real RLS** (`tenancy-rls.md` §6 consumes the principal-derived
tenant). First slice if approved: the **Principal abstraction** (internal, no behavior change).

Distinct from `identity-resolution-spec.md` (patient matching) — see packet §0.

## UPDATE 27 — Principal abstraction, legacy mode (identity boundary SLICE 1 — IMPLEMENTED)

Implements slice 1 of the identity/tenant packet (UPDATE 26 / `identity-tenant-boundary.md`).
**Internal refactor, NO behavior change** — proven by all pre-existing tests passing unchanged.

- `apps/api/src/shared/auth.ts`: new `Principal` type (`principalId`, `type`, `tenants`, `roles`,
  `scopes`, `legacyActorId`) + `PrincipalType`; `legacyPrincipal(actorId)` (pure) and
  `authenticatePrincipal(req)` (derives a legacy principal from `x-actor-id`, `undefined` when
  absent). `getAuthenticatedActor(req)` now returns `authenticatePrincipal(req)?.principalId` —
  byte-identical to the previous header read.
- **Legacy-mode claims are minimal and inert:** `type: 'user'`, empty `tenants`/`roles`/`scopes`.
  Nothing consumes the principal's claims yet; tenant is still taken from the request, and the
  `/commands/events` privileged gate still uses `isSystemActor` (untouched). The system→scope
  mapping, token verification, and tenant binding are explicitly later slices (2–4).
- No new dependency; GraphQL/REST/webhook/consent behavior unchanged.
- Tests (`apps/api/tests/principal.test.ts`, +9): legacy principal shape; `authenticatePrincipal`
  present/absent/whitespace; system actor yields an ordinary legacy principal (no special-casing);
  `getAuthenticatedActor` behavior-compat; and integration — referral success (201), missing actor
  (401), `/commands/events` system-actor gate (201 vs 403), GraphQL query unchanged (200).

Next: slice 2 — token verification in `dual` mode (`AUTH_MODE`), still without tenant enforcement.

## UPDATE 28 — System actor → scope gate (identity boundary SLICE 4, partial — IMPLEMENTED)

Migrates the `/commands/events` privileged gate from a raw actor-string check to a
principal-**scope** check, building on the Principal abstraction (UPDATE 27). **NO external
behavior change** — the allow/deny decision is identical for the same inputs.

- `apps/api/src/shared/auth.ts`: new `SYSTEM_SCOPE = 'system:*'`; `legacyPrincipal` now maps a
  configured system actor (`isSystemActor` → `ALARA_SYSTEM_ACTORS`, default `system`) to
  `type: 'system'` with `scopes: [SYSTEM_SCOPE]` (non-system actors stay `type: 'user'`, empty
  scopes). New `principalHasScope(principal, scope)` helper. `auth.ts` now imports `isSystemActor`
  from `config.ts` (one-directional, no cycle).
- `apps/api/src/rest/routes.ts`: the `/commands/events` gate uses `authenticatePrincipal(req)` →
  401 if absent → `principalHasScope(principal, SYSTEM_SCOPE)` → 403 if absent; `actor` is now
  `principal.principalId` (same value as the prior header read). `isSystemActor` is no longer
  imported here.
- **Why behavior-preserving:** the scope is granted exactly when `isSystemActor(actorId)` was
  true, and the env is read per request as before — so configured system actor → 201, non-system
  → 403, missing → 401, all unchanged. `isSystemActor`/`getSystemActors` remain in `config.ts`
  (now consumed by `auth.ts`); `ALARA_SYSTEM_ACTORS` remains the configuration source.
- Scope: ONLY the raw-event gate. No other command gained a role/scope gate (broader per-command
  RBAC is still future work). GraphQL/consent/referral/webhook unchanged.
- Tests (`apps/api/tests/principal.test.ts`): system actor → `type:'system'` + `[SYSTEM_SCOPE]`;
  non-system → no scope; `/commands/events` gate 201/403/401 preserved; `principalHasScope` unit;
  plus the unchanged referral/missing-actor/GraphQL cases.

Next: slice 2 — token verification in `dual` mode (the IdP-dependent slice); or slice 3 — tenant
derivation + cross-tenant block.

## UPDATE 29 — IdP / token strategy (OWNER DECISION PACKET — design only, NOT implemented)

Full packet in `docs/architecture/idp-token-decision.md`. Forces the single owner decision that
unblocks the remaining security-closing identity slices (token dual-mode, tenant derivation,
GraphQL tenant block, RLS session-tenant). **No runtime change.**

The Principal plumbing is ready (UPDATE 27–28); the missing piece is a **trusted claims source**.
The packet compares four options (local/dev JWT · managed OIDC · session-cookie · service-token
only) and recommends a **two-track approach sharing one verifier**: short-term **local/dev RS256
JWT** (+ test-token factory) to unblock Slices 2–3 now without a vendor, and **managed BAA-signed
OIDC** for production staff with **service tokens** for machine/system principals — using **RS256 +
JWKS** from day one so dev and production verify through the same code path. Specifies the required
token claims mapped to `Principal` (`sub`→principalId, `tenants`, `roles`, `scope`,
`principal_type`). The only decisions that gate *starting* Slice 2: (a) RS256+JWKS as the scheme,
(b) the tenant membership model (single vs multi-tenant). Vendor/frontend questions can run in
parallel. Risk of delay: `x-actor-id` stays spoofable → impersonation + cross-tenant PHI remain
open, RLS stays inert, and Slices 2/3/5 cannot proceed.

## UPDATE 30 — Token verification + AUTH_MODE (identity boundary SLICE 2 — IMPLEMENTED, default OFF)

Implements the approved RS256-JWT verification scaffold (owner decision UPDATE 29). **Default
behavior is unchanged** (`AUTH_MODE=legacy`): all 145 pre-existing API tests pass untouched.

- New `apps/api/src/shared/jwt.ts` — PURE, dependency-free RS256 verifier (Node `crypto` only,
  no jsonwebtoken/jose). `verifyJwt({token, publicKey, issuer, audience, nowSec?})` →
  `{valid, principal}` or `{valid:false, reason}` (`malformed` / `unsupported_alg` /
  `bad_signature` / `expired` / `not_yet_valid` / `issuer_mismatch` / `audience_mismatch` /
  `invalid_claims`). **Security:** only `alg: RS256` accepted (rejects `none`/HS*/others —
  no algorithm confusion); signature verified before any claim is trusted; `exp` required;
  `iss`/`aud` matched; `nbf` honored. Claim mapping → `Principal`: `sub`→principalId,
  `principal_type`→type (validated, default `user`), `tenants[]`, `roles[]`, `scope`
  (space-delimited) or `scopes[]`. VENDOR-NEUTRAL — verifies against a configured key, no IdP
  named.
- Config (`config.ts`): `getAuthMode()` (`legacy|dual|required`, default `legacy`, invalid→legacy),
  `getAuthIssuer()`/`getAuthAudience()`, `getAuthPublicKey()` (PEM from `AUTH_PUBLIC_KEY`, `\n`
  un-escaped) — a local/dev key source; a production JWKS-URL-by-`kid` resolver is a later slice.
- `auth.ts`: `getBearerToken(req)` (Authorization: Bearer); `authenticatePrincipal` now honors
  `AUTH_MODE` — `legacy` = byte-identical x-actor-id; `dual` = prefer a verified token principal,
  else legacy fallback; `required` = token mandatory, legacy rejected. `auth.ts→jwt.ts` runtime
  import (jwt.ts imports only the `Principal` TYPE from auth.ts → no runtime cycle).
- **Not done in this slice (by design):** NO tenant derivation/enforcement (the verified `tenants`
  claim is populated but unused — tenant still from the request), NO GraphQL tenant change, NO
  legacy deprecation signal yet, NO production JWKS fetch, no new dependency.
- Tests (`apps/api/tests/jwt-auth.test.ts`, +23): RS256 keypair + signed test tokens via Node
  crypto; claim mapping; expired/nbf/iss/aud/missing-exp/missing-sub/`alg:none`/tampered/wrong-key/
  malformed rejections; and the legacy/dual/required wiring (incl. fail-safe legacy fallback when
  the token is invalid or auth config is incomplete).

Next: slice 3 — tenant derivation + cross-tenant block (REST 403), reading the now-verified
`principal.tenants`.

## UPDATE 31 — REST tenant membership block (identity boundary SLICE 3, partial — IMPLEMENTED)

Enforces the first tenant boundary on REST mutating commands, reading the verified
`principal.tenants` from UPDATE 30. **Default `legacy` behavior unchanged** (all 168 pre-existing
API tests pass). Owner rule: a request `tenantId` must be in the principal's `tenants` **when the
principal is verified**; legacy principals stay backward-compatible.

- `apps/api/src/shared/auth.ts`: `isVerifiedPrincipal(principal)` (true when no `legacyActorId`,
  i.e. token-derived) and `isTenantAllowed(principal, tenantId)` — legacy → always allowed;
  verified → `tenants.includes(tenantId)` (**empty membership fails closed**). Membership check
  only; no tenant derivation/defaulting.
- `apps/api/src/rest/routes.ts`: the four principal-authed mutating commands —
  `/commands/referrals`, `/commands/events`, `/commands/consent`, `/commands/consent/withdraw` —
  now switch from `getAuthenticatedActor` to `authenticatePrincipal` (equivalent: `principalId`
  is the old actor) and, after reading the body `tenantId`, return **403** when
  `!isTenantAllowed(principal, tenantId)`. The check runs before the engine, so a denied request
  mutates nothing. Order on `/commands/events`: system-scope gate (403) then tenant block (403).
  `getAuthenticatedActor` is no longer imported here (still exported for `graphql-gate`).
- **Excluded (hard stop):** `/webhooks/automynd` (shared-secret ingress, not principal-authed) is
  untouched. **NOT done:** GraphQL tenant behavior (unchanged), tenant derivation/defaulting, RLS.
- **Why legacy is unchanged:** under default `AUTH_MODE=legacy` every principal is legacy
  (`legacyActorId` set) → `isTenantAllowed` returns true → byte-identical behavior.
- Tests (`apps/api/tests/tenant-block.test.ts`, +10, RS256 keypair via Node crypto): legacy
  referral 201; verified token matching tenant 201; non-matching 403 (nothing created); empty
  tenants 403 (fail closed); multi-tenant token reaches either tenant; dual fallback to legacy on
  missing/invalid token; consent enforced; events scope+tenant interaction (201 / wrong-tenant 403
  / no-scope 403); required-mode legacy rejected 401.

Next: slice 5 — the GraphQL tenant block (closes UPDATE 19), then the production JWKS resolver.

## UPDATE 32 — GraphQL tenant membership block (identity boundary SLICE 5, partial — IMPLEMENTED)

Extends the REST tenant block (UPDATE 31) to the GraphQL read surface, **closing the
cross-tenant PHI gap from UPDATE 19's decision packet**. **Default behavior unchanged** (all 178
pre-existing API tests pass, incl. the AC-5/6/7 GraphQL suite).

- `apps/api/src/server.ts`: the Mercurius registration gains a `context` factory —
  `context: (request) => ({ principal: authenticatePrincipal(request) })` — so resolvers receive
  the authenticated principal (honoring `AUTH_MODE`).
- `apps/api/src/graphql/resolvers.ts`: a `GqlContext` type + `assertTenantAllowed(context,
  tenantId)` guard reusing `auth.isTenantAllowed`. It is called at the top of **every
  tenant-scoped resolver** — `object`, `workflow`, `timeline`, `digitalCareTwin`,
  `referralSourceStrength`, and the `tasksByWorkflow`/`promisesByWorkflow`/
  `communicationsBySubject` stubs (8 total). A verified token principal querying a tenant not in
  its `tenants` (empty → fail closed) throws → a **safe GraphQL error with null data** (HTTP 200,
  no PHI in the response). Legacy principals and the relaxed unauthenticated path (no principal)
  are unenforced → unchanged.
- **Why legacy is unchanged:** under default `AUTH_MODE=legacy` / the test-relaxed gate, a query
  carries no token; `context.principal` is undefined (or a legacy principal) → `assertTenantAllowed`
  returns without throwing → byte-identical.
- **Scope:** schema shape unchanged; no tenant derivation/defaulting; no `RetrievalPermissionGate`
  routing yet (consent/participation on reads is still future); REST/webhook/RLS untouched.
- Tests (`apps/api/tests/graphql-tenant-block.test.ts`, +7, RS256 keypair via Node crypto): legacy
  default returns data; verified matching-tenant returns data; **non-member tenant → error + NO
  PHI leaked** (asserts the patient name is absent from the response); empty tenants fail closed;
  multi-tenant token reaches either allowed tenant; the block also covers the `object` resolver.

With UPDATE 31 (REST) + UPDATE 32 (GraphQL), the UPDATE 19 cross-tenant decision packet is
addressed across **both** write and read surfaces for verified principals. Next: production JWKS
resolver (key rotation) before turning `AUTH_MODE=dual` on against a real IdP.

## UPDATE 33 — Production JWKS resolver (DECISION PACKET — design only, NOT implemented)

Full packet in `docs/architecture/jwks-resolver.md`. Designs the move from a single static
`AUTH_PUBLIC_KEY` to JWKS-by-`kid`, the last piece before `AUTH_MODE=dual` can run against a real
managed IdP. **No runtime change.**

Crux: `verifyJwt`/`authenticatePrincipal` are **synchronous** and the hot path (REST handlers +
GraphQL `context` factory) calls them with no `await`. JWKS fetching is async, so the design keeps
the hot path sync by reading an in-memory **cache** (`Map<kid,KeyObject>`, TTL + last-known-good +
min-interval throttle) populated by a **non-blocking background refresher** — startup never blocks
on the IdP. `verifyJwt` gains a sync key-**resolver** `(kid?) => KeyObject | undefined`; the current
single key becomes a one-entry resolver, JWKS a cache-backed one. Rotation is overlap-based (no
deploy). Fail-closed: unresolvable `kid` → `dual` falls back to legacy, `required` → 401.
Dependency-free (Node built-in `fetch`; JWK→KeyObject via `createPublicKey({format:'jwk'})`).
Vendor-neutral — `AUTH_JWKS_URL`/issuer/audience are config, standard RFC-7517 JWKS + RS256, no
vendor SDK. Four implementation slices; recommended first = the **key-resolver refactor** (sync, no
behavior change, no network, no IdP decision needed).

## UPDATE 34 — JWT key-resolver refactor (JWKS slice 1 — IMPLEMENTED, no network)

Implements JWKS slice 1 (UPDATE 33): make `verifyJwt` key selection `kid`-aware via a synchronous
resolver, turning the single-key assumption into a drop-in seam for the future JWKS cache. **No
network, no dependency, no external behavior change** (all 185 pre-existing API tests pass).

- `apps/api/src/shared/jwt.ts`: new `KeyResolver = (kid?) => string | KeyObject | undefined` and
  `singleKeyResolver(key)`. `TokenVerifyOptions.publicKey` → `resolveKey: KeyResolver`. `verifyJwt`
  now reads `kid` from the (already-decoded) header, calls `resolveKey(kid)`, and **fails closed
  (`unknown_kid`) when the resolver returns `undefined`** — before signature verification. All other
  validation is byte-identical: RS256-only, signature-before-claims, `iss`/`aud`/`exp`/`nbf`, claim
  mapping. New failure reason `unknown_kid` added to the union.
- `apps/api/src/shared/auth.ts`: `tokenAuthenticate` adapts the single configured `AUTH_PUBLIC_KEY`
  into `singleKeyResolver(publicKey)` — same key, same result; the JWKS-backed resolver (a later
  slice) drops in here without touching this call. `authenticatePrincipal` external behavior
  unchanged.
- **Not done (by design):** no JWKS fetch, no cache, no network, no config change (`AUTH_PUBLIC_KEY`
  still the only key source). Those are JWKS slices 2–4.
- Tests (`apps/api/tests/jwt-auth.test.ts`, +6): token with `kid` resolves and verifies; unknown
  `kid` → `unknown_kid` (fail closed); absent `kid` works with the single-key resolver; resolver
  returning the WRONG key → `bad_signature` (not `unknown_kid`); resolver returning `undefined` →
  `unknown_kid`; claim mapping preserved for a `kid` token. The existing single-key suite now runs
  through `singleKeyResolver`, and the dual/required wiring + tenant-block suites (which call
  `tokenAuthenticate`) pass unchanged.

Next: JWKS slice 2 — the dependency-free, injectable JWKS cache + fetcher (still unwired).

## UPDATE 35 — JWKS cache/fetcher module (JWKS slice 2 — IMPLEMENTED, unwired)

Implements JWKS slice 2 (UPDATE 33): a dependency-free, injectable JWKS cache exposing the
synchronous `KeyResolver` that `verifyJwt` (UPDATE 34) consumes. **NOT imported by auth — zero
runtime behavior change** (all 191 pre-existing API tests pass); the production `fetch` adapter
and wiring are JWKS slice 3.

- New `apps/api/src/shared/jwks.ts` (Node `crypto` only — no `jose`/`jwks-rsa`):
  - `parseJwks(raw)` → `Map<kid, KeyObject>` (or `undefined` for a malformed `{keys:[…]}`). Accepts
    only RSA signing keys (`kty:RSA`; `use:sig`/`alg:RS256` when stated; `kid`+`n`+`e` required);
    JWK→KeyObject via `createPublicKey({ format:'jwk' })`; unparseable entries skipped.
  - `JwksCache` with an **injected** async `fetcher`, **TTL** staleness, **min-interval throttle**
    (anti-storm), and **last-known-good** (a failed fetch / malformed / empty document keeps the
    prior keys). `resolve(kid?)` is **synchronous** (cache read; no `kid` + exactly one key → that
    key, else undefined); `resolver()` returns a `KeyResolver`; `maybeRefresh()`/`refresh()` are the
    async population path. Injectable clock for deterministic tests.
- **By design, NOT done:** no real network, no `fetch` call, no auth/config wiring, no dependency.
- Tests (`apps/api/tests/jwks.test.ts`, +12, real RSA keypairs + fake fetcher + injected clock):
  parse RSA/skip non-RSA·enc·RS512·keyless·no-params; successful fetch populates; known/unknown kid;
  **the resolver verifies a token through `verifyJwt`** (end-to-end of the module); resolver is
  synchronous; TTL triggers refresh; fetch-failure and malformed-response keep last-known-good;
  **rotation** (add overlap, retire old); min-interval throttle blocks storms; no-kid single/ambiguous/empty.

Next: JWKS slice 3 — wire it behind `AUTH_JWKS_URL` with a Node-`fetch` adapter + non-blocking
background refresh; `authenticatePrincipal` stays synchronous.

## UPDATE 36 — JWKS runtime-wiring readiness audit (design only, NO code change)

Readiness audit for JWKS slice 3 (the wiring slice). Full implementation spec is
`jwks-resolver.md` Appendix A. **No runtime change.**

Findings: slices 1–2 leave a clean one-line swap point — `tokenAuthenticate` already builds
`resolveKey: singleKeyResolver(publicKey)`, and `JwksCache.resolver()` is a drop-in `KeyResolver`.
What remains is entirely additive: a `getAuthJwksUrl()` config helper (does not exist yet), a
~8-line dependency-free Node-`fetch` adapter with `AbortSignal.timeout`, a process-singleton
`JwksCache` with an **injectable** fetcher, a **non-blocking** startup warm (`maybeRefresh().catch()`,
never awaited), and a resolver-precedence change (`AUTH_JWKS_URL` → JWKS resolver; else
`AUTH_PUBLIC_KEY` → static; else none). `authenticatePrincipal` stays synchronous (cache read).
**Not blocked by the production IdP:** the wiring is generic RFC-7517 and fully testable with an
injected fake fetcher + a local RSA keypair — no vendor, no real network. Fail-closed is inherited
(cold cache / unknown `kid` → `verifyJwt` `unknown_kid` → `dual` falls back to legacy, `required` →
401). Strictly flag-gated, so default/legacy behavior stays byte-identical; rollback = unset
`AUTH_JWKS_URL`. Recommendation: implement slice 3 now; the IdP/JWKS URL + Node ≥18 confirmation gate
only *enablement* and run in parallel.

## UPDATE 37 — JWKS runtime wiring behind AUTH_JWKS_URL (JWKS slice 3 — IMPLEMENTED, flag-gated)

Wires the `JwksCache` (UPDATE 35) into runtime token verification behind `AUTH_JWKS_URL`.
**Default behavior unchanged** (`AUTH_JWKS_URL` unset → the static `AUTH_PUBLIC_KEY` path): all 203
pre-existing API tests pass. Dependency-free, no IdP vendor; vendor-specific values are config only.

- Config (`config.ts`): `getAuthJwksUrl()` (when set, JWKS takes precedence), `getAuthJwksCacheTtlSec()`
  (default 600), `getAuthJwksTimeoutMs()` (default 3000).
- New `apps/api/src/shared/jwks-runtime.ts`: `fetchJwks(url, timeoutMs)` — the only real I/O —
  uses Node's global `fetch` + `AbortSignal.timeout` (no dependency); a **process-singleton**
  `JwksCache` with an **injectable** fetcher (tests inject a fake — no network);
  `getJwksResolver()` returns the cache's **synchronous** resolver and kicks a fire-and-forget
  `maybeRefresh()` (never awaited → hot path stays sync); `warmJwks()` (non-blocking, never
  rejects). `configureJwksForTests()` injects fetcher/timing for deterministic tests.
- `auth.ts` `tokenAuthenticate`: resolver precedence — `getJwksResolver()` (JWKS when configured,
  even cold) **else** `singleKeyResolver(AUTH_PUBLIC_KEY)` **else** fail closed. `authenticatePrincipal`
  remains synchronous.
- `server.ts`: `void warmJwks()` at build — non-blocking, never fails/blocks startup; no-op when
  `AUTH_JWKS_URL` is unset.
- **Fail-closed:** a cold cache / unreachable JWKS / unknown `kid` → resolver `undefined` →
  `verifyJwt` `unknown_kid` → no token principal → `dual` falls back to legacy `x-actor-id`,
  `required` → reject. **Rollback:** unset `AUTH_JWKS_URL` (static key) or `AUTH_MODE=legacy`.
- Tests (`apps/api/tests/jwks-wiring.test.ts`, +7, injected fake fetcher + local RSA keypair, no
  network): default static path unchanged; JWKS precedence over `AUTH_PUBLIC_KEY`; warm + valid kid
  succeeds; unknown kid → dual→legacy; cold cache → dual→legacy / required→reject; fetch failure
  preserves last-known-good; rotation (new kid usable, old retired).

This completes JWKS slices 1–3. Remaining for production *enablement* (config + owner): set
`AUTH_JWKS_URL`/issuer/audience against the chosen IdP and flip `AUTH_MODE` legacy→dual→required.

## UPDATE 38 — Legacy auth fallback deprecation signal (identity boundary)

Adds the operational signal needed to drive `dual`-mode legacy usage to zero before the
`AUTH_MODE=required` cutover. **No auth decision / response / status-code change** (all 210
pre-existing API tests pass); this is a side-effect only.

- New `apps/api/src/shared/deprecation.ts`: a small, spy-able sink. `emitDeprecation(signal)` with a
  structured **PHI-safe** `DeprecationSignal { event, mode, reason, principalId? }`; the default sink
  emits one `console.warn` line and is **silent under `NODE_ENV=test`** (matches the Fastify logger
  toggle). `setDeprecationSinkForTests` captures emissions deterministically. The `principalId` is
  **length-bounded** (≤64 + ellipsis) — defensive against oversized header input.
- `auth.ts` `authenticatePrincipal`: in `dual` mode, when no valid token principal is available AND
  the legacy `x-actor-id` fallback **admits** a request, emit
  `{ event: 'auth.legacy_fallback', mode: 'dual', reason: 'legacy_actor_fallback', principalId }`.
  The returned principal is unchanged.
- **PHI-safety:** the signal carries ONLY bounded, non-sensitive metadata — never the request body,
  `tenantId`, token, raw headers, or PHI. Asserted by a test that confirms the serialized signal
  contains no `Bearer`, no JWT segment, no tenant claim, and no `authorization`.
- **No signal** in `legacy` mode, when a valid token is used, when nothing is admitted (no token +
  no legacy actor), or in `required` mode (legacy is rejected) — each covered by a test.
- Tests (`apps/api/tests/deprecation-signal.test.ts`, +8, injected capturing sink — no console spy,
  no network).

Next (code, unblocked): none required before enablement — the remaining identity work is the
owner-gated `dual`→`required` cutover (watch this signal → zero) and the deferred RLS milestone.

## UPDATE 39 — Tenant-scoped DB helper (RLS milestone step 1 — IMPLEMENTED, opt-in, RLS-inert)

Implements step 1 of the deferred RLS milestone (`tenancy-rls.md` §6): a pure, opt-in helper to
run a unit of work with `app.tenant_id` set for the transaction. **Changes nothing today** — all
650 core tests pass; no call site uses it; RLS stays inert.

- New `packages/core/src/shared/tenant-scope.ts`: `withTenantTransaction(db, tenantId, fn)` wraps
  the EXISTING `DatabaseClient.transaction()` (the only place with a stable connection — `query`/
  `queryOne` borrow arbitrary pooled connections, §5) and binds the GUC via a **parameterized**
  `set_config('app.tenant_id', tenantId, true)` (`is_local=true` → transaction-scoped; SET LOCAL
  cannot bind params, so set_config is the injection-safe form). Exports `TENANT_GUC` and a minimal
  `TenantScopedDb { transaction }` interface (structurally satisfied by `DatabaseClient` and the
  in-memory double). Exported from the core index.
- **Why this does NOT enable RLS / change behavior:** RLS is scaffolded but inert (owner role
  bypasses it; the GUC is unread — §2), so setting `app.tenant_id` is a no-op on results. The helper
  is **opt-in and unused** — no repository routes through it, no PG policy added, no `WITH CHECK`, no
  `FORCE`, no role change. It is purely the seam steps 2–5 will adopt later.
- Tests (`packages/core/tests/tenant-scope.test.ts`, +4, mocked transaction — no real Postgres):
  sets the GUC first via parameterized `set_config` inside the transaction then runs fn; tenant id
  is a bound value (injection-safe — a `DROP TABLE` payload never enters the SQL text); fn errors
  propagate and roll back; `TENANT_GUC === 'app.tenant_id'` matches the policy.

Remaining RLS steps (still NOT started, owner/harness-gated): route reads/writes through the helper
(step 2), `WITH CHECK` policies (3), `FORCE ROW LEVEL SECURITY` / non-owner role (4), and a
real-Postgres integration harness (5). App-level `WHERE tenant_id` + the tenancy guard test remain
the contract until then.

## UPDATE 40 — Real-Postgres RLS integration harness (RLS milestone step 5 — STARTED, OPT-IN)

Adds the test harness that must exist before any RLS enablement or call-site migration
(`tenancy-rls.md` §6 step 5). **Default behavior + default test suite unchanged**: the harness is
strictly opt-in and self-skips without Postgres (proven: 1 suite / 4 tests **skipped** when
`ALARA_TEST_DATABASE_URL` is unset). No production code changed; no RLS enabled in app schemas.

- New `packages/core/tests/tenant-scope.integration.test.ts`: `describe.skip` unless
  `ALARA_TEST_DATABASE_URL` is set; connects only inside `beforeAll` (skipped blocks run no hooks →
  no connection when unconfigured). Uses `new DatabaseClient({ connectionString, max: 1 })` so all
  calls pin to one connection — which makes the session-local TEMP-table fixture persist AND makes
  the no-leak assertion genuinely distinguish `SET LOCAL` (rolled back at COMMIT) from a session
  `SET`. Proves: (1) `withTenantTransaction` sets `current_setting('app.tenant_id', true)` in the
  transaction; (2) the GUC does NOT leak outside the transaction; (3) nor after a rollback; (4)
  **RLS isolation end-to-end** — a TEMP table with `ENABLE`/`FORCE ROW LEVEL SECURITY` and a
  `tenant_isolation` policy returns only the current tenant's rows per `withTenantTransaction`
  tenant. Entirely fixture-local (TEMP table auto-dropped at `db.end()`); no app schema/policy.
- Opt-in script: `packages/core/package.json` `test:integration:pg` (runs only this file). The
  default `npm run verify` / `test:all` never requires Postgres — the file self-skips.
- No production DB-code change: `DatabaseClient` already accepts a `PoolConfig` (`connectionString`,
  `max`).

This de-risks RLS steps 2–4 (route call sites, `WITH CHECK`, `FORCE`/non-owner role) by giving a
real-PG proof point. Remaining harness coverage (non-owner role behavior, write rejection on real
APP tables) lands alongside those steps.

## UPDATE 41 — CI wiring for the RLS harness (DECISION PACKET — DEFERRED, no CI exists)

Audited whether to wire the opt-in real-Postgres harness (UPDATE 40) into CI. **The repo has NO CI
configuration** (no `.github/workflows/`, no GitLab/Circle/Travis/Azure/Jenkins/etc., none
git-tracked; a GitHub remote exists → GitHub Actions is the natural provider). Per the slice's stop
condition, **deferred** — the actual workflow file is NOT created (standing up a CI pipeline from
nothing is the "do not invent CI structure" hard stop and an owner/infra decision). **No runtime or
CI change.**

Recorded the recommended job shape in `tenancy-rls.md` Appendix B: an isolated `rls-integration`
GitHub Actions job with a `postgres:16` service, `ALARA_TEST_DATABASE_URL` set to the service URL,
and `npm ci` → `npm --prefix packages/core run test:integration:pg`. Facts: npm workspaces +
`package-lock.json` → `npm ci`; `engines.node >= 20`. Only that job sets the DB URL, so a default
`verify` job (and local `verify`) stays Postgres-free / self-skips. Open owner decisions: adopt
GitHub Actions at all; whether to also run default verify; Postgres image/role; trigger policy.
