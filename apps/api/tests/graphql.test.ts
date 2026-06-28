/**
 * Alara OS API — GraphQL Tests
 *
 * Acceptance criteria:
 *   AC-5: GraphQL timeline returns rebuilt timeline.
 *   AC-6: GraphQL Digital Care Twin returns ADR-001-compliant projection.
 *   AC-7: GraphQL does not mutate state.
 */

import { FastifyInstance } from 'fastify';
import { buildTestApp, validReferral, TENANT, REFERRAL_ACTOR, SYSTEM_ACTOR } from './helpers';

let app: FastifyInstance;
let store: ReturnType<typeof buildTestApp>['store'];

beforeEach(async () => {
  const testApp = buildTestApp();
  store = testApp.store;
  app = await testApp.buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ query, variables }),
  });
  return res.json();
}

// Helper: run the full vertical slice first so projections exist
async function seedReferral() {
  const res = await app.inject({
    method: 'POST',
    url: '/commands/referrals',
    headers: { 'x-actor-id': REFERRAL_ACTOR }, // mutating command now requires auth
    payload: validReferral,
  });
  return res.json();
}

// ─── GraphQL read-surface gate (auth + availability) ──────────────────────────

describe('GraphQL read-surface gate', () => {
  const INTROSPECTION = '{ __schema { queryType { name } } }';

  // Save/restore the gate env so toggling does not leak across tests.
  let prevAuth: string | undefined;
  let prevEnabled: string | undefined;
  beforeEach(() => {
    prevAuth = process.env.GRAPHQL_REQUIRE_AUTH;
    prevEnabled = process.env.GRAPHQL_ENABLED;
  });
  afterEach(() => {
    if (prevAuth === undefined) delete process.env.GRAPHQL_REQUIRE_AUTH; else process.env.GRAPHQL_REQUIRE_AUTH = prevAuth;
    if (prevEnabled === undefined) delete process.env.GRAPHQL_ENABLED; else process.env.GRAPHQL_ENABLED = prevEnabled;
  });

  function rawGql(query: string, actor?: string | null) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (actor) headers['x-actor-id'] = actor;
    return app.inject({ method: 'POST', url: '/graphql', headers, payload: JSON.stringify({ query }) });
  }

  test('default under NODE_ENV=test → auth NOT required, query succeeds without x-actor-id', async () => {
    delete process.env.GRAPHQL_REQUIRE_AUTH; // default path (relaxed in test)
    const res = await rawGql(INTROSPECTION);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.__schema.queryType.name).toBe('Query');
  });

  test('auth required (explicit) + no actor → 401, Mercurius never reached', async () => {
    process.env.GRAPHQL_REQUIRE_AUTH = 'true';
    const res = await rawGql(INTROSPECTION); // no x-actor-id
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toMatch(/x-actor-id/);
  });

  test('auth required (explicit) + valid actor → 200, query succeeds', async () => {
    process.env.GRAPHQL_REQUIRE_AUTH = 'true';
    const res = await rawGql(INTROSPECTION, SYSTEM_ACTOR);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.__schema.queryType.name).toBe('Query');
  });

  test('disabled (GRAPHQL_ENABLED=false) → surface not mounted, 404', async () => {
    process.env.GRAPHQL_ENABLED = 'false';
    // Availability is read at build time, so build a fresh app under the disabled flag.
    const disabled = buildTestApp();
    const disabledApp = await disabled.buildApp();
    await disabledApp.ready();
    try {
      const res = await disabledApp.inject({
        method: 'POST', url: '/graphql',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ query: INTROSPECTION }),
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await disabledApp.close();
    }
  });
});

// ─── AC-5: Timeline projection via GraphQL ────────────────────────────────────

describe('GraphQL timeline query (AC-5)', () => {
  test('Returns timeline with entries after referral slice', async () => {
    const referralResult = await seedReferral();
    const patientId = referralResult.patientId;

    const result = await gql(`
      query Timeline($tenantId: String!, $subjectId: ID!) {
        timeline(tenantId: $tenantId, subjectId: $subjectId) {
          subjectId
          eventCount
          methodVersion
          confidence
          lastBuiltAt
          buildNumber
          entries {
            eventId
            eventType
            actor
            summary
          }
        }
      }
    `, { tenantId: TENANT, subjectId: patientId });

    expect(result.errors).toBeUndefined();
    const timeline = result.data.timeline;
    expect(timeline).not.toBeNull();
    expect(timeline.subjectId).toBe(patientId);
    expect(timeline.eventCount).toBeGreaterThan(0);
    expect(timeline.methodVersion).toBe('1.0.0');
    expect(timeline.confidence).toBe('high');
    expect(timeline.entries.length).toBeGreaterThan(0);
    expect(timeline.entries.some((e: { eventType: string }) => e.eventType === 'ObjectCreated')).toBe(true);
  });

  test('Returns null for unknown subject', async () => {
    const result = await gql(`
      query { timeline(tenantId: "${TENANT}", subjectId: "00000000-0000-4000-8000-999999999999") {
        eventCount
      } }
    `);
    expect(result.errors).toBeUndefined();
    expect(result.data.timeline).toBeNull();
  });
});

// ─── AC-6: Digital Care Twin via GraphQL ──────────────────────────────────────

describe('GraphQL Digital Care Twin (AC-6)', () => {
  test('Returns projection with disclaimer and no clinical content', async () => {
    const referralResult = await seedReferral();
    const patientId = referralResult.patientId;

    const result = await gql(`
      query Twin($tenantId: String!, $patientId: ID!) {
        digitalCareTwin(tenantId: $tenantId, patientId: $patientId) {
          patientId
          disclaimer
          methodVersion
          confidence
          aiInvolved
          patientAttributes
          externalReferences { system extType value }
          activeWorkflows { workflowId status }
          openTasks { taskType ownerId }
          openPromises { description }
          timelineSummary { eventCount }
        }
      }
    `, { tenantId: TENANT, patientId });

    expect(result.errors).toBeUndefined();
    const twin = result.data.digitalCareTwin;
    expect(twin).not.toBeNull();
    expect(twin.patientId).toBe(patientId);
    expect(twin.disclaimer).toBe('computed-projection-advisory-only');
    expect(twin.aiInvolved).toBe(false);
    expect(twin.patientAttributes.name).toBe('Samuel Brown');

    // ADR-001: no clinical content
    expect(twin.patientAttributes.visitNotes).toBeUndefined();
    expect(twin.patientAttributes.assessmentText).toBeUndefined();
    expect(twin.patientAttributes.planOfCare).toBeUndefined();

    // Operational context is present
    expect(twin.externalReferences).toHaveLength(1);
    expect(twin.externalReferences[0].system).toBe('Automynd');
    expect(twin.activeWorkflows).toHaveLength(1);
    expect(twin.openTasks).toHaveLength(1);
    expect(twin.openPromises).toHaveLength(1);
    expect(twin.timelineSummary.eventCount).toBeGreaterThan(0);
  });
});

// ─── AC-7: GraphQL does not mutate state ─────────────────────────────────────

describe('GraphQL does not mutate state (AC-7)', () => {
  test('Schema has no Mutation type', async () => {
    const result = await gql(`
      { __schema { mutationType { name } } }
    `);
    expect(result.errors).toBeUndefined();
    expect(result.data.__schema.mutationType).toBeNull();
  });

  test('Querying timeline does not change event count', async () => {
    await seedReferral();
    const eventCountBefore = store.events.length;

    // Multiple timeline queries
    await gql(`{ timeline(tenantId: "${TENANT}", subjectId: "00000000-0000-4000-8000-000000000001") { eventCount } }`);
    await gql(`{ timeline(tenantId: "${TENANT}", subjectId: "00000000-0000-4000-8000-000000000001") { eventCount } }`);

    // ProjectionRebuilt events may be emitted by the projection engine on rebuild
    // but no canonical object/workflow/task/promise events should appear
    const newEvents = store.events.slice(eventCountBefore);
    const canonicalMutations = newEvents.filter(e =>
      ['ObjectCreated', 'ObjectUpdated', 'WorkflowStarted', 'TaskCreated', 'PromiseCreated'].includes(e.type)
    );
    expect(canonicalMutations).toHaveLength(0);
  });

  test('Querying Digital Care Twin does not mutate object store', async () => {
    const referralResult = await seedReferral();
    const objectsBefore = store.objects.size;

    await gql(`{
      digitalCareTwin(tenantId: "${TENANT}", patientId: "${referralResult.patientId}") {
        patientId disclaimer
      }
    }`);

    expect(store.objects.size).toBe(objectsBefore);
  });

  test('object query is read-only', async () => {
    const referralResult = await seedReferral();
    const patientId = referralResult.patientId;

    const result = await gql(`
      query { object(tenantId: "${TENANT}", id: "${patientId}") {
        id type state version
        attributes
        externalReferences { system extType value }
      }}
    `);

    expect(result.errors).toBeUndefined();
    const obj = result.data.object;
    expect(obj.type).toBe('Patient');
    expect(obj.state).toBe('created');

    // Verify no state change after read
    const storedObj = store.objects.get(patientId);
    expect(storedObj!.version).toBe(obj.version);
  });
});
