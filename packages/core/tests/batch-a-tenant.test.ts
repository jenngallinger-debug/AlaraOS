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

// ── RLS step 2 Batch A aggregates (Slice 35): ONE transaction, one GUC, one client ────────────

/**
 * Fake DB that routes canned rows by SQL (so aggregates issuing >1 distinct SELECT are provable):
 * a SINGLE client instance records every query into one array — proving "all on one client" — and
 * `txnCount` proves exactly one transaction. `availByMember` keys availability rows by member id so
 * the per-member batch can return found/missing per id.
 */
function makeRoutingDb(opts: {
  entryRows?: Record<string, unknown>[];
  obsRows?: Record<string, unknown>[];
  availByMember?: Record<string, Record<string, unknown>[]>;
}) {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/set_config/i.test(text)) return { rows: [{}] };
      if (/FROM knowledge_entries/i.test(text)) return { rows: opts.entryRows ?? [] };
      if (/FROM observations/i.test(text)) return { rows: opts.obsRows ?? [] };
      if (/FROM workforce_availability/i.test(text)) {
        const memberId = String((values ?? [])[0]);
        return { rows: (opts.availByMember ?? {})[memberId] ?? [] };
      }
      return { rows: [] };
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

const AVAIL = (memberId: string) => ({
  member_id: memberId, tenant_id: 'tenant-A', status: 'available', current_load: 1, max_load: 5,
  next_available_at: null, unavailable_until: null, snapshot_at: '2026-01-01T00:00:00Z',
});

describe('KnowledgeRepository.query (Batch A aggregate, ONE transaction)', () => {
  test('runs both reads in a single transaction with the GUC set once, entries then observations on one client', async () => {
    const h = makeRoutingDb({ entryRows: [ENTRY], obsRows: [OBS] });
    const res = await new KnowledgeRepository(h.db).query({ tenantId: 'tenant-A', subjectId: 'subj-1' });

    // ── ONE transaction; GUC set exactly once ────────────────────────────────
    expect(h.state.txnCount).toBe(1);
    const gucSets = h.queries.filter((q) => /set_config/i.test(q.text));
    expect(gucSets).toHaveLength(1);
    expect(gucSets[0].values).toEqual([TENANT_GUC, 'tenant-A']);

    // ── every query ran on the same client, entries SELECT before observations SELECT ─
    expect(h.queries.map((q) => q.text)).toEqual([
      'SELECT set_config($1, $2, true)',
      "SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY asserted_at DESC",
      'SELECT * FROM observations WHERE tenant_id = $1 AND subject_id = $2 ORDER BY observed_at DESC',
    ]);
    expect(h.queries[1].values).toEqual(['tenant-A', 'subj-1']);
    expect(h.queries[2].values).toEqual(['tenant-A', 'subj-1']);

    // ── identical returned result shape ──────────────────────────────────────
    expect(res.subjectId).toBe('subj-1');
    expect(res.entries.map((e) => e.id)).toEqual(['e1']);
    expect(res.observations.map((o) => o.id)).toEqual(['obs1']);
    expect(res.totalEntries).toBe(1);
    expect(res.totalObservations).toBe(1);
  });

  test('topic branch: both reads carry the topic param ($3) in the single transaction', async () => {
    const h = makeRoutingDb({ entryRows: [], obsRows: [] });
    await new KnowledgeRepository(h.db).query({ tenantId: 'tenant-A', subjectId: 'subj-1', topic: 'eligibility' });
    expect(h.state.txnCount).toBe(1);
    expect(h.queries[1].text).toBe(
      "SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND topic = $3 AND status = 'active' ORDER BY asserted_at DESC",
    );
    expect(h.queries[1].values).toEqual(['tenant-A', 'subj-1', 'eligibility']);
    expect(h.queries[2].text).toBe(
      'SELECT * FROM observations WHERE tenant_id = $1 AND subject_id = $2 AND topic = $3 ORDER BY observed_at DESC',
    );
    expect(h.queries[2].values).toEqual(['tenant-A', 'subj-1', 'eligibility']);
  });

  test('in-memory filtering preserved: kind filter drops non-matching entries (still one transaction)', async () => {
    const h = makeRoutingDb({ entryRows: [ENTRY, { ...ENTRY, id: 'e2', kind: 'risk' }], obsRows: [OBS] });
    const res = await new KnowledgeRepository(h.db).query({ tenantId: 'tenant-A', subjectId: 'subj-1', kind: 'risk' });
    expect(h.state.txnCount).toBe(1);
    expect(res.entries.map((e) => e.id)).toEqual(['e2']);
    expect(res.totalEntries).toBe(1);
    expect(res.observations.map((o) => o.id)).toEqual(['obs1']);
  });
});

describe('WorkforceRepository.getAvailabilityForMembers (Batch A aggregate, ONE transaction)', () => {
  test('batches all per-member reads in a single transaction with the GUC set once, on one client', async () => {
    const h = makeRoutingDb({ availByMember: { m1: [AVAIL('m1')], m3: [AVAIL('m3')] } }); // m2 missing
    const map = await new WorkforceRepository(h.db).getAvailabilityForMembers(
      'tenant-A', ['m1', 'm2', 'm3'] as AlaraId[],
    );

    // ── ONE transaction; GUC set exactly once ────────────────────────────────
    expect(h.state.txnCount).toBe(1);
    const gucSets = h.queries.filter((q) => /set_config/i.test(q.text));
    expect(gucSets).toHaveLength(1);
    expect(gucSets[0].values).toEqual([TENANT_GUC, 'tenant-A']);

    // ── one availability SELECT per member, IN ORDER, identical SQL/params, all one client ─
    const availQueries = h.queries.filter((q) => /FROM workforce_availability/i.test(q.text));
    expect(availQueries).toHaveLength(3);
    for (const q of availQueries) {
      expect(q.text).toBe('SELECT * FROM workforce_availability WHERE member_id = $1 AND tenant_id = $2');
    }
    expect(availQueries.map((q) => q.values)).toEqual([
      ['m1', 'tenant-A'], ['m2', 'tenant-A'], ['m3', 'tenant-A'],
    ]);

    // ── identical Map result: only found members, String(id) keys ────────────
    expect([...map.keys()]).toEqual(['m1', 'm3']);
    expect(map.get('m1')?.memberId).toBe('m1');
    expect(map.has('m2')).toBe(false);
  });

  test('empty member list: still one transaction, no availability SELECTs, empty map', async () => {
    const h = makeRoutingDb({});
    const map = await new WorkforceRepository(h.db).getAvailabilityForMembers('tenant-A', [] as AlaraId[]);
    expect(h.state.txnCount).toBe(1);
    expect(h.queries.filter((q) => /FROM workforce_availability/i.test(q.text))).toHaveLength(0);
    expect(map.size).toBe(0);
  });
});
