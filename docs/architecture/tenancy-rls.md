# AlaraOS — Tenancy & Row-Level Security (current state)

> **Status: factual reconciliation, not aspiration.** This documents what tenant
> isolation actually does today. **RLS is scaffolded in the schema but is NOT a live
> backstop.** Tenant isolation is currently enforced entirely by application-level
> `WHERE tenant_id` predicates. Do not assume the database is isolating tenants.

## 1. What the schema declares

Every tenant-bearing table (29 tables — `objects`, `events`, `external_references`,
`observations`, `knowledge_entries`, `workflows`, `tasks`, `promises`, `relationships`,
`edges`, `communications`, `projections`, the reasoning/org-brain tables, the journey
tables, the workforce tables, …) is created with:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
    USING (tenant_id = current_setting('app.tenant_id', TRUE));
```

So RLS is **enabled** and a `tenant_isolation` policy exists on each table.

## 2. Why it is NOT a live backstop today

Three facts, all verified in-repo, make the scaffolding inert or dangerous:

1. **No `FORCE ROW LEVEL SECURITY`.** RLS does not apply to the table **owner** role
   (only `FORCE` makes it apply to the owner). If the application connects as the role
   that owns the tables — the typical setup — **RLS is bypassed entirely** and the
   policies never run.
2. **The application never sets `app.tenant_id`.** There is no `set_config`, `SET`, or
   `SET LOCAL app.tenant_id` anywhere in `packages/core/src` or `apps/api/src`. The
   policy reads `current_setting('app.tenant_id', TRUE)` — the `TRUE` (`missing_ok`)
   makes an unset GUC return `NULL` instead of erroring, and `tenant_id = NULL` is never
   true. So under a **non-owner** role, every policy-gated query would match **zero
   rows** — an outage, not a leak.
3. **Policies are `USING`-only (no `WITH CHECK`).** Even where RLS *is* enforced, a
   `USING`-only policy gates **reads/visibility**; it does **not** constrain
   `INSERT`/`UPDATE`. A write with the wrong `tenant_id` would not be rejected by RLS.

**Net effect:** in the only configuration the app runs in today (owner role), RLS is a
no-op; switching to a non-owner role without setting the GUC would break the app. Either
way, RLS provides **no tenant backstop right now**.

## 3. What actually isolates tenants today

**Application-level `WHERE tenant_id = $n` filters**, applied near-comprehensively across
all repositories (object graph, event store, consent, relationship, knowledge, journey,
reasoning, workflow/task/promise, workforce). The audit found:

- **No cross-tenant result leak** in the current query set.
- Two by-PK reads without a tenant predicate, both benign (reads by a globally-unique,
  self-generated id): the `EventStore.append` idempotency check
  (`SELECT * FROM events WHERE id = $1`) and the `ObjectGraphRepository.createWithClient`
  post-insert re-fetch (`SELECT * FROM objects WHERE id = $1`).
- Two JOINs, both safe (driven by a tenant-filtered table via a foreign key).
- Writes set `tenant_id` from the **caller-supplied** command — there is no DB-level
  check that the value is correct.

The guarantee is therefore **discipline-based**: it holds only while every query keeps
its `WHERE tenant_id` and every by-id read uses a self-generated id.

## 4. The testing gap (and the guard that closes part of it)

`InMemoryStore` filters by tenant in its own hand-written handlers, **independently of
the SQL's `WHERE` clause**. So a production query that forgot `tenant_id` could still
pass unit tests. `InMemoryStore` also cannot model `current_setting`/RLS at all, so RLS
behavior is entirely untested.

**Mitigation in place:** `packages/core/tests/tenancy-guard.test.ts` statically scans the
SQL string literals in `packages/core/src` and fails if a tenant-scoped table is queried
without a `tenant_id` predicate, unless the exact statement is allow-listed with a
documented reason (only the two benign by-id reads above are listed). It is a
conservative string/regex guard, not a SQL parser. This catches a forgotten tenant filter
at the app layer — the only place it *can* be caught while the DB provides no backstop.

## 5. Why full RLS enablement is deferred

Turning RLS into a real backstop is a **milestone, not a quick edit**, because:

- **Connection model.** `DatabaseClient.query` borrows an arbitrary pooled connection per
  call, so a session-level `SET app.tenant_id` would **leak across unrelated callers**.
  `SET LOCAL app.tenant_id` is only safe inside a transaction (which gets a stable
  connection). Today many repositories call `db.query` directly, outside transactions, so
  RLS-via-GUC requires a **tenant-scoped connection/transaction abstraction** and moving
  those call sites onto it.
- **Write policies.** The policies are `USING`-only and must gain `WITH CHECK` to
  constrain `INSERT`/`UPDATE`.
- **Owner role.** Needs `FORCE ROW LEVEL SECURITY` (or running as a non-owner role) — and
  that must not ship before the GUC is reliably set, or the app returns empty results.
- **Test harness.** `InMemoryStore` cannot model RLS; a **real-Postgres integration
  harness** is needed to prove enforcement and the owner/non-owner behavior.

## 6. Recommended future milestone (not started)

In dependency order, each step independently shippable and verifiable:

1. **Tenant-scoped DB helper** — e.g. `DatabaseClient.withTenant(tenantId, fn)` that runs
   inside a transaction and issues `SET LOCAL app.tenant_id`. Opt-in; no call-site change
   required initially. **✅ DONE (UPDATE 39):** `withTenantTransaction(db, tenantId, fn)`
   (`packages/core/src/shared/tenant-scope.ts`) wraps the existing `transaction()` and binds
   `app.tenant_id` via a parameterized `set_config(..., is_local=true)`. **Opt-in and unused —
   RLS-inert (the GUC is unread), no call-site change, no behavior change.**
2. **Route reads/writes through it** so every statement carries the GUC.
3. **`WITH CHECK`** added to the `tenant_isolation` policies (constrain writes).
4. **`FORCE ROW LEVEL SECURITY`** (or non-owner role) — only after steps 1–3.
5. **Real-Postgres integration test harness** proving isolation, the non-owner behavior,
   and write rejection. **◑ STARTED (UPDATE 40):** an OPT-IN harness
   (`packages/core/tests/tenant-scope.integration.test.ts`, run via
   `npm --prefix packages/core run test:integration:pg` with `ALARA_TEST_DATABASE_URL` set;
   `describe.skip` otherwise — the default suite never needs Postgres) proves
   `withTenantTransaction` sets `app.tenant_id` in-transaction, that it does NOT leak
   (transaction-scoped, incl. after rollback), and — in a fixture-local table with
   `FORCE ROW LEVEL SECURITY`, with the probe SELECT run under a **non-superuser role** (UPDATE 43,
   since superusers/BYPASSRLS bypass RLS) — that RLS isolation filters by the GUC per-tenant. The
   remaining harness coverage (write rejection / `WITH CHECK` on real APP tables) lands with steps 2–4.

Until then: **app-level `WHERE tenant_id` is the contract**, and the tenancy guard test is
the enforcement point. RLS remains scaffolded defense-in-depth for the future, not a
backstop today.

## Appendix B — CI wiring for the RLS integration harness (✅ IMPLEMENTED — UPDATE 42)

> **Status: IMPLEMENTED.** Owner approved adopting GitHub Actions (minimum scope: enforce the
> opt-in harness only). The recommended shape below was lifted into
> `.github/workflows/rls-integration.yml` — a single `rls-integration` job with a `postgres:16`
> service that sets `ALARA_TEST_DATABASE_URL` only for that job and runs
> `npm ci` → `npm --prefix packages/core run test:integration:pg`. No deploys/releases/environments/
> secrets; default verify (local or any future job that omits the env var) stays Postgres-free.
> (Originally deferred because no CI existed — audit 2026-06.)

**Facts:** npm workspaces (`packages/*`) with `package-lock.json` → `npm ci`; `engines.node >= 20`.
The harness self-skips unless `ALARA_TEST_DATABASE_URL` is set, and an opt-in script already exists:
`npm --prefix packages/core run test:integration:pg`. The fixture uses `FORCE ROW LEVEL SECURITY`
on a TEMP table it creates, so the connecting role must own that table (a default superuser like
`postgres`/`alara` works; a least-privilege role would need the step-4 non-owner test instead).

**Recommended GitHub Actions job (add when the owner adopts CI — keeps default verify Postgres-free):**

```yaml
name: ci
on: [push, pull_request]
jobs:
  rls-integration:                      # isolated, clearly named; separate from default test/build
    name: RLS integration (real Postgres)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: alara, POSTGRES_PASSWORD: alara, POSTGRES_DB: alara_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U alara" --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      ALARA_TEST_DATABASE_URL: postgres://alara:alara@localhost:5432/alara_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm --prefix packages/core run test:integration:pg
```

Only THIS job sets `ALARA_TEST_DATABASE_URL`; any separate default-`verify` job must NOT, so the
harness self-skips there and the default suite never needs Postgres.

**Open owner decisions:** adopt GitHub Actions at all (none exists today); whether to add a default
`verify` job (lint/test/build) alongside this one; the Postgres image/version + credentials/role
(owner role for the current `FORCE` probe, or a non-owner role to also cover step 4); and the
trigger/branch policy. **Not implemented here** — creating the workflow is the owner's call.
