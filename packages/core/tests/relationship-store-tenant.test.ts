/**
 * Alara OS — RelationshipRepository read methods after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves the migrated reads are behavior-preserving while RLS is inert: same tenant-filtered SELECT
 * (incl. ORDER BY / status / active filters), same row→model mapping, same null/array returns — now
 * wrapped in a tenant-scoped transaction that sets `app.tenant_id` first. Mocked DatabaseClient (the
 * helper's transaction + client), so it runs in the default suite. Writes don't exist on this repo.
 */

import { RelationshipRepository } from '../src/relationship-engine/repository';
import { DatabaseClient } from '../src/shared/database';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';

interface Captured { text: string; values?: unknown[] }

/** Fake DB: `transaction` runs fn with a client returning canned rows by SQL; records queries. */
function makeFakeDb(opts: { relRows?: Record<string, unknown>[]; edgeRows?: Record<string, unknown>[] }) {
  const queries: Captured[] = [];
  const state = { committed: false, txnCount: 0 };
  // A SINGLE client instance — so "every query ran on the same transaction client" is provable:
  // all queries land in the one `queries` array and `txnCount` proves exactly one transaction.
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/set_config/i.test(text)) return { rows: [{}] };
      if (/FROM relationships/i.test(text)) return { rows: opts.relRows ?? [] };
      if (/FROM edges/i.test(text)) return { rows: opts.edgeRows ?? [] };
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
      state.txnCount += 1;
      const r = await fn(client as never);
      state.committed = true;
      return r;
    },
  } as unknown as DatabaseClient;
  return { db, queries, state };
}

const REL = {
  id: 'r1', tenant_id: 'tenant-A', type: 'care_team', status: 'active', subject_id: 'subj-1',
  description: 'd', version: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  terminated_at: null, termination_reason: null,
};
const EDGE = {
  id: 'e1', tenant_id: 'tenant-A', relationship_id: 'r1', participant_id: 'p1', participant_type: 'user',
  role: 'Owner', active: true, started_at: '2026-01-01T00:00:00Z', ended_at: null,
  coverage_expires_at: null, version: 1,
};

describe('RelationshipRepository reads (RLS-step-2, tenant-scoped)', () => {
  test('getById: GUC first (parameterized) in a transaction, byte-identical SELECT, maps the row', async () => {
    const h = makeFakeDb({ relRows: [REL] });
    const repo = new RelationshipRepository(h.db);
    const res = await repo.getById('tenant-A', 'r1' as AlaraId);

    expect(res?.id).toBe('r1');
    expect(res?.tenantId).toBe('tenant-A');
    expect(res?.subjectId).toBe('subj-1');
    expect(h.state.committed).toBe(true);
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, 'tenant-A'] });
    expect(h.queries[1].text).toBe('SELECT * FROM relationships WHERE id = $1 AND tenant_id = $2');
    expect(h.queries[1].values).toEqual(['r1', 'tenant-A']);
  });

  test('getById: returns null when no row', async () => {
    const h = makeFakeDb({ relRows: [] });
    const repo = new RelationshipRepository(h.db);
    expect(await repo.getById('tenant-A', 'missing' as AlaraId)).toBeNull();
  });

  test('getActiveBySubject: GUC first, unchanged SELECT (status + ORDER BY), maps rows', async () => {
    const h = makeFakeDb({ relRows: [REL, { ...REL, id: 'r2' }] });
    const repo = new RelationshipRepository(h.db);
    const res = await repo.getActiveBySubject('tenant-A', 'subj-1' as AlaraId);

    expect(res.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(h.queries[0].values).toEqual([TENANT_GUC, 'tenant-A']);
    expect(h.queries[1].text).toBe(
      "SELECT * FROM relationships WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY created_at ASC",
    );
    expect(h.queries[1].values).toEqual(['tenant-A', 'subj-1']);
  });

  test('getActiveEdgesForRelationship: GUC first, unchanged edges SELECT, maps edges', async () => {
    const h = makeFakeDb({ edgeRows: [EDGE] });
    const repo = new RelationshipRepository(h.db);
    const res = await repo.getActiveEdgesForRelationship('tenant-A', 'r1' as AlaraId);

    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('e1');
    expect(res[0].relationshipId).toBe('r1');
    expect(h.queries[0].values).toEqual([TENANT_GUC, 'tenant-A']);
    expect(h.queries[1].text).toBe(
      'SELECT * FROM edges WHERE tenant_id = $1 AND relationship_id = $2 AND active = true ORDER BY started_at ASC',
    );
    expect(h.queries[1].values).toEqual(['tenant-A', 'r1']);
  });
});

describe('RelationshipRepository.computeCareTeamView (RLS-step-2, ONE transaction)', () => {
  test('runs the whole view in a single transaction with the GUC set once, all on one client', async () => {
    const h = makeFakeDb({ relRows: [REL], edgeRows: [EDGE] }); // EDGE.relationship_id === REL.id ('r1')
    const repo = new RelationshipRepository(h.db);
    const view = await repo.computeCareTeamView('tenant-A', 'subj-1' as AlaraId);

    // ── ONE transaction; GUC set exactly once ────────────────────────────────
    expect(h.state.txnCount).toBe(1);
    const gucSets = h.queries.filter((q) => /set_config/i.test(q.text));
    expect(gucSets).toHaveLength(1);
    expect(gucSets[0].values).toEqual([TENANT_GUC, 'tenant-A']);

    // ── every query ran on the same client (the single `queries` array), in order ─
    expect(h.queries.map((q) => q.text)).toEqual([
      'SELECT set_config($1, $2, true)',
      "SELECT * FROM relationships WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY created_at ASC",
      // the edge query keeps its original multi-line SQL verbatim
      `SELECT e.* FROM edges e\n          WHERE e.tenant_id = $1\n            AND e.relationship_id = $2\n            AND e.active = true`,
    ]);
    expect(h.queries[1].values).toEqual(['tenant-A', 'subj-1']);
    expect(h.queries[2].values).toEqual(['tenant-A', 'r1']);

    // ── identical returned view ──────────────────────────────────────────────
    expect(view.subjectId).toBe('subj-1');
    expect(view.tenantId).toBe('tenant-A');
    expect(view.members.map((m) => m.relationshipId)).toEqual(['r1']);
    expect(view.members[0].participantId).toBe('p1');
    expect(view.members[0].relationshipType).toBe('care_team');
    expect(view.sourceEdgeIds).toEqual(['e1']);
  });
});
