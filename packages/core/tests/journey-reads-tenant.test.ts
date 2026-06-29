/**
 * Alara OS — JourneyRepository read methods after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves each of the 7 read methods is behavior-preserving while RLS is inert: it opens exactly ONE
 * tenant-scoped transaction, sets `app.tenant_id` ONCE and FIRST, issues the SAME single SELECT (same
 * tokens + exact params — both branches of getReferences and getEvents, incl. the getEvents cursor
 * subquery), preserves ORDER BY and row mapping, and returns the correct null/array/scalar value.
 * Mocked DatabaseClient (the helper's transaction + a SQL-routing client) → default suite.
 */

import { DatabaseClient } from '../src/shared/database';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';
import { JourneyRepository } from '../src/journey-engine/repository';

interface Captured { text: string; values?: unknown[] }

/** SQL-routing fake: one client records every query; rows are returned by the table the SQL hits. */
function makeFakeDb(rows: {
  journeys?: Record<string, unknown>[];
  references?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  projections?: Record<string, unknown>[];
  tokens?: Record<string, unknown>[];
}) {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/set_config/i.test(text)) return { rows: [{}] };
      if (/FROM journey_references/i.test(text)) return { rows: rows.references ?? [] };
      if (/FROM journey_events/i.test(text)) return { rows: rows.events ?? [] };
      if (/FROM journey_projections/i.test(text)) return { rows: rows.projections ?? [] };
      if (/FROM journey_capability_tokens/i.test(text)) return { rows: rows.tokens ?? [] };
      if (/FROM journeys/i.test(text)) return { rows: rows.journeys ?? [] };
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

const JOURNEY_ROW = {
  id: 'j1', tenant_id: T, intent: null, intent_inferred_at: null, lifecycle: 'arrival',
  lifecycle_changed_at: TS, coordination_state: {}, identity_resolved: false,
  merged_from: [], split_from: null, created_at: TS, updated_at: TS,
};
const REF_ROW = {
  id: 'ref1', journey_id: 'j1', tenant_id: T, kind: 'person', ref_id: 'p1', role: 'subject',
  linked_at: TS, linked_by: null, meta: {},
};
const EVENT_ROW = {
  id: 'e1', journey_id: 'j1', tenant_id: T, event_type: 'JourneyStarted', payload: {},
  ref_kind: null, ref_id: null, occurred_at: TS, caused_by: null,
};
const PROJ_ROW = {
  journey_id: 'j1', tenant_id: T, projection_type: 'journey_state', lifecycle: 'arrival',
  intent: null, obstacle: null, actor: null, work_summary: [], next_step: null, human_handoff: null,
  last_event_id: null, projected_at: TS,
};

interface Case {
  name: string;
  run: (r: JourneyRepository) => Promise<unknown>;
  rows: Parameters<typeof makeFakeDb>[0];
  sql: string;
  params: unknown[];
}

// One row of the right shape so mapping runs; SQL + params asserted byte-for-byte (normalized).
const CASES: Case[] = [
  {
    name: 'findById',
    run: (r) => r.findById('j1' as AlaraId, T),
    rows: { journeys: [JOURNEY_ROW] },
    sql: 'SELECT * FROM journeys WHERE id = $1 AND tenant_id = $2',
    params: ['j1', T],
  },
  {
    name: 'listByLifecycle (default limit 100)',
    run: (r) => r.listByLifecycle('arrival', T),
    rows: { journeys: [JOURNEY_ROW] },
    sql: 'SELECT * FROM journeys WHERE lifecycle=$1 AND tenant_id=$2 ORDER BY created_at LIMIT $3',
    params: ['arrival', T, 100],
  },
  {
    name: 'getReferences (kind branch)',
    run: (r) => r.getReferences('j1' as AlaraId, T, 'person'),
    rows: { references: [REF_ROW] },
    sql: 'SELECT * FROM journey_references WHERE journey_id=$1 AND tenant_id=$2 AND kind=$3 ORDER BY linked_at',
    params: ['j1', T, 'person'],
  },
  {
    name: 'getReferences (no-kind branch)',
    run: (r) => r.getReferences('j1' as AlaraId, T),
    rows: { references: [REF_ROW] },
    sql: 'SELECT * FROM journey_references WHERE journey_id=$1 AND tenant_id=$2 ORDER BY linked_at',
    params: ['j1', T],
  },
  {
    name: 'findJourneysReferencing',
    run: (r) => r.findJourneysReferencing('person', 'p1' as AlaraId, T),
    rows: { references: [{ journey_id: 'j1' }] },
    sql: 'SELECT journey_id FROM journey_references WHERE kind=$1 AND ref_id=$2 AND tenant_id=$3 ORDER BY linked_at',
    params: ['person', 'p1', T],
  },
  {
    name: 'getEvents (afterId branch — cursor subquery preserved)',
    run: (r) => r.getEvents('j1' as AlaraId, T, 'e0'),
    rows: { events: [EVENT_ROW] },
    sql: 'SELECT * FROM journey_events WHERE journey_id=$1 AND tenant_id=$2 AND occurred_at > (SELECT occurred_at FROM journey_events WHERE id=$3) ORDER BY occurred_at, id',
    params: ['j1', T, 'e0'],
  },
  {
    name: 'getEvents (no-afterId branch)',
    run: (r) => r.getEvents('j1' as AlaraId, T),
    rows: { events: [EVENT_ROW] },
    sql: 'SELECT * FROM journey_events WHERE journey_id=$1 AND tenant_id=$2 ORDER BY occurred_at, id',
    params: ['j1', T],
  },
  {
    name: 'getProjection',
    run: (r) => r.getProjection('j1' as AlaraId, T),
    rows: { projections: [PROJ_ROW] },
    sql: 'SELECT * FROM journey_projections WHERE journey_id=$1 AND tenant_id=$2',
    params: ['j1', T],
  },
];

describe('JourneyRepository reads (RLS-step-2, per-method tenant transaction)', () => {
  test.each(CASES)('$name: one txn, GUC once & first, byte-identical SQL/params', async (c) => {
    const h = makeFakeDb(c.rows);
    await c.run(new JourneyRepository(h.db));

    expect(h.state.txnCount).toBe(1);                              // exactly one transaction
    expect(h.queries).toHaveLength(2);                             // GUC + the single SELECT (one branch)
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, T] });
    expect(norm(h.queries[1].text)).toBe(c.sql);
    expect(h.queries[1].values).toEqual(c.params);
  });

  // resolveToken: $3 is a per-call `new Date().toISOString()` — assert head params + ISO-string tail.
  test('resolveToken: one txn, GUC first, byte-identical SQL, dynamic ISO timestamp in $3', async () => {
    const h = makeFakeDb({ tokens: [{ journey_id: 'j1' }] });
    const res = await new JourneyRepository(h.db).resolveToken('tok1', T);

    expect(String(res)).toBe('j1');
    expect(h.state.txnCount).toBe(1);
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, T] });
    expect(norm(h.queries[1].text)).toBe(
      'SELECT journey_id FROM journey_capability_tokens WHERE token=$1 AND tenant_id=$2 AND revoked=false AND (expires_at IS NULL OR expires_at > $3)',
    );
    const vals = h.queries[1].values as unknown[];
    expect(vals.slice(0, 2)).toEqual(['tok1', T]);
    expect(typeof vals[2]).toBe('string');
    expect(new Date(vals[2] as string).toISOString()).toBe(vals[2]);   // valid ISO timestamp
  });

  // ── return-shape preservation: mapping, null, array/scalar ──────────────────────────────────
  test('findById maps the row; returns null when absent', async () => {
    expect((await new JourneyRepository(makeFakeDb({ journeys: [JOURNEY_ROW] }).db)
      .findById('j1' as AlaraId, T))?.id).toBe('j1');
    expect(await new JourneyRepository(makeFakeDb({ journeys: [] }).db)
      .findById('nope' as AlaraId, T)).toBeNull();
  });

  test('getProjection maps the row; returns null when absent', async () => {
    expect((await new JourneyRepository(makeFakeDb({ projections: [PROJ_ROW] }).db)
      .getProjection('j1' as AlaraId, T))?.journeyId).toBe('j1');
    expect(await new JourneyRepository(makeFakeDb({ projections: [] }).db)
      .getProjection('j1' as AlaraId, T)).toBeNull();
  });

  test('list/array reads return mapped arrays (and empty arrays when no rows)', async () => {
    expect((await new JourneyRepository(makeFakeDb({ journeys: [JOURNEY_ROW] }).db)
      .listByLifecycle('arrival', T)).map((j) => j.id)).toEqual(['j1']);
    expect((await new JourneyRepository(makeFakeDb({ references: [REF_ROW] }).db)
      .getReferences('j1' as AlaraId, T)).map((x) => x.id)).toEqual(['ref1']);
    expect((await new JourneyRepository(makeFakeDb({ references: [{ journey_id: 'j1' }] }).db)
      .findJourneysReferencing('person', 'p1' as AlaraId, T)).map(String)).toEqual(['j1']);
    expect((await new JourneyRepository(makeFakeDb({ events: [EVENT_ROW] }).db)
      .getEvents('j1' as AlaraId, T)).map((e) => e.id)).toEqual(['e1']);
    expect(await new JourneyRepository(makeFakeDb({ events: [] }).db)
      .getEvents('j1' as AlaraId, T)).toEqual([]);
  });

  test('resolveToken returns null when no row matches', async () => {
    expect(await new JourneyRepository(makeFakeDb({ tokens: [] }).db).resolveToken('tok1', T)).toBeNull();
  });
});
