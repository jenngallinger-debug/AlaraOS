/**
 * Alara OS — RLS step 2 Batch A: read repositories after migration (unit, no Postgres)
 *
 * Proves the migrated single-statement reads of KnowledgeRepository, WorkforceRepository, and
 * OrganizationalBrainRepository are behavior-preserving while RLS is inert: GUC set ONCE
 * (parameterized) inside a single transaction, byte-identical SQL + params, identical mapping, and
 * identical null/array returns. Mocked DatabaseClient (helper's transaction + client) → default suite.
 */

import { DatabaseClient } from '../src/shared/database';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';
import { KnowledgeRepository } from '../src/knowledge-engine/repository';
import { WorkforceRepository } from '../src/workforce-engine/repository';
import { OrganizationalBrainRepository } from '../src/organizational-brain/repository';
import { PatternCategory } from '../src/organizational-brain/types';

interface Captured { text: string; values?: unknown[] }

/** Fake DB: `transaction` runs fn with a single client returning `dataRows` for any non-GUC query. */
function makeFakeDb(dataRows: Record<string, unknown>[]) {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return /set_config/i.test(text) ? { rows: [{}] } : { rows: dataRows };
    },
  };
  const db = {
    async transaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
      state.txnCount += 1;
      return fn(client as never);
    },
  } as unknown as DatabaseClient;
  return { db, queries, state };
}

/** Assert: exactly one transaction, GUC set first (parameterized), and the data SELECT matches. */
function expectTenantScoped(h: ReturnType<typeof makeFakeDb>, tenantId: string, sql: string, params: unknown[]) {
  expect(h.state.txnCount).toBe(1);
  expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, tenantId] });
  expect(h.queries[1].text).toBe(sql);
  expect(h.queries[1].values).toEqual(params);
}

const PATTERN = {
  id: 'pat1', tenant_id: 'tenant-A', category: 'risk', title: 't', description: 'd',
  subject_id: 'subj-1', subject_type: 'Patient', evidence: {}, confidence: 'high', severity: 'high',
  status: 'active', detector_id: 'det', detector_version: '1', superseded_by_id: null,
  first_detected_at: '2026-01-01T00:00:00Z', last_confirmed_at: '2026-01-01T00:00:00Z', resolved_at: null, version: 1,
};
const OBS = {
  id: 'obs1', tenant_id: 'tenant-A', subject_id: 'subj-1', subject_type: 'Patient', topic: 'x',
  statement: 's', facts: {}, source: 'src', confidence: 'high', ai_involved: false,
  source_event_ids: [], source_observation_ids: [], observed_at: '2026-01-01T00:00:00Z', actor: 'a', version: 1,
};
const ENTRY = {
  id: 'e1', tenant_id: 'tenant-A', subject_id: 'subj-1', subject_type: 'Patient', topic: 'x', kind: 'fact',
  status: 'active', statement: 's', content: {}, confidence: 'high', ai_involved: false,
  supporting_observation_ids: [], superseded_by_id: null, asserted_at: '2026-01-01T00:00:00Z', asserted_by: 'a',
  expires_at: null, version: 1,
};
const MEMBER = {
  id: 'm1', tenant_id: 'tenant-A', display_name: 'Jane', role: 'care_guide', status: 'active',
  team_id: null, supervisor_id: null, external_hr_id: null, skill_profile: {}, coverage_area: {},
  escalation_path_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', version: 1,
};
const ASSIGN = {
  id: 'as1', tenant_id: 'tenant-A', subject_id: 'subj-1', subject_type: 'Patient', assignee_id: 'm1',
  assignee_name: 'Jane', priority: 'high', status: 'approved', reason: 'r', evidence: {}, confidence: 'high',
  transferred_from_id: null, rules_engine_approved: null, rules_engine_explanation: null,
  due_at: null, accepted_at: null, completed_at: null, created_at: '2026-01-01T00:00:00Z', version: 1,
};

describe('OrganizationalBrainRepository (Batch A, tenant-scoped)', () => {
  test('getPatternById: GUC-once + identical SQL/params + mapping', async () => {
    const h = makeFakeDb([PATTERN]);
    const res = await new OrganizationalBrainRepository(h.db).getPatternById('tenant-A', 'pat1' as AlaraId);
    expect(res?.id).toBe('pat1');
    expect(res?.tenantId).toBe('tenant-A');
    expectTenantScoped(h, 'tenant-A', 'SELECT * FROM detected_patterns WHERE id = $1 AND tenant_id = $2', ['pat1', 'tenant-A']);
  });

  test('getPatternById: null when no row', async () => {
    const h = makeFakeDb([]);
    expect(await new OrganizationalBrainRepository(h.db).getPatternById('tenant-A', 'nope' as AlaraId)).toBeNull();
  });

  test('getActivePatternsForSubject: no-category branch SQL/params preserved', async () => {
    const h = makeFakeDb([PATTERN]);
    const res = await new OrganizationalBrainRepository(h.db).getActivePatternsForSubject('tenant-A', 'subj-1');
    expect(res.map((p) => p.id)).toEqual(['pat1']);
    expectTenantScoped(h, 'tenant-A',
      "SELECT * FROM detected_patterns WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY first_detected_at DESC",
      ['tenant-A', 'subj-1']);
  });

  test('getActivePatternsForSubject: category branch SQL/params preserved', async () => {
    const h = makeFakeDb([PATTERN]);
    await new OrganizationalBrainRepository(h.db).getActivePatternsForSubject('tenant-A', 'subj-1', 'risk' as PatternCategory);
    expectTenantScoped(h, 'tenant-A',
      "SELECT * FROM detected_patterns WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' AND category = $3 ORDER BY first_detected_at DESC",
      ['tenant-A', 'subj-1', 'risk']);
  });
});

describe('KnowledgeRepository (Batch A, tenant-scoped)', () => {
  test('getObservationById: GUC-once + identical SQL/params + mapping', async () => {
    const h = makeFakeDb([OBS]);
    const res = await new KnowledgeRepository(h.db).getObservationById('tenant-A', 'obs1' as AlaraId);
    expect(res?.id).toBe('obs1');
    expectTenantScoped(h, 'tenant-A', 'SELECT * FROM observations WHERE id = $1 AND tenant_id = $2', ['obs1', 'tenant-A']);
  });

  test('getActiveEntriesForSubject: no-topic branch SQL/params preserved', async () => {
    const h = makeFakeDb([ENTRY]);
    const res = await new KnowledgeRepository(h.db).getActiveEntriesForSubject('tenant-A', 'subj-1');
    expect(res.map((e) => e.id)).toEqual(['e1']);
    expectTenantScoped(h, 'tenant-A',
      "SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY asserted_at DESC",
      ['tenant-A', 'subj-1']);
  });
});

describe('WorkforceRepository (Batch A, tenant-scoped)', () => {
  test('getMemberById: GUC-once + identical SQL/params + mapping', async () => {
    const h = makeFakeDb([MEMBER]);
    const res = await new WorkforceRepository(h.db).getMemberById('tenant-A', 'm1' as AlaraId);
    expect(res?.id).toBe('m1');
    expect(res?.displayName).toBe('Jane');
    expectTenantScoped(h, 'tenant-A', 'SELECT * FROM workforce_members WHERE id = $1 AND tenant_id = $2', ['m1', 'tenant-A']);
  });

  test('getMemberById: null when no row', async () => {
    const h = makeFakeDb([]);
    expect(await new WorkforceRepository(h.db).getMemberById('tenant-A', 'nope' as AlaraId)).toBeNull();
  });

  test('getActiveAssignmentsForMember: status-IN SQL/params preserved', async () => {
    const h = makeFakeDb([ASSIGN]);
    const res = await new WorkforceRepository(h.db).getActiveAssignmentsForMember('tenant-A', 'm1' as AlaraId);
    expect(res.map((a) => a.id)).toEqual(['as1']);
    expectTenantScoped(h, 'tenant-A',
      "SELECT * FROM assignments WHERE tenant_id = $1 AND assignee_id = $2 AND status IN ('approved','accepted') ORDER BY created_at DESC",
      ['tenant-A', 'm1']);
  });
});
