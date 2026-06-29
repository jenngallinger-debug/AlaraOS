/**
 * Alara OS — ObjectGraphRepository read methods after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves the 3 self-contained reads of the central `objects` / `external_references` tables are
 * behavior-preserving while RLS is inert: each opens exactly ONE tenant-scoped transaction, sets
 * `app.tenant_id` ONCE and FIRST, issues the SAME single SELECT (same tokens + exact params, incl.
 * the findByExternalReference JOIN), maps rows identically, and returns the correct null/array value.
 * The WRITE path (create/update/addExternalReference/createWithClient) is out of scope and untouched.
 * Mocked DatabaseClient (the helper's transaction + a SQL-routing client) → default suite.
 */

import { DatabaseClient } from '../src/shared/database';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';
import { ObjectGraphRepository } from '../src/object-graph/repository';

interface Captured { text: string; values?: unknown[] }

/** SQL-routing fake: one client records queries; rows returned by the table the SQL hits. */
function makeFakeDb(rows: { objects?: Record<string, unknown>[]; refs?: Record<string, unknown>[] }) {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/set_config/i.test(text)) return { rows: [{}] };
      if (/JOIN external_references/i.test(text)) return { rows: rows.objects ?? [] };  // findByExternalReference
      if (/FROM external_references/i.test(text)) return { rows: rows.refs ?? [] };      // getExternalReferences
      if (/FROM objects/i.test(text)) return { rows: rows.objects ?? [] };               // getById
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

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const T = 'tenant-A';
const TS = '2026-01-01T00:00:00Z';

const OBJECT_ROW = {
  id: 'o1', tenant_id: T, type: 'Patient', state: 'created', attributes: { x: 1 },
  version: 1, created_at: TS, updated_at: TS,
};
const REF_ROW = { system: 'Automynd', ext_type: 'patient_id', value: 'AM-1' };

function expectTenantScoped(h: ReturnType<typeof makeFakeDb>, sql: string, params: unknown[]) {
  expect(h.state.txnCount).toBe(1);
  expect(h.queries).toHaveLength(2);
  expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, T] });
  expect(norm(h.queries[1].text)).toBe(sql);
  expect(h.queries[1].values).toEqual(params);
}

describe('ObjectGraphRepository.getById (RLS-step-2, tenant-scoped)', () => {
  test('one txn, GUC first, byte-identical SELECT, maps the row', async () => {
    const h = makeFakeDb({ objects: [OBJECT_ROW] });
    const obj = await new ObjectGraphRepository(h.db).getById(T, 'o1' as AlaraId);

    expect(obj?.id).toBe('o1');
    expect(obj?.tenantId).toBe(T);
    expect(obj?.attributes).toEqual({ x: 1 });
    expectTenantScoped(h,
      'SELECT id, tenant_id, type, state, attributes, version, created_at, updated_at FROM objects WHERE id = $1 AND tenant_id = $2',
      ['o1', T]);
  });

  test('returns null when no row', async () => {
    const h = makeFakeDb({ objects: [] });
    expect(await new ObjectGraphRepository(h.db).getById(T, 'nope' as AlaraId)).toBeNull();
  });
});

describe('ObjectGraphRepository.getExternalReferences (RLS-step-2, tenant-scoped)', () => {
  test('one txn, GUC first, byte-identical SELECT, maps rows', async () => {
    const h = makeFakeDb({ refs: [REF_ROW] });
    const refs = await new ObjectGraphRepository(h.db).getExternalReferences(T, 'o1' as AlaraId);

    expect(refs).toEqual([{ system: 'Automynd', extType: 'patient_id', value: 'AM-1' }]);
    expectTenantScoped(h,
      'SELECT system, ext_type, value FROM external_references WHERE object_id = $1 AND tenant_id = $2',
      ['o1', T]);
  });

  test('returns empty array when no rows', async () => {
    const h = makeFakeDb({ refs: [] });
    expect(await new ObjectGraphRepository(h.db).getExternalReferences(T, 'o1' as AlaraId)).toEqual([]);
  });
});

describe('ObjectGraphRepository.findByExternalReference (RLS-step-2, tenant-scoped)', () => {
  test('one txn, GUC first, byte-identical JOIN SELECT, maps objects', async () => {
    const h = makeFakeDb({ objects: [OBJECT_ROW] });
    const objs = await new ObjectGraphRepository(h.db)
      .findByExternalReference(T, 'Automynd', 'patient_id', 'AM-1');

    expect(objs.map((o) => o.id)).toEqual(['o1']);
    expectTenantScoped(h,
      'SELECT o.id, o.tenant_id, o.type, o.state, o.attributes, o.version, o.created_at, o.updated_at FROM objects o JOIN external_references er ON er.object_id = o.id WHERE o.tenant_id = $1 AND er.system = $2 AND er.ext_type = $3 AND er.value = $4',
      [T, 'Automynd', 'patient_id', 'AM-1']);
  });

  test('returns empty array when no match', async () => {
    const h = makeFakeDb({ objects: [] });
    expect(await new ObjectGraphRepository(h.db)
      .findByExternalReference(T, 'Automynd', 'patient_id', 'none')).toEqual([]);
  });
});
