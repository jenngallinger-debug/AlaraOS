/**
 * Alara OS — withTenantTransaction REAL-POSTGRES integration harness (OPT-IN)
 *
 * RLS milestone step 5 (`docs/architecture/tenancy-rls.md` §6): the harness that must exist before
 * any RLS enablement / call-site migration. It proves, against a REAL Postgres, that
 * `withTenantTransaction` actually sets `app.tenant_id` inside the transaction, that the setting is
 * transaction-scoped (no leak), and — entirely inside a session-local fixture — that RLS isolation
 * works end-to-end with the helper.
 *
 * OPT-IN: runs ONLY when `ALARA_TEST_DATABASE_URL` is set; otherwise the whole suite is `describe.skip`
 * (no connection is attempted, so the default `npm run verify` never needs Postgres). Point it at a
 * THROWAWAY database — it creates a session-local TEMP table with RLS for the probe.
 */

import { DatabaseClient } from '../src/shared/database';
import { withTenantTransaction, TENANT_GUC } from '../src/shared/tenant-scope';

const DB_URL = process.env.ALARA_TEST_DATABASE_URL;
const describeIf = DB_URL ? describe : describe.skip;

interface Row { tid: string | null }

describeIf('withTenantTransaction — real Postgres (opt-in via ALARA_TEST_DATABASE_URL)', () => {
  let db: DatabaseClient;

  // `max: 1` pins all calls to one connection so the session-local TEMP table persists across
  // calls AND so the no-leak assertion genuinely distinguishes SET LOCAL (rolled back at COMMIT)
  // from a session-level SET (which would persist on a reused connection).
  beforeAll(() => { db = new DatabaseClient({ connectionString: DB_URL, max: 1 }); });
  afterAll(async () => { await db.end(); });

  test('sets app.tenant_id (current_setting) inside the transaction', async () => {
    const tid = await withTenantTransaction(db, 'tenant-A', async (client) => {
      const r = await client.query('SELECT current_setting($1, true) AS tid', [TENANT_GUC]);
      return (r.rows[0] as Row).tid;
    });
    expect(tid).toBe('tenant-A');
  });

  test('the GUC is transaction-scoped — it does NOT leak outside the transaction', async () => {
    await withTenantTransaction(db, 'tenant-B', async () => undefined);
    // Same pooled connection (max:1); if the helper used session SET this would still be 'tenant-B'.
    const rows = await db.query<Row>('SELECT current_setting($1, true) AS tid', [TENANT_GUC]);
    expect(rows[0].tid).not.toBe('tenant-B');
    expect(rows[0].tid === null || rows[0].tid === '').toBe(true);
  });

  test('the GUC does not leak after a rolled-back transaction', async () => {
    await expect(
      withTenantTransaction(db, 'tenant-C', async () => { throw new Error('rollback'); }),
    ).rejects.toThrow('rollback');
    const rows = await db.query<Row>('SELECT current_setting($1, true) AS tid', [TENANT_GUC]);
    expect(rows[0].tid).not.toBe('tenant-C');
  });

  test('RLS isolation works end-to-end via the helper (fixture-local TEMP table + FORCE)', async () => {
    // Entirely contained: a session-local TEMP table (auto-dropped at db.end()); NO app schema is
    // touched, NO app policy added. This proves the helper + GUC + a tenant_isolation policy chain.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS rls_probe');
      await client.query('CREATE TEMP TABLE rls_probe (tenant_id text NOT NULL, val text)');
      await client.query("INSERT INTO rls_probe VALUES ('tenant-A','a'), ('tenant-B','b')");
      await client.query('ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY'); // apply RLS to the owner
      // TENANT_GUC is a fixed identifier (not user input) → safe to inline in the policy DDL.
      await client.query(
        `CREATE POLICY tenant_isolation ON rls_probe USING (tenant_id = current_setting('${TENANT_GUC}', true))`,
      );
    });

    const visibleFor = (tenant: string) =>
      withTenantTransaction(db, tenant, async (client) => {
        const r = await client.query('SELECT tenant_id FROM rls_probe ORDER BY tenant_id');
        return r.rows.map((x) => (x as { tenant_id: string }).tenant_id);
      });

    expect(await visibleFor('tenant-A')).toEqual(['tenant-A']); // only this tenant's rows
    expect(await visibleFor('tenant-B')).toEqual(['tenant-B']); // isolation holds per-tenant
  });
});
