# Alara OS — Changelog

---

## v0.3-core-spine — 2026-06-25

First tagged release of the Alara OS platform spine.
Covers M0 through M3: the complete event-sourced operating substrate,
coordination layer, and computed projection system.

### M0 — Object Graph + Event Store

- Unified Object Graph with Alara UUIDs (BD-013 Objecthood Principle)
- ExternalReference pattern: external IDs stored separately, never identity
- Append-only event store (UUIDv7 event IDs, time-ordered)
- Optimistic concurrency via version gating on all objects
- Event-sourced state reconstruction — discarding snapshots loses no truth
- PostgreSQL 16 schema with row-level security and multi-tenancy
- **39 tests**

### M1a — Trigger Engine + Rules Engine + Automynd Adapter

- TriggerEngine: condition-based event gate with ALL/ANY logic, priority ordering
- RulesEngine: policy-module-driven evaluation; DENY short-circuits; REQUIRE_HUMAN bubbles up
- Mandatory audit sink on every evaluation
- Built-in triggers: Patient, Workflow, Promise, Referral, Visit, DataIntegrity, ExternalSync
- Automynd fixture adapter implementing IAutomyndAdapter (ADR-001 boundary)
- DOB mismatch detection (JV-002 scenario)
- **45 tests**

### M1b — Policy Modules

Five replaceable policy modules implementing the PolicyModule interface:

- **ConsentPolicyModule** (BD-014): 7-rule chain — missing, revoked, expired, pending, recipient mismatch, permission not in scope → DENY
- **ParticipationPolicyModule** (ADR-014): role matrix — Actor/Owner/Covering → read+write; Stakeholder → read only; Covering expiry enforced
- **AIActConstraintPolicyModule** (ADR-015): permitted autonomous classes (draft, recommend, summarize, classify, flag); prohibited autonomous classes (clinical_escalate, external_disclose, consent_change, order_interpret, benefit_auth, communicate_external) → DENY
- **EMRBoundaryPolicyModule** (ADR-001): no writes to external systems, no clinical content duplication, clinical categories rejected
- **DataIntegrityHumanReviewPolicyModule**: all conflicts → REQUIRE_HUMAN + FLAG_FOR_HUMAN + AutomationSuppressed
- **62 tests**

### M2 — Workflow + Task + Promise Engines

- WorkflowEngine: template-based lifecycle, Rules Engine gated before any mutation, event-sourced, replayable
- Intake workflow template (3 steps: acknowledge → qualify → schedule SOC)
- WorkflowStarted / WorkflowStepActivated / WorkflowAdvanced / WorkflowCompleted / WorkflowSuppressed events
- TaskEngine: create / complete / reassign / escalate; StaleTaskError on version conflict
- PromiseEngine: open → kept / missed / voided; consent-revoked void reason (JV-004); re-terminating throws
- All engines: stale-version rejection, full audit trail, replay reconstructs identical state
- **24 tests**

### M3 — Projection Engine (ADR-016)

- ProjectionEngine: build / invalidate / rebuild with mandatory ADR-016 enforcement
- ADR-016 metadata on every projection: canonical inputs, method version, confidence, inference basis, AI involvement flag, source event IDs, last built timestamp, build number
- Projections cannot mutate canonical objects or emit workflow/task commands
- Engine only emits: ProjectionRebuilt / ProjectionInvalidated / ProjectionFailed
- **Four projection implementations:**
  - **Timeline**: chronological event fold, clinical content excluded (ADR-001)
  - **Digital Care Twin v0**: composite from patient attributes, external refs, workflows, tasks, promises, timeline summary; disclaimer: advisory only
  - **Referral Source Strength**: derived score from referral/workflow/promise/integrity events
  - **Relationship Health**: health score from promise outcomes, task completions, integrity flags
- Rebuilder proves: discarding projection cache loses no truth
- **30 tests**

### Infrastructure

- Migrations 001–004 (objects, events, external_references, triggers, rule_sets, rule_audit_log, workflows, tasks, promises, projections)
- In-memory test doubles — full test suite runs without a database
- TypeScript strict mode, zero errors
- `.gitignore`, `.env.example`

### Test totals

| Milestone | Tests |
|---|---|
| M0 Object Graph + Event Store | 39 |
| M1a Trigger + Rules + Automynd | 45 |
| M1b Policy Modules | 62 |
| M2 Workflow + Task + Promise | 24 |
| M3 Projection Engine | 30 |
| **Total** | **200** |

---

## Next: M4 — First Vertical Slice (UI-visible referral loop)

End-to-end: referral arrives → intake workflow → task → promise → timeline projection → Digital Care Twin assembled → visible in workspace.

---

## v0.4-m4-vertical-slice — 2026-06-25

### M4 — First Vertical Slice

Complete end-to-end operating pipeline:
ReferralReceived → Patient → Rules → Workflow → Task → Promise → Communication → Timeline → Digital Care Twin

**Communication Engine**
- Full lifecycle: CommunicationCreated → CommunicationQueued → CommunicationSent → CommunicationDelivered / CommunicationFailed
- All 5 channels: internal, patient, family, physician, referral_source
- StubDeliveryAdapter (no external services); adapter interface ready for Email/SMS/Fax
- Stale-version rejection; full event-sourced reconstruction
- ADR-015: adapter enforces that communications are human-authorized

**Intake Orchestrator**
- Sequences all engines; owns zero business rules
- Rules Engine checked before any workflow/task/promise mutation
- Denial path: patient created, all else blocked, explanation returned

**Projection upgrades**
- Timeline and Digital Care Twin both rebuilt as final step of every intake flow
- ADR-016 metadata verified: methodVersion, confidence, sourceEventIds, aiInvolved
- Replay test proves both projections rebuild identically from event stream

**Migration 005**: communications table with RLS

**Tests: +32 → 232 total**

---

## v0.4-merge-ready — 2026-06-26

**Release lock: v0.4 — Core Platform Spine + M10.5 Journey Engine.**
Locked at commit `f554441`, tag `v0.4-merge-ready`.

### M10.5 — Journey Engine (ratified)

Journey is a first-class **coordinating** object. It owns only its
organizational intent, lifecycle, coordination state, and event stream.
Everything else is referenced — never absorbed.

- Lifecycle state machine: arrival → orientation → working → dormant →
  reactivated → completed → archived, with an explicit transition table
- Coordination state (active / suspended / handoff) is orthogonal to lifecycle;
  suspend/resume never mutates lifecycle
- Anonymous journey creation + scoped capability tokens
- Intent inference · goal / obstacle / question progression · work started
- Identity resolution **by reference only** — a Journey never creates a Person
- Link Person / Episode / Workforce Member by reference; merge; split
- Event-sourced; engine-local append-only `journey_events` log; reconstruction

### Journey Invariant (ratified doctrine)

> Journey references first-class Objects. It never absorbs their
> responsibilities. Journey must never become a God Object.

Structurally enforced: the engine has no method that creates Person, Episode,
Workforce Member, Promise, Task, Communication, Knowledge, Observation, or
Reasoning object. Recorded in Part XI → Object Doctrine.

### ADR-016 preserved — exactly 8 canonical ProjectionTypes

Journey state is **authoritative operational state**, not a Computed Projection
(discarding it would lose truth). The canonical `ProjectionType` union remains
exactly the eight ratified types: Timeline · DigitalCareTwin ·
ReferralSourceStrength · RelationshipHealth · KnowledgeSummary ·
OrganizationalHealth · ReasoningSummary · WorkforceHealth.

- **`JourneyState` rejected** as a canonical ProjectionType (category error)
- The engine's own `journey_projections` read model (`projection_type`
  literal `'journey_state'`) is engine-local state, not the canonical store
- Forward boundary: a future *derived, cross-engine* Journey read model
  consumed through the canonical projection system would require a ratified
  ADR-016 addendum — not settled by this lock

### Migration 011 — additive Journey-only

Creates `journeys` · `journey_references` · `journey_events` ·
`journey_projections` · `journey_capability_tokens` (RLS + tenant isolation).
Does not alter the canonical `projections` table or `proj_type_valid`, and
adds no `JourneyState` type.

### Cleanup — legacy Python ops removed

The `feat/alara-os-v0-t1-t3` merge had dragged a legacy Python "ops" app into
the TypeScript platform. Removed: `ops/` (11 modules), `tests/test_comms.py`,
`tests/test_ops.py`, `requirements.txt`, `public/ops.css`; `preview_server.py`
ops-console wiring reverted to its pre-merge state. Pre-existing legacy
`preview_server.py` and `scripts/validate_data.py` retained. Platform is
TypeScript-only again.

### Provenance

- `27620a2` kept as the canonical M10.5 implementation
- Alternate local build `ff5a575` **not** reconciled (no silent merge)

### Validation at lock

- TypeScript strict: clean (core + api)
- Jest: **529 core + 29 API = 558 passing**. No pytest.
- Canonical Notion ratification merged (Part XI, Appendix C, Appendix D)

### M11

Not started.
