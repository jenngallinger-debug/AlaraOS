/**
 * Alara OS — Tenant-scoped transaction helper (OPT-IN, no call-site change, RLS-inert)
 *
 * Runs a unit of work inside a transaction with `app.tenant_id` set for that transaction, so that
 * — WHEN Row-Level Security is eventually enabled — the `tenant_isolation` policies
 * (`tenant_id = current_setting('app.tenant_id', TRUE)`) have a trusted value to read. This is
 * step 1 of the deferred RLS milestone in `docs/architecture/tenancy-rls.md` §6.
 *
 * IMPORTANT — this changes nothing today:
 *   - RLS is scaffolded but INERT (owner role bypasses it; no app sets the GUC), so setting
 *     `app.tenant_id` is a NO-OP on query results. This does NOT enable RLS.
 *   - It is OPT-IN: no repository or call site uses it yet, so no query behavior changes.
 *   - `SET LOCAL`/`set_config(..., is_local=true)` is transaction-scoped, which is why it lives
 *     inside `transaction()` (the only place with a stable connection — `query`/`queryOne` borrow
 *     arbitrary pooled connections; see `tenancy-rls.md` §5).
 */

import type { PoolClient } from './database';

/** The Postgres GUC the RLS policies read (`tenant_id = current_setting('app.tenant_id', TRUE)`). */
export const TENANT_GUC = 'app.tenant_id';

/**
 * Minimal DB surface this helper needs — structurally satisfied by `DatabaseClient` and the
 * in-memory test double (both expose `transaction`). Kept narrow so the helper stays pure/testable.
 */
export interface TenantScopedDb {
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

/**
 * Run `fn` inside a transaction with `app.tenant_id` bound to `tenantId` for that transaction.
 * Rollback semantics are inherited from `transaction()`. The tenant id is passed as a BOUND VALUE
 * via `set_config` (SET LOCAL cannot bind parameters) — injection-safe. No call site uses this yet.
 */
export function withTenantTransaction<T>(
  db: TenantScopedDb,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (client) => {
    await client.query('SELECT set_config($1, $2, true)', [TENANT_GUC, tenantId]);
    return fn(client);
  });
}
