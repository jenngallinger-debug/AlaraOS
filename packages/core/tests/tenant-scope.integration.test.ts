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
import { ProjectionType, StoredProjection } from '../src/projection-engine/types';
import { RelationshipRepository } from '../src/relationship-engine/repository';
import { OrganizationalBrainRepository } from '../src/organizational-brain/repository';
import { KnowledgeRepository } from '../src/knowledge-engine/repository';
import { WorkforceRepository } from '../src/workforce-engine/repository';
import { ConsentRepository } from '../src/consent-store/repository';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { EventStore } from '../src/events/store';
import { EventType } from '../src/events/types';
import { JourneyRepository } from '../src/journey-engine/repository';
import { Journey, JourneyEvent, JourneyProjection, JourneyReference } from '../src/journey-engine/types';
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
      // RLS step 2 Batch A — dedicated read-table fixtures + probes
      await db.query('DROP TABLE IF EXISTS detected_patterns');
      await db.query('DROP TABLE IF EXISTS observations');
      await db.query('DROP TABLE IF EXISTS knowledge_entries');
      await db.query('DROP TABLE IF EXISTS workforce_members');
      await db.query('DROP TABLE IF EXISTS workforce_availability');
      await db.query('DROP TABLE IF EXISTS assignments');
      await db.query('DROP TABLE IF EXISTS capacity_snapshots');
      await db.query('DROP TABLE IF EXISTS workforce_teams');
      await db.query('DROP TABLE IF EXISTS brain_rls_probe');
      await db.query('DROP ROLE IF EXISTS brain_probe_role');
      await db.query('DROP TABLE IF EXISTS know_rls_probe');
      await db.query('DROP ROLE IF EXISTS know_probe_role');
      await db.query('DROP TABLE IF EXISTS wf_rls_probe');
      await db.query('DROP ROLE IF EXISTS wf_probe_role');
      // RLS step 2 — ConsentRepository / ObjectGraphRepository fixtures (central `objects` table)
      await db.query('DROP TABLE IF EXISTS external_references');
      await db.query('DROP TABLE IF EXISTS objects');
      // RLS step 2 — EventStore fixture (central `events` table, throwaway)
      await db.query('DROP TABLE IF EXISTS events');
      // RLS step 2 — JourneyRepository write fixtures (journey_* tables, throwaway)
      await db.query('DROP TABLE IF EXISTS journeys');
      await db.query('DROP TABLE IF EXISTS journey_references');
      await db.query('DROP TABLE IF EXISTS journey_events');
      await db.query('DROP TABLE IF EXISTS journey_projections');
      await db.query('DROP TABLE IF EXISTS journey_capability_tokens');
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
        method_name text, method_version text, canonical_inputs jsonb, source_event_ids jsonb,
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

  // ── RLS step 2 first WRITE adopter (Slice 37): DatabaseProjectionStore save/delete ──────────

  test('DatabaseProjectionStore.save/delete write/remove only the GUC tenant row on real Postgres', async () => {
    // Functional proof the MIGRATED writes work end-to-end: the upsert inserts then updates without
    // duplicating, writes under the correct tenant, and delete removes only the tenant-local row.
    // Write-capable throwaway `projections` table (faithful to migration 004: UNIQUE conflict key +
    // updated_at), dropped in afterAll. NOTE: no RLS policy on `projections` here — GUC is inert.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS projections');
      await client.query(`CREATE TABLE projections (
        id text, tenant_id text NOT NULL, projection_type text NOT NULL, subject_id text NOT NULL,
        method_name text, method_version text, canonical_inputs jsonb, source_event_ids jsonb,
        confidence text, inference_basis text, ai_involved boolean, fresh_until text,
        last_built_at text, build_number int, value jsonb, updated_at timestamptz,
        UNIQUE (tenant_id, projection_type, subject_id))`);
    });

    const store = new DatabaseProjectionStore(db);
    const mkProj = (tenantId: string, buildNumber: number, value: Record<string, unknown>): StoredProjection => ({
      id: `proj-${tenantId}` as AlaraId,
      metadata: {
        projectionType: 'Timeline' as ProjectionType, subjectId: 'subj-1', tenantId,
        canonicalInputs: [], methodName: 'm', methodVersion: '1.0.0', freshUntil: null,
        sourceEventIds: [], confidence: 'high', inferenceBasis: 'fact', aiInvolved: false,
        lastBuiltAt: '2026-01-01', buildNumber,
      },
      value,
    });
    const countFor = async (tenantId: string) =>
      Number((await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM projections WHERE tenant_id=$1 AND projection_type=$2 AND subject_id=$3',
        [tenantId, 'Timeline', 'subj-1'],
      ))[0].n);

    // save inserts under the correct tenant.
    await store.save(mkProj('tenant-A', 1, { v: 1 }));
    expect(await countFor('tenant-A')).toBe(1);
    expect((await store.get('tenant-A', 'Timeline' as ProjectionType, 'subj-1'))?.value).toEqual({ v: 1 });

    // second save on the same (tenant, type, subject) UPSERTS — updates, does not duplicate.
    await store.save(mkProj('tenant-A', 2, { v: 2 }));
    expect(await countFor('tenant-A')).toBe(1);                          // still one row
    expect((await store.get('tenant-A', 'Timeline' as ProjectionType, 'subj-1'))?.value).toEqual({ v: 2 });

    // a different tenant's row with the same (type, subject) coexists (conflict key includes tenant_id).
    await store.save(mkProj('tenant-B', 1, { v: 9 }));
    expect(await countFor('tenant-A')).toBe(1);
    expect(await countFor('tenant-B')).toBe(1);

    // delete removes ONLY the GUC tenant's row; the other tenant's row survives.
    await store.delete('tenant-A', 'Timeline' as ProjectionType, 'subj-1');
    expect(await countFor('tenant-A')).toBe(0);
    expect(await countFor('tenant-B')).toBe(1);                          // wrong-tenant row survives
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

    // computeCareTeamView (one transaction): only tenant-local relationships, and edge traversal
    // cannot cross tenants (tenant-A's view never includes tenant-B's edge e-b, and vice versa).
    const viewA = await repo.computeCareTeamView('tenant-A', 'subj-1' as AlaraId);
    expect(viewA.members.map((m) => m.relationshipId)).toEqual(['r-a']);
    expect(viewA.sourceEdgeIds).toEqual(['e-a']);
    const viewB = await repo.computeCareTeamView('tenant-B', 'subj-1' as AlaraId);
    expect(viewB.sourceEdgeIds).toEqual(['e-b']);
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

  // ── RLS step 2 Batch A: dedicated read-table repositories ───────────────────

  test('OrganizationalBrainRepository reads return the correct tenant rows on real Postgres', async () => {
    // Functional proof the MIGRATED pattern reads work end-to-end on real Postgres (the SELECTs, the
    // set_config wrapping, the mapping). Throwaway `detected_patterns` table dropped in afterAll.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS detected_patterns');
      await client.query(`CREATE TABLE detected_patterns (
        id text, tenant_id text NOT NULL, category text, title text, description text,
        subject_id text NOT NULL, subject_type text, evidence jsonb, confidence text, severity text,
        status text NOT NULL, detector_id text, detector_version text, superseded_by_id text,
        first_detected_at text, last_confirmed_at text, resolved_at text, version int)`);
      await client.query(`INSERT INTO detected_patterns
        (id,tenant_id,category,subject_id,status,detector_id,first_detected_at,last_confirmed_at,version) VALUES
        ('p-a','tenant-A','risk','subj-1','active','det1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1),
        ('p-b','tenant-B','risk','subj-1','active','det1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1)`);
    });

    const repo = new OrganizationalBrainRepository(db);
    expect((await repo.getPatternById('tenant-A', 'p-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect(await repo.getPatternById('tenant-B', 'p-a' as AlaraId)).toBeNull();    // wrong tenant → null
    expect((await repo.getActivePatternsForSubject('tenant-A', 'subj-1')).map((p) => p.id)).toEqual(['p-a']);
    expect((await repo.getAllPatternsForSubject('tenant-A', 'subj-1')).map((p) => p.id)).toEqual(['p-a']);
    expect((await repo.getPatternByDetectorAndSubject('tenant-A', 'det1', 'subj-1'))?.id).toBe('p-a');
  });

  test('KnowledgeRepository reads return the correct tenant rows on real Postgres', async () => {
    // Functional proof the MIGRATED observation/entry reads work end-to-end on real Postgres.
    // Throwaway `observations` + `knowledge_entries` tables dropped in afterAll.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS observations');
      await client.query('DROP TABLE IF EXISTS knowledge_entries');
      await client.query(`CREATE TABLE observations (
        id text, tenant_id text NOT NULL, subject_id text NOT NULL, subject_type text, topic text,
        statement text, facts jsonb, source text, confidence text, ai_involved boolean,
        source_event_ids text[], source_observation_ids text[], observed_at text, actor text, version int)`);
      await client.query(`CREATE TABLE knowledge_entries (
        id text, tenant_id text NOT NULL, subject_id text NOT NULL, subject_type text, topic text,
        kind text, status text NOT NULL, statement text, content jsonb, confidence text,
        ai_involved boolean, supporting_observation_ids text[], superseded_by_id text,
        asserted_at text, asserted_by text, expires_at text, version int)`);
      await client.query(`INSERT INTO observations (id,tenant_id,subject_id,topic,observed_at,version) VALUES
        ('o-a','tenant-A','subj-1','health','2026-01-01T00:00:00Z',1),
        ('o-b','tenant-B','subj-1','health','2026-01-01T00:00:00Z',1)`);
      await client.query(`INSERT INTO knowledge_entries
        (id,tenant_id,subject_id,topic,status,asserted_at,version) VALUES
        ('k-a','tenant-A','subj-1','health','active','2026-01-01T00:00:00Z',1),
        ('k-b','tenant-B','subj-1','health','active','2026-01-01T00:00:00Z',1)`);
    });

    const repo = new KnowledgeRepository(db);
    expect((await repo.getObservationById('tenant-A', 'o-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect(await repo.getObservationById('tenant-B', 'o-a' as AlaraId)).toBeNull();
    expect((await repo.getObservationsForSubject('tenant-A', 'subj-1')).map((o) => o.id)).toEqual(['o-a']);
    expect((await repo.getEntryById('tenant-A', 'k-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect((await repo.getActiveEntriesForSubject('tenant-A', 'subj-1')).map((e) => e.id)).toEqual(['k-a']);
    expect((await repo.getAllEntriesForSubject('tenant-A', 'subj-1')).map((e) => e.id)).toEqual(['k-a']);
  });

  test('WorkforceRepository reads return the correct tenant rows on real Postgres', async () => {
    // Functional proof the MIGRATED workforce reads work end-to-end across all dedicated tables.
    // Throwaway tables dropped in afterAll.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS workforce_members');
      await client.query('DROP TABLE IF EXISTS workforce_availability');
      await client.query('DROP TABLE IF EXISTS assignments');
      await client.query('DROP TABLE IF EXISTS capacity_snapshots');
      await client.query('DROP TABLE IF EXISTS workforce_teams');
      await client.query(`CREATE TABLE workforce_members (
        id text, tenant_id text NOT NULL, display_name text, role text, status text NOT NULL,
        team_id text, supervisor_id text, external_hr_id text, skill_profile jsonb, coverage_area jsonb,
        escalation_path_id text, created_at text, updated_at text, version int)`);
      await client.query(`CREATE TABLE workforce_availability (
        member_id text NOT NULL, tenant_id text NOT NULL, status text, current_load int, max_load int,
        next_available_at text, unavailable_until text, snapshot_at text)`);
      await client.query(`CREATE TABLE assignments (
        id text, tenant_id text NOT NULL, subject_id text NOT NULL, subject_type text, assignee_id text,
        assignee_name text, priority text, status text NOT NULL, reason text, evidence jsonb,
        confidence text, transferred_from_id text, rules_engine_approved boolean,
        rules_engine_explanation text, due_at text, accepted_at text, completed_at text,
        created_at text, version int)`);
      await client.query(`CREATE TABLE capacity_snapshots (
        id text, tenant_id text NOT NULL, member_id text NOT NULL, current_load int, max_load int,
        utilization_rate real, active_assignment_ids text[], snapshot_at text, version int)`);
      await client.query(`CREATE TABLE workforce_teams (
        id text, tenant_id text NOT NULL, name text, description text, lead_id text,
        member_ids text[], specializations text[], created_at text, version int)`);
      await client.query(`INSERT INTO workforce_members
        (id,tenant_id,display_name,role,status,created_at,updated_at,version) VALUES
        ('m-a','tenant-A','Jane','care_guide','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1),
        ('m-b','tenant-B','John','care_guide','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1)`);
      await client.query(`INSERT INTO workforce_availability
        (member_id,tenant_id,status,current_load,max_load,snapshot_at) VALUES
        ('m-a','tenant-A','available',1,5,'2026-01-01T00:00:00Z')`);
      await client.query(`INSERT INTO assignments
        (id,tenant_id,subject_id,assignee_id,priority,status,created_at,version) VALUES
        ('as-a','tenant-A','subj-1','m-a','high','approved','2026-01-01T00:00:00Z',1),
        ('as-b','tenant-B','subj-1','m-b','high','approved','2026-01-01T00:00:00Z',1)`);
      await client.query(`INSERT INTO capacity_snapshots
        (id,tenant_id,member_id,current_load,max_load,utilization_rate,snapshot_at,version) VALUES
        ('cap-a','tenant-A','m-a',1,5,0.2,'2026-01-01T00:00:00Z',1)`);
      await client.query(`INSERT INTO workforce_teams (id,tenant_id,name,created_at,version) VALUES
        ('t-a','tenant-A','Team A','2026-01-01T00:00:00Z',1)`);
    });

    const repo = new WorkforceRepository(db);
    expect((await repo.getMemberById('tenant-A', 'm-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect(await repo.getMemberById('tenant-B', 'm-a' as AlaraId)).toBeNull();
    expect((await repo.getActiveMembersForTenant('tenant-A')).map((m) => m.id)).toEqual(['m-a']);
    expect((await repo.getAllMembersForTenant('tenant-A')).map((m) => m.id)).toEqual(['m-a']);
    expect((await repo.getAvailability('tenant-A', 'm-a' as AlaraId))?.memberId).toBe('m-a');
    expect((await repo.getAssignmentById('tenant-A', 'as-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect((await repo.getAssignmentsForSubject('tenant-A', 'subj-1')).map((a) => a.id)).toEqual(['as-a']);
    expect((await repo.getActiveAssignmentsForMember('tenant-A', 'm-a' as AlaraId)).map((a) => a.id)).toEqual(['as-a']);
    expect((await repo.getLatestCapacity('tenant-A', 'm-a' as AlaraId))?.memberId).toBe('m-a');
    expect((await repo.getTeamById('tenant-A', 't-a' as AlaraId))?.tenantId).toBe('tenant-A');
  });

  // ── RLS step 2 Batch A aggregates (Slice 35): one tenant-scoped transaction per aggregate ──────

  test('KnowledgeRepository.query (one transaction) returns only tenant-local entries + observations', async () => {
    // Functional proof the aggregate's two reads run end-to-end on real Postgres and cannot pull a
    // foreign tenant's rows. Throwaway tables dropped in afterAll.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS observations');
      await client.query('DROP TABLE IF EXISTS knowledge_entries');
      await client.query(`CREATE TABLE observations (
        id text, tenant_id text NOT NULL, subject_id text NOT NULL, subject_type text, topic text,
        statement text, facts jsonb, source text, confidence text, ai_involved boolean,
        source_event_ids text[], source_observation_ids text[], observed_at text, actor text, version int)`);
      await client.query(`CREATE TABLE knowledge_entries (
        id text, tenant_id text NOT NULL, subject_id text NOT NULL, subject_type text, topic text,
        kind text, status text NOT NULL, statement text, content jsonb, confidence text,
        ai_involved boolean, supporting_observation_ids text[], superseded_by_id text,
        asserted_at text, asserted_by text, expires_at text, version int)`);
      await client.query(`INSERT INTO observations (id,tenant_id,subject_id,topic,observed_at,version) VALUES
        ('o-a','tenant-A','subj-1','health','2026-01-01T00:00:00Z',1),
        ('o-b','tenant-B','subj-1','health','2026-01-01T00:00:00Z',1)`);
      await client.query(`INSERT INTO knowledge_entries
        (id,tenant_id,subject_id,topic,status,asserted_at,version) VALUES
        ('k-a','tenant-A','subj-1','health','active','2026-01-01T00:00:00Z',1),
        ('k-b','tenant-B','subj-1','health','active','2026-01-01T00:00:00Z',1)`);
    });

    const repo = new KnowledgeRepository(db);
    const a = await repo.query({ tenantId: 'tenant-A', subjectId: 'subj-1' });
    expect(a.entries.map((e) => e.id)).toEqual(['k-a']);          // never k-b
    expect(a.observations.map((o) => o.id)).toEqual(['o-a']);     // never o-b
    const b = await repo.query({ tenantId: 'tenant-B', subjectId: 'subj-1' });
    expect(b.entries.map((e) => e.id)).toEqual(['k-b']);
    expect(b.observations.map((o) => o.id)).toEqual(['o-b']);     // cross-tenant rows cannot participate
  });

  test('WorkforceRepository.getAvailabilityForMembers (one transaction) returns only tenant-local rows', async () => {
    // The batch reads availability for a list of member ids in ONE transaction; a foreign tenant's
    // availability row for the same member id must never appear. Throwaway table dropped in afterAll.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS workforce_availability');
      await client.query(`CREATE TABLE workforce_availability (
        member_id text NOT NULL, tenant_id text NOT NULL, status text, current_load int, max_load int,
        next_available_at text, unavailable_until text, snapshot_at text)`);
      // Same member id 'm-1' exists for BOTH tenants; 'm-2' only for tenant-A; 'm-3' for neither.
      await client.query(`INSERT INTO workforce_availability
        (member_id,tenant_id,status,current_load,max_load,snapshot_at) VALUES
        ('m-1','tenant-A','available',1,5,'2026-01-01T00:00:00Z'),
        ('m-1','tenant-B','offline',0,5,'2026-01-01T00:00:00Z'),
        ('m-2','tenant-A','available',2,5,'2026-01-01T00:00:00Z')`);
    });

    const repo = new WorkforceRepository(db);
    const mapA = await repo.getAvailabilityForMembers('tenant-A', ['m-1', 'm-2', 'm-3'] as AlaraId[]);
    expect([...mapA.keys()].sort()).toEqual(['m-1', 'm-2']);      // m-3 absent
    expect(mapA.get('m-1')?.status).toBe('available');           // tenant-A row, not tenant-B's 'offline'
    expect(mapA.has('m-3')).toBe(false);

    const mapB = await repo.getAvailabilityForMembers('tenant-B', ['m-1', 'm-2'] as AlaraId[]);
    expect([...mapB.keys()]).toEqual(['m-1']);                   // m-2 belongs to tenant-A only
    expect(mapB.get('m-1')?.status).toBe('offline');             // cross-tenant rows cannot participate
  });

  // ── RLS step 2 — ConsentRepository (central `objects` table) ────────────────────────────────

  test('ConsentRepository reads return only tenant-local Consent objects on real Postgres', async () => {
    // Functional proof the MIGRATED reads of the shared `objects` table work end-to-end (the SELECTs,
    // the set_config wrapping, the JSONB subjectId filter, the type guard). Throwaway `objects` table
    // dropped in afterAll. NOTE: this does NOT enable RLS on `objects` — enablement stays gated on the
    // other `objects` readers (ObjectGraph + the by-id idempotency special case).
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS objects');
      await client.query(`CREATE TABLE objects (
        id text, tenant_id text NOT NULL, type text, state text, attributes jsonb, version int,
        created_at text, updated_at text)`);
      await client.query(`INSERT INTO objects (id,tenant_id,type,state,attributes,version) VALUES
        ('c-a','tenant-A','Consent','active',
          '{"subjectId":"subj-1","recipientId":"rec-1","consentId":"consent-a","status":"active"}',1),
        ('c-b','tenant-B','Consent','active',
          '{"subjectId":"subj-1","recipientId":"rec-2","consentId":"consent-b","status":"active"}',1),
        ('p-a','tenant-A','Patient','active','{"subjectId":"subj-1"}',1)`);
    });

    const repo = new ConsentRepository(db);

    // findForSubject: tenant-local only; cross-tenant rows cannot participate.
    expect((await repo.findForSubject('tenant-A', 'subj-1')).map((f) => f.consentId)).toEqual(['consent-a']);
    expect((await repo.findForSubject('tenant-B', 'subj-1')).map((f) => f.consentId)).toEqual(['consent-b']);
    expect(await repo.findForSubject('tenant-A', 'no-such-subject')).toEqual([]);

    // findById: tenant-local only, and a wrong-type row with a matching id → null.
    expect((await repo.findById('tenant-A', 'c-a'))?.consentId).toBe('consent-a');
    expect(await repo.findById('tenant-B', 'c-a')).toBeNull();        // wrong tenant → null
    expect(await repo.findById('tenant-A', 'p-a')).toBeNull();        // non-Consent type → null
  });

  // ── RLS step 2 — ObjectGraphRepository reads (Slice 40a; central `objects` + `external_references`) ──

  test('ObjectGraphRepository reads return only tenant-local rows on real Postgres', async () => {
    // Functional proof the MIGRATED reads work end-to-end on the shared `objects` table + the
    // `external_references` JOIN. Fixtures faithful to migration 001: objects.attributes JSONB +
    // created_at/updated_at; external_references PK (object_id, system, ext_type). Dropped in afterAll.
    // NOTE: reads only — the write path (create/update/createWithClient + the command-handler
    // transaction + by-id readback) is untouched here; no RLS policy on `objects` (GUC inert).
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS external_references');
      await client.query('DROP TABLE IF EXISTS objects');
      await client.query(`CREATE TABLE objects (
        id text, tenant_id text NOT NULL, type text, state text, attributes jsonb, version int,
        created_at text, updated_at text)`);
      await client.query(`CREATE TABLE external_references (
        object_id text, tenant_id text NOT NULL, system text, ext_type text, value text,
        PRIMARY KEY (object_id, system, ext_type))`);
      await client.query(`INSERT INTO objects (id,tenant_id,type,state,attributes,version,created_at,updated_at) VALUES
        ('o-a','tenant-A','Patient','created','{"x":1}',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
        ('o-b','tenant-B','Patient','created','{"x":2}',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
      // Same (system, ext_type, value) for both tenants but pointing at different objects.
      await client.query(`INSERT INTO external_references (object_id,tenant_id,system,ext_type,value) VALUES
        ('o-a','tenant-A','Automynd','patient_id','AM-1'),
        ('o-b','tenant-B','Automynd','patient_id','AM-1')`);
    });

    const repo = new ObjectGraphRepository(db);

    // getById: tenant-local only.
    expect((await repo.getById('tenant-A', 'o-a' as AlaraId))?.tenantId).toBe('tenant-A');
    expect(await repo.getById('tenant-B', 'o-a' as AlaraId)).toBeNull();           // wrong tenant → null

    // getExternalReferences: tenant-local only.
    expect((await repo.getExternalReferences('tenant-A', 'o-a' as AlaraId)).map((r) => r.value)).toEqual(['AM-1']);
    expect(await repo.getExternalReferences('tenant-B', 'o-a' as AlaraId)).toEqual([]);   // wrong tenant → empty

    // findByExternalReference: the JOIN returns only the caller-tenant object, even though the same
    // (system, ext_type, value) exists for both tenants.
    expect((await repo.findByExternalReference('tenant-A', 'Automynd', 'patient_id', 'AM-1')).map((o) => o.id))
      .toEqual(['o-a']);
    expect((await repo.findByExternalReference('tenant-B', 'Automynd', 'patient_id', 'AM-1')).map((o) => o.id))
      .toEqual(['o-b']);                                                            // cannot cross tenants
    expect(await repo.findByExternalReference('tenant-A', 'Automynd', 'patient_id', 'none')).toEqual([]);
  });

  // ── RLS step 2 — EventStore reads + standalone append (Slice 40b-i; central `events` table) ──

  test('EventStore reads are tenant-local and standalone append writes under the GUC tenant', async () => {
    // Functional proof on real Postgres: tenant-scoped reads + the standalone append path (advisory
    // lock / idempotency / seq / INSERT) writing under the GUC tenant, idempotent on id, seq
    // incrementing. Fixture faithful to migration 001: id TEXT PK, payload JSONB, UNIQUE(stream_id,seq);
    // occurred_at defaults so the INSERT (which omits it) works. Dropped in afterAll. NOTE: the
    // client-provided append path + its owning transactions are untouched here; no RLS policy on
    // `events` (GUC inert).
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS events');
      await client.query(`CREATE TABLE events (
        id text PRIMARY KEY, tenant_id text NOT NULL, stream_id text NOT NULL, seq int NOT NULL,
        type text, payload jsonb, actor text, occurred_at timestamptz NOT NULL DEFAULT now(),
        causation_id text, correlation_id text,
        CONSTRAINT events_stream_seq_unique UNIQUE (stream_id, seq))`);
    });

    const store = new EventStore(db);

    // standalone append: two events on tenant-A stream 'sa' (seq 1, 2), one on tenant-B stream 'sb'.
    await store.append({ tenantId: 'tenant-A', streamId: 'sa' as AlaraId, type: 'ObjectCreated' as EventType, payload: { x: 1 }, actor: 'system' });
    await store.append({ tenantId: 'tenant-A', streamId: 'sa' as AlaraId, type: 'ObjectUpdated' as EventType, payload: { x: 2 }, actor: 'system' });
    await store.append({ tenantId: 'tenant-B', streamId: 'sb' as AlaraId, type: 'ObjectCreated' as EventType, payload: {}, actor: 'system' });

    // idempotency: appending the same deterministic eventId twice yields one row (returns the stored event).
    const d1 = await store.append({ tenantId: 'tenant-A', streamId: 'sa' as AlaraId, type: 'ObjectUpdated' as EventType, payload: {}, actor: 'system', eventId: 'dup-1' });
    const d2 = await store.append({ tenantId: 'tenant-A', streamId: 'sa' as AlaraId, type: 'ObjectUpdated' as EventType, payload: {}, actor: 'system', eventId: 'dup-1' });
    expect(d1.id).toBe('dup-1');
    expect(d2.id).toBe('dup-1');

    // seq increments per stream (1,2,3) and reads are tenant-local.
    expect((await store.loadStream('tenant-A', 'sa' as AlaraId)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await store.countInStream('tenant-A', 'sa' as AlaraId)).toBe(3);   // not 4 → idempotent

    // cross-tenant exclusion: a tenant cannot read another tenant's stream.
    expect(await store.loadStream('tenant-B', 'sa' as AlaraId)).toEqual([]);  // sa belongs to tenant-A
    expect(await store.loadStream('tenant-A', 'sb' as AlaraId)).toEqual([]);  // sb belongs to tenant-B
    expect(await store.countInStream('tenant-B', 'sa' as AlaraId)).toBe(0);

    // loadAll is tenant-scoped (no cursor + cursor branch both return only the caller's tenant rows).
    expect((await store.loadAll('tenant-A')).every((e) => e.tenantId === 'tenant-A')).toBe(true);
    expect((await store.loadAll('tenant-A')).length).toBe(3);
    expect((await store.loadAll('tenant-B')).map((e) => e.streamId)).toEqual(['sb']);
  });

  // ── RLS step 2 write phase — JourneyRepository writes (Slice 38) ────────────────────────────

  test('JourneyRepository writes and reads land under the GUC tenant and respect cross-tenant isolation', async () => {
    // Functional proof the 11 migrated writes work end-to-end on real Postgres across all five
    // journey_* tables. Fixtures are faithful to migration 011: JSONB columns (coordination_state,
    // meta, payload, work_summary/next_step/human_handoff), the `merged_from` ARRAY column, and the
    // PRIMARY KEY / UNIQUE constraints the ON CONFLICT clauses require. Dropped in afterAll. NOTE: no
    // RLS policy on journey_* here — GUC is inert; this proves the SQL/encoding, not enforcement.
    await db.transaction(async (client) => {
      await client.query('DROP TABLE IF EXISTS journeys');
      await client.query('DROP TABLE IF EXISTS journey_references');
      await client.query('DROP TABLE IF EXISTS journey_events');
      await client.query('DROP TABLE IF EXISTS journey_projections');
      await client.query('DROP TABLE IF EXISTS journey_capability_tokens');
      await client.query(`CREATE TABLE journeys (
        id text PRIMARY KEY, tenant_id text NOT NULL, intent text, intent_inferred_at text,
        lifecycle text, lifecycle_changed_at text, coordination_state jsonb, identity_resolved boolean,
        merged_from text[], split_from text, created_at text, updated_at text)`);
      await client.query(`CREATE TABLE journey_references (
        id text PRIMARY KEY, tenant_id text NOT NULL, journey_id text, kind text, ref_id text,
        role text, linked_at text, linked_by text, meta jsonb,
        UNIQUE (tenant_id, journey_id, kind, ref_id))`);
      await client.query(`CREATE TABLE journey_events (
        id text PRIMARY KEY, tenant_id text NOT NULL, journey_id text, event_type text, payload jsonb,
        ref_kind text, ref_id text, occurred_at text, caused_by text)`);
      await client.query(`CREATE TABLE journey_projections (
        journey_id text PRIMARY KEY, tenant_id text NOT NULL, projection_type text, lifecycle text,
        intent text, obstacle text, actor text, work_summary jsonb, next_step jsonb, human_handoff jsonb,
        last_event_id text, projected_at text)`);
      await client.query(`CREATE TABLE journey_capability_tokens (
        token text PRIMARY KEY, journey_id text, tenant_id text NOT NULL, issued_at text,
        expires_at text, revoked boolean NOT NULL DEFAULT false, revoked_at text)`);
    });

    const repo = new JourneyRepository(db);
    const NOW = new Date('2026-06-28T00:00:00.000Z');
    const mkJourney = (id: string, tenantId: string): Journey => ({
      id: id as AlaraId, tenantId, intent: null, intentInferredAt: null, lifecycle: 'arrival',
      lifecycleChangedAt: NOW, coordinationState: { a: 1 }, identityResolved: false,
      mergedFrom: [], splitFrom: null, createdAt: NOW, updatedAt: NOW,
    });

    // insert: two journeys in different tenants.
    await repo.insert(mkJourney('jA', 'tenant-A'));
    await repo.insert(mkJourney('jB', 'tenant-B'));
    expect((await repo.findById('jA' as AlaraId, 'tenant-A'))?.tenantId).toBe('tenant-A');
    expect(await repo.findById('jA' as AlaraId, 'tenant-B')).toBeNull();   // wrong tenant → null

    // updateLifecycle: wrong-tenant update affects nothing; correct-tenant update applies.
    await repo.updateLifecycle('jA' as AlaraId, 'tenant-B', 'working', NOW);   // wrong tenant → no-op
    expect((await repo.findById('jA' as AlaraId, 'tenant-A'))?.lifecycle).toBe('arrival');
    await repo.updateLifecycle('jA' as AlaraId, 'tenant-A', 'working', NOW);   // correct tenant
    expect((await repo.findById('jA' as AlaraId, 'tenant-A'))?.lifecycle).toBe('working');

    // updateMergedFrom: the RAW array round-trips through the text[] column.
    await repo.updateMergedFrom('jA' as AlaraId, 'tenant-A', ['x', 'y'] as AlaraId[], NOW);
    expect((await repo.findById('jA' as AlaraId, 'tenant-A'))?.mergedFrom).toEqual(['x', 'y']);

    // appendEvent + getEvents.
    const EVT: JourneyEvent = {
      id: 'e1', journeyId: 'jA' as AlaraId, tenantId: 'tenant-A', eventType: 'JourneyStarted',
      payload: { p: 1 }, refKind: null, refId: null, occurredAt: NOW, causedBy: null,
    };
    await repo.appendEvent(EVT);
    expect((await repo.getEvents('jA' as AlaraId, 'tenant-A')).map((e) => e.id)).toEqual(['e1']);

    // insertReference is idempotent (ON CONFLICT (tenant_id, journey_id, kind, ref_id) DO NOTHING).
    const REF: JourneyReference = {
      id: 'ref1' as AlaraId, journeyId: 'jA' as AlaraId, tenantId: 'tenant-A', kind: 'person',
      refId: 'p1' as AlaraId, role: 'subject', linkedAt: NOW, linkedBy: null, meta: { k: 'v' },
    };
    await repo.insertReference(REF);
    await repo.insertReference({ ...REF, id: 'ref2' as AlaraId });   // same conflict key → DO NOTHING
    expect((await repo.getReferences('jA' as AlaraId, 'tenant-A')).map((x) => x.id)).toEqual(['ref1']);

    // upsertProjection inserts then updates (ON CONFLICT (journey_id)) without duplicating.
    const mkProj = (lifecycle: JourneyProjection['lifecycle']): JourneyProjection => ({
      PROJECTION_TYPE: 'journey_state', journeyId: 'jA' as AlaraId, tenantId: 'tenant-A',
      lifecycle, intent: null, obstacle: null, actor: null, workSummary: [], nextStep: null,
      humanHandoff: null, lastEventId: null, projectedAt: NOW,
    });
    await repo.upsertProjection(mkProj('arrival'));
    await repo.upsertProjection(mkProj('working'));
    expect((await repo.getProjection('jA' as AlaraId, 'tenant-A'))?.lifecycle).toBe('working');

    // storeToken / resolveToken (cross-tenant) / revokeToken.
    await repo.storeToken('tok1', 'jA' as AlaraId, 'tenant-A', null, NOW);
    expect(String(await repo.resolveToken('tok1', 'tenant-A'))).toBe('jA');
    expect(await repo.resolveToken('tok1', 'tenant-B')).toBeNull();   // cross-tenant → null
    await repo.revokeToken('tok1', 'tenant-A', NOW);
    expect(await repo.resolveToken('tok1', 'tenant-A')).toBeNull();   // revoked → null

    // ── reads (RLS step 2) return only tenant-local rows; wrong tenant → empty/null ──────────────
    // same-tenant reads see jA's data…
    expect((await repo.listByLifecycle('working', 'tenant-A')).map((j) => j.id)).toEqual(['jA']);
    expect((await repo.getReferences('jA' as AlaraId, 'tenant-A')).map((x) => x.id)).toEqual(['ref1']);
    expect((await repo.getEvents('jA' as AlaraId, 'tenant-A')).map((e) => e.id)).toEqual(['e1']);
    expect((await repo.getProjection('jA' as AlaraId, 'tenant-A'))?.lifecycle).toBe('working');
    expect((await repo.findJourneysReferencing('person', 'p1' as AlaraId, 'tenant-A')).map(String)).toEqual(['jA']);
    // …wrong-tenant reads of jA's data return empty / null (cannot cross tenants).
    expect(await repo.listByLifecycle('working', 'tenant-B')).toEqual([]);
    expect(await repo.getReferences('jA' as AlaraId, 'tenant-B')).toEqual([]);
    expect(await repo.getEvents('jA' as AlaraId, 'tenant-B')).toEqual([]);
    expect(await repo.getProjection('jA' as AlaraId, 'tenant-B')).toBeNull();
    expect(await repo.findJourneysReferencing('person', 'p1' as AlaraId, 'tenant-B')).toEqual([]);
  });

  test('Batch A primary tables enforce RLS isolation under a NON-superuser role', async () => {
    // Mirrors the established RLS proof for each Batch A repo's primary table shape (tenant_id/
    // subject_id). The probe SELECT runs under a fixture-local non-superuser role so FORCE RLS is not
    // bypassed. Table + role names are hard-coded literals (not user input) → safe to interpolate.
    const probes = [
      ['brain_rls_probe', 'brain_probe_role'],
      ['know_rls_probe', 'know_probe_role'],
      ['wf_rls_probe', 'wf_probe_role'],
    ] as const;

    for (const [table, role] of probes) {
      await db.transaction(async (client) => {
        await client.query(`DROP TABLE IF EXISTS ${table}`);
        await client.query(`DROP ROLE IF EXISTS ${role}`);
        await client.query(`CREATE ROLE ${role} NOLOGIN`);
        await client.query(`CREATE TABLE ${table} (tenant_id text NOT NULL, subject_id text, val text)`);
        await client.query(`INSERT INTO ${table} VALUES ('tenant-A','s','a'), ('tenant-B','s','b')`);
        await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        await client.query(
          `CREATE POLICY tenant_isolation ON ${table} USING (tenant_id = current_setting('${TENANT_GUC}', true))`,
        );
        await client.query(`GRANT SELECT ON ${table} TO ${role}`);
      });

      const visibleFor = (tenant: string) =>
        withTenantTransaction(db, tenant, async (client) => {
          await client.query(`SET LOCAL ROLE ${role}`);
          const r = await client.query(`SELECT tenant_id FROM ${table} ORDER BY tenant_id`);
          return r.rows.map((x) => (x as { tenant_id: string }).tenant_id);
        });

      expect(await visibleFor('tenant-A')).toEqual(['tenant-A']); // A cannot see B's rows
      expect(await visibleFor('tenant-B')).toEqual(['tenant-B']);
    }
  });
});
