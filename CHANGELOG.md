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
