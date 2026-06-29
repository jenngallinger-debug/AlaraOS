/**
 * Alara OS — DatabaseProjectionStore read methods after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves the migrated `get` / `listForSubject` are behavior-preserving while RLS is inert: same
 * tenant-filtered SELECT, same row→projection mapping, same null/array returns — now wrapped in a
 * tenant-scoped transaction that sets `app.tenant_id` first. Uses a mocked DatabaseClient (the
 * helper's transaction + client), so it runs in the default suite. Writes (save/delete) are untouched.
 */

import { DatabaseProjectionStore } from '../src/projection-engine/store';
import { DatabaseClient } from '../src/shared/database';
import { ProjectionType } from '../src/projection-engine/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';

interface Captured { text: string; values?: unknown[] }

/** Fake DB whose `transaction` runs fn with a client that records queries and returns canned rows. */
function makeFakeDb(projectionRows: Record<string, unknown>[]) {
  const queries: Captured[] = [];
  const state = { began: false, committed: false };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/set_config/i.test(text)) return { rows: [{}] };
      if (/FROM projections/i.test(text)) return { rows: projectionRows };
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
      state.began = true;
      const r = await fn(client as never);
      state.committed = true;
      return r;
    },
  } as unknown as DatabaseClient;
  return { db, queries, state };
}

const SAMPLE = {
  id: 'p1', tenant_id: 'tenant-A', projection_type: 'Timeline', subject_id: 'subj-1',
  method_name: 'm', method_version: '1.0.0', canonical_inputs: [], source_event_ids: ['e1'],
  confidence: 'high', inference_basis: 'b', ai_involved: false, fresh_until: null,
  last_built_at: '2026-01-01', build_number: 1, value: { x: 1 },
};

describe('DatabaseProjectionStore.get (RLS-step-2, tenant-scoped)', () => {
  test('sets app.tenant_id first (parameterized, in a transaction), then the unchanged SELECT, and maps the row', async () => {
    const h = makeFakeDb([SAMPLE]);
    const store = new DatabaseProjectionStore(h.db);
    const res = await store.get('tenant-A', 'Timeline' as ProjectionType, 'subj-1');

    expect(res).not.toBeNull();
    expect(res!.metadata.tenantId).toBe('tenant-A');
    expect(res!.metadata.subjectId).toBe('subj-1');
    expect(res!.metadata.projectionType).toBe('Timeline');
    expect(res!.value).toEqual({ x: 1 });
    expect(h.state.committed).toBe(true);

    // GUC set first (parameterized), then the byte-identical tenant-filtered SELECT.
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, 'tenant-A'] });
    expect(h.queries[1].text).toBe('SELECT * FROM projections WHERE tenant_id=$1 AND projection_type=$2 AND subject_id=$3');
    expect(h.queries[1].values).toEqual(['tenant-A', 'Timeline', 'subj-1']);
  });

  test('returns null when no row matches', async () => {
    const h = makeFakeDb([]);
    const store = new DatabaseProjectionStore(h.db);
    expect(await store.get('tenant-A', 'Timeline' as ProjectionType, 'nope')).toBeNull();
  });
});

describe('DatabaseProjectionStore.listForSubject (RLS-step-2, tenant-scoped)', () => {
  test('sets the GUC first, then the unchanged SELECT, and maps all rows', async () => {
    const h = makeFakeDb([SAMPLE, { ...SAMPLE, id: 'p2' }]);
    const store = new DatabaseProjectionStore(h.db);
    const res = await store.listForSubject('tenant-A', 'subj-1');

    expect(res).toHaveLength(2);
    expect(res[0].metadata.tenantId).toBe('tenant-A');
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, 'tenant-A'] });
    expect(h.queries[1].text).toBe('SELECT * FROM projections WHERE tenant_id=$1 AND subject_id=$2');
    expect(h.queries[1].values).toEqual(['tenant-A', 'subj-1']);
  });
});
