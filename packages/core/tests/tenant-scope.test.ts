/**
 * Alara OS — withTenantTransaction (tenant-scoped DB helper, RLS milestone step 1)
 *
 * Pure unit tests with a mocked `transaction` (no real Postgres). Prove the helper sets
 * `app.tenant_id` via a PARAMETERIZED `set_config` BEFORE the work, inside the transaction, and
 * inherits rollback. This helper is opt-in and unused by any call site — it changes nothing today.
 */

import { withTenantTransaction, TENANT_GUC, TenantScopedDb } from '../src/shared/tenant-scope';

interface Captured { text: string; values?: unknown[]; }

/** A fake DB whose `transaction` mimics BEGIN/COMMIT/ROLLBACK and records the client's queries. */
function makeFakeDb() {
  const queries: Captured[] = [];
  const state = { began: false, committed: false, rolledBack: false };
  const client = {
    query: async (text: string, values?: unknown[]) => { queries.push({ text, values }); return { rows: [] }; },
  };
  const db: TenantScopedDb = {
    async transaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
      state.began = true;
      try {
        const r = await fn(client as never);
        state.committed = true;
        return r;
      } catch (e) {
        state.rolledBack = true;
        throw e;
      }
    },
  };
  return { db, queries, state };
}

describe('withTenantTransaction', () => {
  test('sets app.tenant_id via parameterized set_config inside a transaction, then runs fn', async () => {
    const h = makeFakeDb();
    const result = await withTenantTransaction(h.db, 'tenant-x', async (client) => {
      await client.query('SELECT 1 FROM patients');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(h.state.began).toBe(true);
    expect(h.state.committed).toBe(true);
    // The GUC set is the FIRST statement, parameterized (transaction-scoped via is_local=true).
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, 'tenant-x'] });
    // fn's own query runs AFTER the GUC is set.
    expect(h.queries[1].text).toBe('SELECT 1 FROM patients');
  });

  test('tenant id is bound as a value (injection-safe), never interpolated into SQL', async () => {
    const h = makeFakeDb();
    const evil = "x'; DROP TABLE patients; --";
    await withTenantTransaction(h.db, evil, async () => undefined);
    expect(h.queries[0].text).toBe('SELECT set_config($1, $2, true)'); // SQL text has no tenant content
    expect(h.queries[0].values).toEqual([TENANT_GUC, evil]);           // tenant only as a bound value
  });

  test('propagates fn errors and rolls back (no set after the failure)', async () => {
    const h = makeFakeDb();
    await expect(
      withTenantTransaction(h.db, 't', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(h.state.rolledBack).toBe(true);
    expect(h.state.committed).toBe(false);
    expect(h.queries[0].values).toEqual([TENANT_GUC, 't']); // GUC was still set before fn ran
  });

  test('TENANT_GUC matches the RLS policy setting name', () => {
    expect(TENANT_GUC).toBe('app.tenant_id');
  });
});
