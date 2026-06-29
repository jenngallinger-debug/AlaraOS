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
import { ProjectionType, StoredProjection } from '../src/projection-engine/types';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';

interface Captured { text: string; values?: unknown[] }

/** Fake DB whose `transaction` runs fn with a client that records queries and returns canned rows. */
function makeFakeDb(projectionRows: Record<string, unknown>[]) {
  const queries: Captured[] = [];
  const state = { began: false, committed: false, txnCount: 0 };
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
      state.txnCount += 1;
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

// ── RLS step 2 first WRITE adopter (Slice 37): save + delete ──────────────────────────────────

// Byte-identical SQL the store issues (whitespace verbatim from store.ts — any drift fails the test).
const EXPECTED_INSERT_SQL =
`INSERT INTO projections
         (id, tenant_id, projection_type, subject_id, method_name, method_version,
          canonical_inputs, source_event_ids, confidence, inference_basis, ai_involved,
          fresh_until, last_built_at, build_number, value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, projection_type, subject_id)
       DO UPDATE SET
         method_version   = EXCLUDED.method_version,
         canonical_inputs = EXCLUDED.canonical_inputs,
         source_event_ids = EXCLUDED.source_event_ids,
         confidence       = EXCLUDED.confidence,
         inference_basis  = EXCLUDED.inference_basis,
         ai_involved      = EXCLUDED.ai_involved,
         fresh_until      = EXCLUDED.fresh_until,
         last_built_at    = EXCLUDED.last_built_at,
         build_number     = EXCLUDED.build_number,
         value            = EXCLUDED.value,
         updated_at       = NOW()`;
const EXPECTED_DELETE_SQL =
  'DELETE FROM projections WHERE tenant_id=$1 AND projection_type=$2 AND subject_id=$3';

const PROJECTION: StoredProjection = {
  id: 'p1' as AlaraId,
  metadata: {
    projectionType: 'Timeline' as ProjectionType,
    subjectId: 'subj-1',
    tenantId: 'tenant-A',
    canonicalInputs: [],
    methodName: 'm',
    methodVersion: '1.0.0',
    freshUntil: null,
    sourceEventIds: ['e1'],
    confidence: 'high',
    inferenceBasis: 'fact',
    aiInvolved: false,
    lastBuiltAt: '2026-01-01',
    buildNumber: 1,
  },
  value: { x: 1 },
};

// The 15 INSERT params in column order (JSONB columns are JSON.stringify'd before binding).
const EXPECTED_SAVE_PARAMS = [
  'p1', 'tenant-A', 'Timeline', 'subj-1', 'm', '1.0.0',
  '[]', '["e1"]', 'high', 'fact', false,
  null, '2026-01-01', 1, '{"x":1}',
];

describe('DatabaseProjectionStore.save (RLS-step-2 first write adopter, tenant-scoped)', () => {
  test('one transaction, GUC set once and first (GUC = the row tenant), byte-identical INSERT + params, void return', async () => {
    const h = makeFakeDb([]);
    const store = new DatabaseProjectionStore(h.db);
    const ret = await store.save(PROJECTION);

    expect(ret).toBeUndefined();                                  // void return preserved
    expect(h.state.txnCount).toBe(1);                             // exactly one transaction
    expect(h.state.committed).toBe(true);
    const gucSets = h.queries.filter((q) => /set_config/i.test(q.text));
    expect(gucSets).toHaveLength(1);                              // GUC set exactly once
    // GUC first, parameterized, equal to the row's own tenant (m.tenantId) → forward-compatible with WITH CHECK.
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, 'tenant-A'] });
    // Byte-identical INSERT ... ON CONFLICT (incl. updated_at = NOW()) and exact params.
    expect(h.queries[1].text).toBe(EXPECTED_INSERT_SQL);
    expect(h.queries[1].values).toEqual(EXPECTED_SAVE_PARAMS);
  });

  test('absent projection.id falls back to a generated id in param $1; all other params unchanged', async () => {
    const h = makeFakeDb([]);
    const store = new DatabaseProjectionStore(h.db);
    const { id: _omit, ...rest } = PROJECTION;
    await store.save(rest as StoredProjection);

    const params = h.queries[1].values as unknown[];
    expect(typeof params[0]).toBe('string');
    expect((params[0] as string).length).toBeGreaterThan(0);     // newAlaraId() used for $1
    expect(params.slice(1)).toEqual(EXPECTED_SAVE_PARAMS.slice(1));
  });
});

describe('DatabaseProjectionStore.delete (RLS-step-2 first write adopter, tenant-scoped)', () => {
  test('one transaction, GUC set once and first, byte-identical DELETE + params, void return', async () => {
    const h = makeFakeDb([]);
    const store = new DatabaseProjectionStore(h.db);
    const ret = await store.delete('tenant-A', 'Timeline' as ProjectionType, 'subj-1');

    expect(ret).toBeUndefined();
    expect(h.state.txnCount).toBe(1);
    const gucSets = h.queries.filter((q) => /set_config/i.test(q.text));
    expect(gucSets).toHaveLength(1);
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, 'tenant-A'] });
    expect(h.queries[1].text).toBe(EXPECTED_DELETE_SQL);
    expect(h.queries[1].values).toEqual(['tenant-A', 'Timeline', 'subj-1']);
  });
});
