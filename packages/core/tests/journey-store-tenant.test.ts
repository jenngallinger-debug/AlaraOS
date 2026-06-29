/**
 * Alara OS — JourneyRepository write methods after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves each of the 11 write methods is behavior-preserving while RLS is inert: it opens exactly ONE
 * tenant-scoped transaction, sets `app.tenant_id` ONCE and FIRST (= the row's own tenant), issues the
 * SAME single statement (same SQL tokens + exact params — including JSON.stringify'd JSONB columns vs
 * the RAW `merged_from` array), and returns void. Mocked DatabaseClient (the helper's transaction +
 * client) → default suite. Reads are out of this slice's scope and are not exercised here.
 */

import { DatabaseClient } from '../src/shared/database';
import { AlaraId } from '../src/shared/types';
import { TENANT_GUC } from '../src/shared/tenant-scope';
import { JourneyRepository } from '../src/journey-engine/repository';
import {
  Journey, JourneyEvent, JourneyProjection, JourneyReference,
} from '../src/journey-engine/types';

interface Captured { text: string; values?: unknown[] }

/** Fake DB: `transaction` runs fn with a single client recording queries; non-GUC queries return []. */
function makeFakeDb() {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
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

/** Collapse insignificant whitespace so SQL is compared by tokens (whitespace is irrelevant to PG). */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const NOW = new Date('2026-06-28T00:00:00.000Z');
const ISO = '2026-06-28T00:00:00.000Z';
const T = 'tenant-A';

const JOURNEY: Journey = {
  id: 'j1' as AlaraId, tenantId: T, intent: null, intentInferredAt: null,
  lifecycle: 'arrival', lifecycleChangedAt: NOW, coordinationState: { a: 1 },
  identityResolved: false, mergedFrom: ['m1', 'm2'] as AlaraId[], splitFrom: null,
  createdAt: NOW, updatedAt: NOW,
};
const REF: JourneyReference = {
  id: 'ref1' as AlaraId, journeyId: 'j1' as AlaraId, tenantId: T, kind: 'person',
  refId: 'p1' as AlaraId, role: 'subject', linkedAt: NOW, linkedBy: null, meta: { k: 'v' },
};
const EVT: JourneyEvent = {
  id: 'e1', journeyId: 'j1' as AlaraId, tenantId: T, eventType: 'JourneyStarted',
  payload: { p: 1 }, refKind: null, refId: null, occurredAt: NOW, causedBy: null,
};
const PROJ: JourneyProjection = {
  PROJECTION_TYPE: 'journey_state', journeyId: 'j1' as AlaraId, tenantId: T,
  lifecycle: 'arrival', intent: null, obstacle: null, actor: null,
  workSummary: [], nextStep: null, humanHandoff: null, lastEventId: null, projectedAt: NOW,
};

interface Case {
  name: string;
  run: (repo: JourneyRepository) => Promise<void>;
  sql: string;
  params: unknown[];
}

const CASES: Case[] = [
  {
    name: 'insert (journeys)',
    run: (r) => r.insert(JOURNEY),
    sql: 'INSERT INTO journeys (id, tenant_id, intent, intent_inferred_at, lifecycle, lifecycle_changed_at, coordination_state, identity_resolved, merged_from, split_from, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    // coordination_state JSON.stringify'd; merged_from passed as a RAW array (NOT stringified).
    params: ['j1', T, null, null, 'arrival', ISO, '{"a":1}', false, ['m1', 'm2'], null, ISO, ISO],
  },
  {
    name: 'updateLifecycle',
    run: (r) => r.updateLifecycle('j1' as AlaraId, T, 'working', NOW),
    sql: 'UPDATE journeys SET lifecycle=$1, lifecycle_changed_at=$2, updated_at=$3 WHERE id=$4 AND tenant_id=$5',
    params: ['working', ISO, ISO, 'j1', T],
  },
  {
    name: 'updateIntent',
    run: (r) => r.updateIntent('j1' as AlaraId, T, 'help', NOW),
    sql: 'UPDATE journeys SET intent=$1, intent_inferred_at=$2, updated_at=$3 WHERE id=$4 AND tenant_id=$5',
    params: ['help', ISO, ISO, 'j1', T],
  },
  {
    name: 'updateCoordinationState',
    run: (r) => r.updateCoordinationState('j1' as AlaraId, T, { a: 1 }, NOW),
    sql: 'UPDATE journeys SET coordination_state=$1, updated_at=$2 WHERE id=$3 AND tenant_id=$4',
    params: ['{"a":1}', ISO, 'j1', T],   // coordination_state JSON.stringify'd
  },
  {
    name: 'updateMergedFrom',
    run: (r) => r.updateMergedFrom('j1' as AlaraId, T, ['m1', 'm2'] as AlaraId[], NOW),
    sql: 'UPDATE journeys SET merged_from=$1, updated_at=$2 WHERE id=$3 AND tenant_id=$4',
    params: [['m1', 'm2'], ISO, 'j1', T],   // merged_from passed as a RAW array (NOT stringified)
  },
  {
    name: 'markIdentityResolved',
    run: (r) => r.markIdentityResolved('j1' as AlaraId, T, NOW),
    sql: 'UPDATE journeys SET identity_resolved=true, updated_at=$1 WHERE id=$2 AND tenant_id=$3',
    params: [ISO, 'j1', T],
  },
  {
    name: 'insertReference (ON CONFLICT DO NOTHING)',
    run: (r) => r.insertReference(REF),
    sql: 'INSERT INTO journey_references (id, tenant_id, journey_id, kind, ref_id, role, linked_at, linked_by, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id, journey_id, kind, ref_id) DO NOTHING',
    params: ['ref1', T, 'j1', 'person', 'p1', 'subject', ISO, null, '{"k":"v"}'],   // meta JSON.stringify'd
  },
  {
    name: 'appendEvent (journey_events)',
    run: (r) => r.appendEvent(EVT),
    sql: 'INSERT INTO journey_events (id, tenant_id, journey_id, event_type, payload, ref_kind, ref_id, occurred_at, caused_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    params: ['e1', T, 'j1', 'JourneyStarted', '{"p":1}', null, null, ISO, null],   // payload JSON.stringify'd
  },
  {
    name: 'upsertProjection (ON CONFLICT (journey_id) DO UPDATE)',
    run: (r) => r.upsertProjection(PROJ),
    sql: "INSERT INTO journey_projections (journey_id, tenant_id, projection_type, lifecycle, intent, obstacle, actor, work_summary, next_step, human_handoff, last_event_id, projected_at) VALUES ($1,$2,'journey_state',$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (journey_id) DO UPDATE SET lifecycle=$3, intent=$4, obstacle=$5, actor=$6, work_summary=$7, next_step=$8, human_handoff=$9, last_event_id=$10, projected_at=$11",
    // work_summary JSON.stringify'd ('[]'); null next_step/human_handoff stay null (not 'null').
    params: ['j1', T, 'arrival', null, null, null, '[]', null, null, null, ISO],
  },
  {
    name: 'storeToken (journey_capability_tokens)',
    run: (r) => r.storeToken('tok1', 'j1' as AlaraId, T, null, NOW),
    sql: 'INSERT INTO journey_capability_tokens (token, journey_id, tenant_id, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5)',
    params: ['tok1', 'j1', T, ISO, null],
  },
  {
    name: 'revokeToken',
    run: (r) => r.revokeToken('tok1', T, NOW),
    sql: 'UPDATE journey_capability_tokens SET revoked=true, revoked_at=$1 WHERE token=$2 AND tenant_id=$3',
    params: [ISO, 'tok1', T],
  },
];

describe('JourneyRepository writes (RLS-step-2, per-method tenant transaction)', () => {
  test('exactly 11 write cases under test', () => {
    expect(CASES).toHaveLength(11);
  });

  test.each(CASES)('$name: one txn, GUC once & first, byte-identical SQL/params, void return', async (c) => {
    const h = makeFakeDb();
    const repo = new JourneyRepository(h.db);
    const ret = await c.run(repo);

    expect(ret).toBeUndefined();                                   // void return preserved
    expect(h.state.txnCount).toBe(1);                              // exactly one transaction
    expect(h.queries).toHaveLength(2);                             // GUC + a single write statement
    // GUC set first, parameterized, = the row's own tenant (forward-compatible with WITH CHECK).
    expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, T] });
    // The write statement: same SQL tokens and exact params (JSONB stringify vs raw array preserved).
    expect(norm(h.queries[1].text)).toBe(c.sql);
    expect(h.queries[1].values).toEqual(c.params);
  });
});
