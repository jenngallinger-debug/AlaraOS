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
import { DatabaseProjectionStore } from '../src/projection-engine/store';
import { ProjectionType } from '../src/projection-engine/types';
import { RelationshipRepository } from '../src/relationship-engine/repository';
import { AlaraId } from '../src/shared/types';

const DB_URL = process.env.ALARA_TEST_DATABASE_URL;
const describeIf = DB_URL ? describe : describe.skip;

interface Row { tid: string | null }

describeIf('withTenantTransaction — real Postgres (opt-in via ALARA_TEST_DATABASE_URL)', () => {
  let db: DatabaseClient;

  // `max: 1` pins all calls to one connection so the session-local TEMP table persists across
  // calls AND so the no-leak assertion genuinely distinguishes SET LOCAL (rolled back at COMMIT)
  // from a session-level SET (which would persist on a reused connection).
  beforeAll(() => { db = new DatabaseClient({ connectionString: DB_URL, max: 1 }); });
  afterAll(async () => {
    // Best-effort cleanup of the throwaway fixtures (tables + roles), then close.
    try {
      await db.query('DROP TABLE IF EXISTS rls_probe');
      await db.query('DROP ROLE IF EXISTS rls_probe_role');
      await db.query('DROP TABLE IF EXISTS projections');
      await db.query('DROP TABLE IF EXISTS proj_rls_probe');
      await db.query('DROP ROLE IF EXISTS proj_probe_role');
      await db.query('DROP TABLE IF EXISTS relationships');
      await db.query('DROP TABLE IF EXISTS edges');
      await db.query('DROP TABLE IF EXISTS rel_rls_probe');
      await db.query('DROP ROLE IF EXISTS rel_probe_role');
    } catch { /* ignore cleanup errors */ }
    await db.end();
  });

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

  test('RLS isolation holds under a NON-superuser role (FORCE RLS is not bypassed)', async () => {
    // Why a non-superuser role: superusers (and BYPASSRLS roles) IGNORE row-level security even with
    // FORCE, so the filtering assertion is only meaningful when run as a plain role. The default
    // Postgres service user is a superuser, so the probe SELECT runs under a fixture-local
    // NON-superuser role via `SET LOCAL ROLE` (transaction-scoped). Fully contained: a real throwaway
    // table + role created here and dropped in afterAll. NO app schema/policy is touched.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS rls_probe');
      await client.query('DROP ROLE IF EXISTS rls_probe_role');
      await client.query('CREATE ROLE rls_probe_role NOLOGIN');            // non-superuser, non-BYPASSRLS
      await client.query('CREATE TABLE rls_probe (tenant_id text NOT NULL, val text)');
      await client.query("INSERT INTO rls_probe VALUES ('tenant-A','a'), ('tenant-B','b')");
      await client.query('ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY');
      // TENANT_GUC is a fixed identifier (not user input) → safe to inline in the policy DDL.
      await client.query(
        `CREATE POLICY tenant_isolation ON rls_probe USING (tenant_id = current_setting('${TENANT_GUC}', true))`,
      );
      await client.query('GRANT SELECT ON rls_probe TO rls_probe_role');
    });

    const visibleFor = (tenant: string) =>
      withTenantTransaction(db, tenant, async (client) => {
        // Drop superuser for the rest of THIS transaction so RLS actually applies to the SELECT.
        await client.query('SET LOCAL ROLE rls_probe_role');
        const r = await client.query('SELECT tenant_id FROM rls_probe ORDER BY tenant_id');
        return r.rows.map((x) => (x as { tenant_id: string }).tenant_id);
      });

    expect(await visibleFor('tenant-A')).toEqual(['tenant-A']); // only this tenant's rows
    expect(await visibleFor('tenant-B')).toEqual(['tenant-B']); // isolation holds per-tenant
  });

  // ── RLS step 2 first adopter: DatabaseProjectionStore read methods ──────────

  test('DatabaseProjectionStore.get/listForSubject return the correct tenant rows on real Postgres', async () => {
    // Functional proof that the MIGRATED read methods work end-to-end on real Postgres (the SELECT,
    // the set_config wrapping, and the row mapping). Throwaway `projections` table (dropped in
    // afterAll). Runs as the superuser connection → WHERE-clause tenant filtering (RLS proven below).
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS projections');
      await client.query(`CREATE TABLE projections (
        id text, tenant_id text NOT NULL, projection_type text NOT NULL, subject_id text NOT NULL,
        method_name text, method_version text, canonical_inputs jsonb, source_event_ids text[],
        confidence text, inference_basis text, ai_involved boolean, fresh_until text,
        last_built_at text, build_number int, value jsonb)`);
      await client.query(`INSERT INTO projections (id, tenant_id, projection_type, subject_id) VALUES
        ('pa','tenant-A','Timeline','subj-1'), ('pb','tenant-B','Timeline','subj-1')`);
    });

    const store = new DatabaseProjectionStore(db);
    expect((await store.get('tenant-A', 'Timeline' as ProjectionType, 'subj-1'))?.metadata.tenantId).toBe('tenant-A');
    expect((await store.get('tenant-B', 'Timeline' as ProjectionType, 'subj-1'))?.metadata.tenantId).toBe('tenant-B');
    expect(await store.get('tenant-A', 'Timeline' as ProjectionType, 'nope')).toBeNull();
    const list = await store.listForSubject('tenant-A', 'subj-1');
    expect(list.map((p) => p.metadata.tenantId)).toEqual(['tenant-A']);
  });

  test('a projection-like table enforces RLS isolation under a NON-superuser role', async () => {
    // Mirrors the generic RLS proof on a projection-shaped table (tenant_id/subject_id), confirming
    // the tenant_isolation policy filters by the GUC the migrated store sets. Fixture-local; dropped
    // in afterAll. The probe SELECT runs under a non-superuser role so FORCE RLS is not bypassed.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS proj_rls_probe');
      await client.query('DROP ROLE IF EXISTS proj_probe_role');
      await client.query('CREATE ROLE proj_probe_role NOLOGIN');
      await client.query('CREATE TABLE proj_rls_probe (tenant_id text NOT NULL, subject_id text, val text)');
      await client.query("INSERT INTO proj_rls_probe VALUES ('tenant-A','s','a'), ('tenant-B','s','b')");
      await client.query('ALTER TABLE proj_rls_probe ENABLE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE proj_rls_probe FORCE ROW LEVEL SECURITY');
      await client.query(
        `CREATE POLICY tenant_isolation ON proj_rls_probe USING (tenant_id = current_setting('${TENANT_GUC}', true))`,
      );
      await client.query('GRANT SELECT ON proj_rls_probe TO proj_probe_role');
    });

    const visibleFor = (tenant: string) =>
      withTenantTransaction(db, tenant, async (client) => {
        await client.query('SET LOCAL ROLE proj_probe_role');
        const r = await client.query('SELECT tenant_id FROM proj_rls_probe ORDER BY tenant_id');
        return r.rows.map((x) => (x as { tenant_id: string }).tenant_id);
      });

    expect(await visibleFor('tenant-A')).toEqual(['tenant-A']);
    expect(await visibleFor('tenant-B')).toEqual(['tenant-B']);
  });

  // ── RLS step 2 first LIVE adopter: RelationshipRepository read methods ──────

  test('RelationshipRepository reads return the correct tenant rows on real Postgres', async () => {
    // Functional proof the MIGRATED relationship/edge reads work end-to-end on real Postgres
    // (the SELECTs, the set_config wrapping, the mapping). Throwaway tables dropped in afterAll.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS relationships');
      await client.query('DROP TABLE IF EXISTS edges');
      await client.query(`CREATE TABLE relationships (
        id text, tenant_id text NOT NULL, type text, status text NOT NULL, subject_id text NOT NULL,
        description text, version int, created_at text, updated_at text,
        terminated_at text, termination_reason text)`);
      await client.query(`CREATE TABLE edges (
        id text, tenant_id text NOT NULL, relationship_id text NOT NULL, participant_id text,
        participant_type text, role text, active boolean NOT NULL, started_at text,
        ended_at text, coverage_expires_at text, version int)`);
      await client.query(`INSERT INTO relationships (id,tenant_id,type,status,subject_id,created_at) VALUES
        ('r-a','tenant-A','care_team','active','subj-1','2026-01-01T00:00:00Z'),
        ('r-b','tenant-B','care_team','active','subj-1','2026-01-01T00:00:00Z')`);
      await client.query(`INSERT INTO edges (id,tenant_id,relationship_id,active,started_at) VALUES
        ('e-a','tenant-A','r-a',true,'2026-01-01T00:00:00Z'),
        ('e-b','tenant-B','r-b',true,'2026-01-01T00:00:00Z')`);
    });

    const repo = new RelationshipRepository(db);
    expect((await repo.getById('tenant-A', 'r-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect(await repo.getById('tenant-B', 'r-a' as AlaraId)).toBeNull();          // wrong tenant → null
    expect((await repo.getBySubject('tenant-A', 'subj-1' as AlaraId)).map((r) => r.id)).toEqual(['r-a']);
    expect((await repo.getActiveBySubject('tenant-A', 'subj-1' as AlaraId)).map((r) => r.id)).toEqual(['r-a']);
    expect((await repo.getActiveEdgesForRelationship('tenant-A', 'r-a' as AlaraId)).map((e) => e.id)).toEqual(['e-a']);
  });

  test('a relationship-shaped table enforces RLS isolation under a NON-superuser role', async () => {
    // Tenant A must not see tenant B's relationship rows once RLS is enabled. Fixture-local table +
    // role; probe SELECT runs under a non-superuser role so FORCE RLS is not bypassed.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS rel_rls_probe');
      await client.query('DROP ROLE IF EXISTS rel_probe_role');
      await client.query('CREATE ROLE rel_probe_role NOLOGIN');
      await client.query('CREATE TABLE rel_rls_probe (tenant_id text NOT NULL, subject_id text, status text)');
      await client.query("INSERT INTO rel_rls_probe VALUES ('tenant-A','s','active'), ('tenant-B','s','active')");
      await client.query('ALTER TABLE rel_rls_probe ENABLE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE rel_rls_probe FORCE ROW LEVEL SECURITY');
      await client.query(
        `CREATE POLICY tenant_isolation ON rel_rls_probe USING (tenant_id = current_setting('${TENANT_GUC}', true))`,
      );
      await client.query('GRANT SELECT ON rel_rls_probe TO rel_probe_role');
    });

    const visibleFor = (tenant: string) =>
      withTenantTransaction(db, tenant, async (client) => {
        await client.query('SET LOCAL ROLE rel_probe_role');
        const r = await client.query('SELECT tenant_id FROM rel_rls_probe ORDER BY tenant_id');
        return r.rows.map((x) => (x as { tenant_id: string }).tenant_id);
      });

    expect(await visibleFor('tenant-A')).toEqual(['tenant-A']); // A cannot see B's rows
    expect(await visibleFor('tenant-B')).toEqual(['tenant-B']);
  });
});
