/**
 * Alara OS — EventStore reads + standalone append after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves behavior-preserving tenant-scoping while RLS is inert:
 *  - reads (loadStream, loadAll both branches, countInStream) each open ONE tenant-scoped transaction,
 *    set `app.tenant_id` ONCE and FIRST, issue the SAME SELECT (same tokens + params), and map correctly.
 *  - the STANDALONE append path opens ONE tenant-scoped transaction and runs all four statements
 *    (advisory lock → idempotency → seq → INSERT) on the SAME client; idempotency on an existing id
 *    short-circuits before seq/INSERT.
 *  - the CLIENT-PROVIDED append path opens NO transaction and sets NO GUC (runs on the caller's client).
 * Mocked DatabaseClient (the helper's transaction + a SQL-routing client) → default suite.
 */

import { DatabaseClient } from '../src/shared/database';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';
import { EventStore } from '../src/events/store';
import { EventType } from '../src/events/types';

interface Captured { text: string; values?: unknown[] }

const EVENT_ROW = {
  id: 'e1', tenant_id: 'tenant-A', stream_id: 's1', seq: 1, type: 'ObjectCreated',
  payload: {}, actor: 'system', occurred_at: '2026-01-01T00:00:00Z',
  causation_id: null, correlation_id: null,
};

/** SQL-routing fake. `transaction` runs fn with a single recording client; `client` is also exposed. */
function makeFakeDb(opts: { idempotency?: Record<string, unknown>[]; events?: Record<string, unknown>[]; count?: number } = {}) {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (/set_config/i.test(text)) return { rows: [{}] };
      if (/pg_advisory_xact_lock/i.test(text)) return { rows: [{}] };
      if (/SELECT \* FROM events WHERE id = \$1/i.test(text)) return { rows: opts.idempotency ?? [] };
      if (/COALESCE\(MAX\(seq\)/i.test(text)) return { rows: [{ next_seq: 1 }] };
      if (/INSERT INTO events/i.test(text)) return { rows: [EVENT_ROW] };
      if (/COUNT\(\*\)/i.test(text)) return { rows: [{ cnt: String(opts.count ?? 0) }] };
      if (/FROM events/i.test(text)) return { rows: opts.events ?? [] };
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
      state.txnCount += 1;
      return fn(client as never);
    },
  } as unknown as DatabaseClient;
  return { db, client, queries, state };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const T = 'tenant-A';

describe('EventStore reads (RLS-step-2, tenant-scoped)', () => {
  test('loadStream: one txn, GUC first, byte-identical SELECT + params, maps rows', async () => {
    const h = makeFakeDb({ events: [EVENT_ROW] });
    const evts = await new EventStore(h.db).loadStream(T, 's1' as AlaraId);

    expect(evts.map((e) => e.id)).toEqual(['e1']);
    expect(h.state.txnCount).toBe(1);
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, T] });
    expect(norm(h.queries[1].text)).toBe(
      'SELECT * FROM events WHERE stream_id = $1 AND tenant_id = $2 AND seq >= $3 ORDER BY seq ASC',
    );
    expect(h.queries[1].values).toEqual(['s1', T, 1]);
  });

  test('loadAll (no cursor): one txn, GUC first, byte-identical SELECT + params', async () => {
    const h = makeFakeDb({ events: [EVENT_ROW] });
    await new EventStore(h.db).loadAll(T);
    expect(h.state.txnCount).toBe(1);
    expect(h.queries[0].values).toEqual([TENANT_GUC, T]);
    expect(norm(h.queries[1].text)).toBe('SELECT * FROM events WHERE tenant_id = $1 ORDER BY occurred_at ASC, seq ASC');
    expect(h.queries[1].values).toEqual([T]);
  });

  test('loadAll (cursor branch): GUC first, byte-identical pivot JOIN SELECT + params', async () => {
    const h = makeFakeDb({ events: [EVENT_ROW] });
    await new EventStore(h.db).loadAll(T, 'e0');
    expect(h.state.txnCount).toBe(1);
    expect(norm(h.queries[1].text)).toBe(
      'SELECT e.* FROM events e JOIN events pivot ON pivot.id = $2 WHERE e.tenant_id = $1 AND e.occurred_at >= pivot.occurred_at AND e.id != $2 ORDER BY e.occurred_at ASC, e.seq ASC',
    );
    expect(h.queries[1].values).toEqual([T, 'e0']);
  });

  test('countInStream: one txn, GUC first, byte-identical SELECT, parses the count', async () => {
    const h = makeFakeDb({ count: 3 });
    const n = await new EventStore(h.db).countInStream(T, 's1' as AlaraId);
    expect(n).toBe(3);
    expect(h.state.txnCount).toBe(1);
    expect(h.queries[0].values).toEqual([TENANT_GUC, T]);
    expect(norm(h.queries[1].text)).toBe('SELECT COUNT(*) AS cnt FROM events WHERE stream_id = $1 AND tenant_id = $2');
    expect(h.queries[1].values).toEqual(['s1', T]);
  });

  test('countInStream: returns 0 when no row', async () => {
    const h = makeFakeDb({ count: 0 });
    expect(await new EventStore(h.db).countInStream(T, 's1' as AlaraId)).toBe(0);
  });
});

describe('EventStore.append — STANDALONE path (RLS-step-2, tenant-scoped)', () => {
  test('one txn, GUC first, all four statements on the same client, byte-identical SQL/params', async () => {
    const h = makeFakeDb({ idempotency: [] });   // no existing event → proceeds to seq + INSERT
    const evt = await new EventStore(h.db).append({
      tenantId: T, streamId: 's1' as AlaraId, type: 'ObjectCreated' as EventType,
      payload: {}, actor: 'system', eventId: 'e1',
    });

    expect(evt.id).toBe('e1');
    expect(h.state.txnCount).toBe(1);
    // GUC first, then advisory lock → idempotency → seq → INSERT, all recorded on the one client.
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, T] });
    expect(norm(h.queries[1].text)).toBe('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))');
    expect(h.queries[1].values).toEqual([T, 's1']);
    expect(norm(h.queries[2].text)).toBe('SELECT * FROM events WHERE id = $1');
    expect(h.queries[2].values).toEqual(['e1']);
    expect(norm(h.queries[3].text)).toBe('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM events WHERE stream_id = $1 AND tenant_id = $2');
    expect(h.queries[3].values).toEqual(['s1', T]);
    expect(norm(h.queries[4].text)).toBe(
      'INSERT INTO events (id, tenant_id, stream_id, seq, type, payload, actor, causation_id, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
    );
    expect(h.queries[4].values).toEqual(['e1', T, 's1', 1, 'ObjectCreated', '{}', 'system', null, null]);
  });

  test('idempotency: existing id short-circuits before seq/INSERT (still one txn, GUC first)', async () => {
    const h = makeFakeDb({ idempotency: [EVENT_ROW] });   // event already exists
    const evt = await new EventStore(h.db).append({
      tenantId: T, streamId: 's1' as AlaraId, type: 'ObjectCreated' as EventType,
      payload: {}, actor: 'system', eventId: 'e1',
    });

    expect(evt.id).toBe('e1');
    expect(h.state.txnCount).toBe(1);
    // set_config → advisory lock → idempotency SELECT, then returns — no seq, no INSERT.
    expect(h.queries.map((q) => norm(q.text))).toEqual([
      'SELECT set_config($1, $2, true)',
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      'SELECT * FROM events WHERE id = $1',
    ]);
  });
});

describe('EventStore.append — CLIENT-PROVIDED path (unchanged: no txn, no GUC)', () => {
  test('opens no transaction and sets no GUC; runs the four statements on the caller client', async () => {
    const h = makeFakeDb({ idempotency: [] });
    const evt = await new EventStore(h.db).append({
      tenantId: T, streamId: 's1' as AlaraId, type: 'ObjectCreated' as EventType,
      payload: {}, actor: 'system', eventId: 'e1', client: h.client as never,
    });

    expect(evt.id).toBe('e1');
    expect(h.state.txnCount).toBe(0);                                  // db.transaction NOT called
    expect(h.queries.some((q) => /set_config/i.test(q.text))).toBe(false);   // GUC NOT set here
    // The four statements ran directly on the caller's client, in order.
    expect(h.queries.map((q) => norm(q.text))).toEqual([
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      'SELECT * FROM events WHERE id = $1',
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM events WHERE stream_id = $1 AND tenant_id = $2',
      'INSERT INTO events (id, tenant_id, stream_id, seq, type, payload, actor, causation_id, correlation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
    ]);
  });
});
