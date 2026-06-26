# M11 — Retrieval & Query Engine — Planning Spec

> **Status: PLANNING / SPEC ARTIFACT — not canon.** This document plans the M11 build.
> It does not modify the Constitution, Blueprint, BD/ADR register, or AES. It anchors only
> to **ratified** canon (ADR-001, ADR-003, ADR-016). It is written to be discarded or revised
> freely; nothing here is binding architecture until implemented and, where relevant, ratified.
>
> Built on v0.4 (`v0.4-merge-ready = f554441`). No dependency on the staged constitutional
> packets (Six Laws, Fragmentation preamble). See §2.

---

## 1. Definition

**M11 — Retrieval & Query Engine** is a uniform, permission-scoped, **read-only** query
substrate over the platform's existing canonical stores:

- **Object Graph** (`ObjectGraphRepository`)
- **Event Log** (`EventStore`)
- **Relationship Edges** (`RelationshipRepository`)
- **Computed Projections** (`ProjectionEngine` / `IProjectionStore`)

It exists so that **externalized reality can be reached by the humans and engines that need
it, without creating bespoke per-consumer read paths.** Today, each engine reads canonical
state through its own repository methods; any new cross-cutting read (an operator "case view",
a future domain engine's lookup) would otherwise require a new private query path. M11 replaces
N private read paths with **one uniform query contract** that selects and joins across the four
stores above, scoped to who is asking.

M11 is **substrate, not a domain.** It does not know what "referral strength", "denial pattern",
or "deterioration" means. It selects, joins, and returns existing truth with provenance. Domain
intelligence is later, separate work (not M11, not M12).

---

## 2. Canon anchor

M11 anchors **only to ratified canon.** It consumes these and changes none of them:

| Ratified item | What it means for M11 |
|---|---|
| **ADR-001 — EMR Boundary** | Retrieval may query **Alara-owned objects and ExternalReferences** but **never reaches into Automynd or any EMR.** ExternalReferences are queryable as reference attributes; the engine never dereferences them into the external system. |
| **ADR-003 — AI is last in the chain** | Retrieval is **deterministic.** AI / reasoning (M9) may *consume* retrieval output later, but **no AI is part of M11.** Same inputs always produce the same results. |
| **ADR-016 — Computed Projection Architecture** | Retrieval is a **View.** It **selects and joins**; it **never computes authoritative truth** and **never creates a canonical `ProjectionType`.** Per ADR-016's own distinction: *"View selects; Projection computes."* M11 is strictly on the *View* side. The canonical `ProjectionType` union remains exactly the **8** ratified types — M11 adds zero. |

Engines M11 builds upon are all ratified under v0.4: M0 (Object Graph + Event Store),
M1 (Rules / Permission / Consent / Participation), M3 (Projection Engine), M6 (Relationship Engine).

### Non-binding vision context (pending constitutional ratification)

> The following maps M11 to the **staged, unratified** constitutional material. It is recorded
> as motivation only and is **non-binding vision context; pending constitutional ratification.**
> If the Architect revises or rejects these packets, **only this subsection changes — not M11's
> code, contract, or tests.**
>
> - Retrieval is one mechanism of **Boundary-Transparency**: it lets externalized reality cross
>   the boundary from *where it is stored* to *whoever (human or engine) needs it*, without
>   re-transmission and therefore without loss.
> - Retrieval serves **Law I — Perception** (the organization perceiving its own reality on demand).
>
> These mappings are explanatory. M11 is justified entirely by the **ratified** anchors in the
> table above.

---

## 3. Non-goals (explicitly out of scope for M11)

M11 does **not** include, and the build stops for review if any is requested (see §7):

- **Identity resolution** — finding/returning entities is in scope; *deciding two references are
  the same entity* is **M12**, built on M11.
- **Deduplication / merge logic** — no entity merging, no "same person" inference.
- **Natural-language interface** — M11 is a *structured* query contract only.
- **AI reasoning** — no LLM calls, no probabilistic inference (ADR-003).
- **Writes or mutations** — read-only by construction (§4).
- **New authoritative objects** — retrieval owns no source data.
- **New `ProjectionType`s** — the union stays at the 8 ratified types (ADR-016).
- **Computed scores or derived truth** — if a query would *compute* a new value, that is a
  Projection (ADR-016), not retrieval.
- **Domain intelligence** — no "referral strength", "denial pattern", "risk", etc.
- **Query optimizer / indexing strategy** — v1 targets correctness + provenance + permission-safety,
  not performance tuning.
- **Bespoke per-function read APIs** — no "scheduling query API", "billing query API", etc. One
  uniform contract; functions compose over it.

---

## 4. Invariants

M11 must enforce all of the following. Each is testable.

1. **Read-only by construction.** The engine has no method that writes objects, edges, or domain
   events. It depends only on read methods of the underlying repositories/stores.
2. **Permission/consent filtering is applied *inside* the query boundary.** Results are scoped
   *before* they are returned, by reusing the existing M1 permission model
   (`RulesEngine` + `ConsentPolicyModule` + `ParticipationPolicyModule`) — M11 does **not**
   invent a new permission mechanism.
3. **Actor-relative results.** The same query run by different actors may return different,
   correctly-scoped result sets. Visibility is a function of the actor + consent + participation.
4. **No domain events.** Retrieval emits **no** domain events (no `*Created`, `*Updated`, etc.).
5. **Audit, if present, is platform telemetry only — never domain truth.** Any record of "a query
   ran" is operational telemetry, not an appended `DomainEvent` on a canonical stream. (v1 default:
   telemetry is out of scope unless needed; if added it is a non-domain sink.)
6. **Provenance on every result.** Each returned result declares which object(s), event(s),
   edge(s), and/or projection(s) contributed to it.
7. **Select and join only — never compute new authoritative meaning.** Retrieval may filter,
   join, and shape existing values; it may not calculate a new derived value and present it as truth.
8. **EMR boundary.** Retrieval cannot reach into Automynd or any EMR (ADR-001). It queries Alara
   objects + ExternalReferences only.
9. **`ProjectionType` union unchanged.** M11 adds no `ProjectionType` and does not alter
   `proj_type_valid` or the canonical projections store.

---

## 5. Success criteria

M11 is successful **only if all** of the following hold:

1. A single query can span **object + edge + event + projection**.
2. **Permission leak tests** prove scoped access works (a query run as actor A vs. actor B returns
   correctly different results; nothing leaks past consent/participation).
3. A **consent/participation change** changes query results correctly (e.g., revoked consent
   removes previously-visible results for the affected actor).
4. An **existing projection can be reproduced as a query composition** (proving bespoke read paths
   are now optional).
5. A **case-management-style view can be produced as a query composition, not a new engine**
   (e.g., "entities with an overdue promise AND a declining relationship-health projection").
6. **Results include provenance** (which object/event/edge/projection contributed).
7. **No new `ProjectionType`s** are added (union stays at 8).
8. **TypeScript strict passes** (core + api).
9. **Jest passes** with the exact final count reported.
10. **Working tree is clean** after commit.

---

## 6. Implementation plan

### 6.1 Existing patterns inspected (basis for the file plan)

- **Engine module shape** (consistent across M2–M10): a directory `packages/core/src/<engine>/`
  containing `repository.ts` (DB reads/writes via `DatabaseClient`), `engine.ts` (logic),
  `types.ts` (contract), `index.ts` (re-exports), with a public surface re-exported from
  `packages/core/src/index.ts`.
- **Read surfaces M11 composes over (all already exist):**
  - `EventStore.loadStream(tenantId, streamId)`, `loadAll(...)`, `countInStream(...)` — event log reads.
  - `ObjectGraphRepository.getById`, `findByExternalReference`, `getExternalReferences` — object reads.
  - `RelationshipRepository` — relationship edge reads (M6).
  - `ProjectionEngine.get(tenantId, type, subjectId)` / `IProjectionStore.get(...)` — projection reads.
- **Permission model (reused, not reinvented):**
  `RulesEngine.evaluate(context: RuleContext): Promise<Decision>` where
  `DecisionOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_HUMAN' | 'DEFER'`. `RuleContext` carries
  `{ tenantId, actor, eventType, eventPayload, ruleSetId, objects, metadata? }`.
  `ConsentPolicyModule` and `ParticipationPolicyModule` already implement visibility logic.
  M11 constructs a **read/visibility `RuleContext`** per candidate result and admits it only on
  `ALLOW`. (Policy modules are pure/deterministic and do no I/O — ideal for in-query filtering.)
- **IDs:** `newAlaraId()` (UUIDv4) / `newEventId()` (UUIDv7) from `shared/ids.ts`.
- **Tests:** `packages/core/tests/mN-*.test.ts`, with `tests/helpers/in-memory-store.ts` enabling
  DB-free runs. Current baseline: **529 core + 29 API = 558**.

### 6.2 Proposed file plan (to confirm before coding the slice)

```
packages/core/src/retrieval-engine/
  types.ts        # Query contract: Query, QuerySource, Filter, Join, Result<T>,
                  #   Provenance, RetrievalResultSet. No new ProjectionType.
  engine.ts       # RetrievalEngine: deterministic, read-only. Composes the existing
                  #   read surfaces; applies permission/consent filtering INSIDE the
                  #   query boundary via RulesEngine before returning results.
  permission-gate.ts  # Builds a read/visibility RuleContext per candidate result and
                      #   admits only ALLOW. Thin adapter over the existing M1 model;
                      #   no new permission logic.
  index.ts        # Re-exports (wired into packages/core/src/index.ts under an "M11" section)

packages/core/tests/
  m11-retrieval-engine.test.ts   # cross-boundary query; permission-leak (actor A vs B);
                                 #   consent/participation change alters results;
                                 #   projection reproduced as composition;
                                 #   case-management-style composition;
                                 #   provenance present; NO writes / NO domain events;
                                 #   ADR-016 boundary (no computed truth, no new ProjectionType);
                                 #   ADR-001 boundary (no EMR reach).
```

### 6.3 Smallest canonical M11 slice (build only after the file plan is confirmed)

- Query contract/types (`types.ts`).
- Deterministic retrieval engine (`engine.ts`) composing object + event + edge + projection reads.
- In-memory store support reused from `tests/helpers/in-memory-store.ts` (extend only if needed).
- Permission-scoped execution (`permission-gate.ts`) via the existing `RulesEngine` model.
- Provenance on every result.
- Tests: cross-boundary query; permission leakage; no writes / no domain events; ADR-016 boundary.

---

## 7. Stop conditions

Stop immediately and ask for **Architect review** if M11 wants to:

- require a new `ProjectionType`;
- compute scores or any derived value presented as truth;
- resolve identity (decide two references are the same entity);
- persist retrieved results as authoritative truth;
- add domain-specific query APIs;
- call AI / reasoning;
- **and especially:** if permission/consent filtering **cannot** be enforced *inside* the query
  boundary (i.e., if scoping would have to happen after results leave the engine). This is the
  highest-risk surface; if it cannot be guaranteed in-boundary, halt and escalate rather than
  ship a leaky read path.

---

*Spec version 1. Planning artifact only. Built on v0.4 `f554441`. No canon modified.
Constitutional mapping in §2 is non-binding pending ratification.*
