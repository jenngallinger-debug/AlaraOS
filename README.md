# Alara OS

> The world's first Organizational Intelligence Platform for community-based care.
> Home Health is the first implementation. The platform is the product.

---

## What this is

Alara OS is an event-sourced, CQRS-based operating system that turns authorized events into owned, coordinated organizational work. It is **not** an EMR, CRM, or workflow tool — it is the intelligence layer that makes an organization continuously more capable of perceiving reality, thinking clearly, acting together, and learning from every interaction.

---

## Architecture

```
Constitution
  ↓
Blueprint (ADR-001, BD-013, ADR-016, …)
  ↓
Event Store (append-only source of truth)
  ↓
Trigger Engine → Rules Engine → Policy Modules
  ↓
Workflow → Task → Promise Engines
  ↓
Projection Engine (Computed Projections — ADR-016)
  ↓
AI Orchestration Layer (future)
```

**Key decisions:**
- **Event sourcing** — all state reconstructable from the event stream
- **CQRS** — commands write events; projections are disposable read models
- **Unified Object Graph** (BD-013) — one canonical object model, no parallel growth objects
- **Computed Projections** (ADR-016) — derived, non-authoritative, fully regenerable
- **EMR Boundary** (ADR-001) — Automynd is the clinical SoR; Alara OS never duplicates clinical content

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Architecture | Modular monolith |
| Database | PostgreSQL 16 |
| Event bus | Postgres outbox (Kafka later) |
| Search | Postgres FTS + pgvector (future) |
| Testing | Jest + ts-jest, in-memory test doubles |

---

## Repo structure

```
alara-os/
├── packages/
│   └── core/                        # @alara-os/core — all engines
│       ├── src/
│       │   ├── shared/              # types, ids, database client
│       │   ├── events/              # event store + event types
│       │   ├── object-graph/        # unified object graph (M0)
│       │   ├── trigger-engine/      # trigger evaluation (M1a)
│       │   ├── rules-engine/        # policy engine + M1b modules (M1a/M1b)
│       │   │   └── policies/        # Consent, Participation, AI Act, EMR, DataIntegrity
│       │   ├── automynd-adapter/    # EMR boundary adapter (M1a)
│       │   ├── workflow-engine/     # workflow lifecycle (M2)
│       │   ├── task-engine/         # task lifecycle (M2)
│       │   ├── promise-engine/      # promise lifecycle (M2)
│       │   └── projection-engine/   # computed projections ADR-016 (M3)
│       │       └── projections/     # Timeline, DigitalCareTwin, ReferralStrength, RelHealth
│       └── tests/
│           ├── helpers/             # in-memory store (no DB needed for tests)
│           └── *.test.ts            # 200 tests across 14 suites
├── migrations/
│   ├── 001_m0_spine.sql             # objects, events, external_references
│   ├── 002_m1a_trigger_rules.sql    # triggers, rule_sets, rule_audit_log
│   ├── 003_m2_workflow_task_promise.sql
│   └── 004_m3_projections.sql
└── scripts/
    └── migrate.js                   # migration runner
```

---

## Quick start

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (for production; tests run without it)

### Install
```bash
npm install
```

### Run tests (no database needed)
```bash
cd packages/core
npx jest --config jest.config.js --no-coverage
```

### Run migrations (requires `DATABASE_URL`)
```bash
cp .env.example .env          # fill in DATABASE_URL
npm run migrate
```

---

## Completed milestones

| Milestone | Description | Tests |
|---|---|---|
| **M0** | Object Graph + Event Store. UUIDs, ExternalReference pattern, optimistic concurrency, event-sourced reconstruction. | 39 |
| **M1a** | Trigger Engine + Rules Engine infrastructure + Automynd fixture adapter. | 45 |
| **M1b** | 5 Policy Modules: Consent (BD-014), Participation/ADR-014, AI Act (ADR-015), EMR Boundary (ADR-001), Data Integrity. | 62 |
| **M2** | Workflow + Task + Promise Engines. Event-sourced, replayable, Rules Engine gated, stale-version rejected. | 24 |
| **M3** | Projection Engine (ADR-016). Timeline, Digital Care Twin v0, Referral Source Strength, Relationship Health. Disposable cache, full rebuild from events. | 30 |
| **Total** | | **200** |

---

## Next milestone: M4 — First vertical slice (UI-visible)

End-to-end referral loop:
```
Referral arrives (Automynd adapter)
→ Trigger fires IntakeWorkflow
→ Rules Engine authorizes
→ WorkflowStarted + TaskCreated + PromiseCreated
→ Timeline Projection built
→ Digital Care Twin v0 assembled
→ Visible in workspace UI
```

---

## Constitutional alignment

Every engine is traceable to the Alara Constitution:

| Engine | Constitutional basis |
|---|---|
| Object Graph | Part XI Object Doctrine, BD-013, ExternalReference Rule |
| Event Store | "Events never disappear. Events simply accumulate." (Part XI) |
| Trigger Engine | "Triggers exist only to answer: Should something happen now?" (Part XI) |
| Rules Engine | ADR-003 (AI last), ADR-015 (AI Act), BD-013 |
| Policy Modules | BD-014 (Consent), ADR-014 (Participation), ADR-015, ADR-001 |
| Workflow Engine | "No workflow becomes lost." (Part XI) |
| Promise Engine | "Patients should never remind Alara about promises." (Part XI) |
| Projection Engine | ADR-016 (Computed Projection Architecture) |
