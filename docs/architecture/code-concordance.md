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
