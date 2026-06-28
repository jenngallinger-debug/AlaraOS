/**
 * Alara OS API — Consent capture/withdraw endpoint tests
 *
 * Proves the surface boundary end to end:
 *   - transport authentication: the authenticated actor comes from the `x-actor-id`
 *     header (a dev/test boundary); missing principal fails closed (401);
 *   - authorization uses the AUTHENTICATED actor (not a body field) via ConsentAuthorizer;
 *   - capture/withdraw write canonical consent through ConsentEngine; the read path
 *     then allows/blocks reads. The handler holds no authz logic.
 */

import { FastifyInstance } from 'fastify';
import { buildTestApp, TENANT } from './helpers';
import { DatabaseClient } from '../../../packages/core/src/shared/database';
import {
  GraphFactResolver,
  GraphConsentFactSource,
  ConsentRepository,
  assembleAuthorizedContext,
  registerReadAuthorizationPolicies,
  RetrievalPermissionGate,
  RETRIEVAL_READ_RULESET,
  RulesEngine,
  RulesRegistry,
  NoopAuditSink,
} from '@alara-os/core';
import type { RelationshipReadPort, AssemblerInput } from '@alara-os/core';

const SUBJECT = 'subject-patient-1';
const ACTOR = 'wm-care-guide';
const STRANGER = 'wm-stranger';

const NO_RELATIONSHIPS: RelationshipReadPort = {
  async getActiveBySubject() { return []; },
  async getActiveEdgesForRelationship() { return []; },
};

// capturedBy is intentionally NOT in the body — the authorization actor is the
// authenticated principal (x-actor-id header), set via post(..., actor).
const captureBody = (over: Record<string, unknown> = {}) => ({
  tenantId: TENANT, subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
  permissionTypes: ['read'], source: 'intake', ...over,
});

let app: FastifyInstance;
let store: ReturnType<typeof buildTestApp>['store'];
let container: ReturnType<typeof buildTestApp>['container'];

// Minimal shape of a Fastify inject response (avoids inject's overloaded union type).
interface InjectRes { statusCode: number; json(): any }

// POST with an optional authenticated actor (x-actor-id header).
async function post(url: string, payload: Record<string, unknown>, actor?: string): Promise<InjectRes> {
  const headers = actor ? { 'x-actor-id': actor } : {};
  return (await app.inject({ method: 'POST', url, payload, headers })) as unknown as InjectRes;
}

// POST capture with an explicit idempotency-key header (and authenticated actor).
async function postKeyed(payload: Record<string, unknown>, actor: string, key: string): Promise<InjectRes> {
  return (await app.inject({
    method: 'POST', url: '/commands/consent', payload,
    headers: { 'x-actor-id': actor, 'idempotency-key': key },
  })) as unknown as InjectRes;
}

async function readAllowed(db: DatabaseClient, subjectId = SUBJECT, actor = ACTOR): Promise<boolean> {
  const registry = new RulesRegistry();
  registry.registerRuleSet({ id: RETRIEVAL_READ_RULESET, name: 'read', description: '', version: '1' });
  registerReadAuthorizationPolicies(registry);
  const gate = new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));
  const resolver = new GraphFactResolver({
    relationships: NO_RELATIONSHIPS,
    consent: new GraphConsentFactSource(new ConsentRepository(db)),
  });
  const input = {
    tenantId: TENANT, subjectId, subjectType: 'Patient',
    patterns: [], knowledgeEntries: [], observations: [{ id: 'o1' }],
    objectAttributes: {}, externalReferences: [], workflowSummaries: [], recentEventTypes: [],
  } as unknown as AssemblerInput;
  const r = await assembleAuthorizedContext(gate, input, { actor, resolver, requires: { consent: true } });
  return r.subjectAuthorized;
}

const consentCount = () => Array.from(store.objects.values()).filter(o => o.type === 'Consent').length;

beforeEach(async () => {
  const t = buildTestApp();
  store = t.store;
  container = t.container;
  app = await t.buildApp();
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('POST /commands/consent (capture)', () => {
  test('authenticated subject grants canonical consent (201)', async () => {
    const res = await post('/commands/consent', captureBody(), SUBJECT);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.captured).toBe(true);
    expect(body.status).toBe('active');
    expect(body.consentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(consentCount()).toBe(1);
    // canonical provenance: the recorded actor is the authenticated principal
    const consent = Array.from(store.objects.values()).find(o => o.type === 'Consent')!;
    expect(consent.attributes.recipientId).toBe(ACTOR);
  });

  test('capture WITHOUT an authenticated actor fails closed (401), no object', async () => {
    const res = await post('/commands/consent', captureBody()); // no x-actor-id
    expect(res.statusCode).toBe(401);
    expect(consentCount()).toBe(0);
  });

  test('invalid input reports validation failure (authenticated)', async () => {
    const empty = await post('/commands/consent', captureBody({ permissionTypes: [] }), SUBJECT);
    expect(empty.statusCode).toBe(422);
    const missing = await post('/commands/consent', { tenantId: TENANT, subjectId: SUBJECT }, SUBJECT);
    expect(missing.statusCode).toBe(400);
  });

  test('capture → required-consent reasoning read is allowed', async () => {
    await post('/commands/consent', captureBody(), SUBJECT);
    expect(await readAllowed(container.db)).toBe(true);
  });
});

describe('POST /commands/consent — idempotency (end to end)', () => {
  test('identical resubmit → 200 replay, same consentId, exactly one Consent', async () => {
    const first = await post('/commands/consent', captureBody(), SUBJECT);
    const second = await post('/commands/consent', captureBody(), SUBJECT);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);                       // replay, nothing created
    expect(second.json().consentId).toBe(first.json().consentId);
    expect(consentCount()).toBe(1);
  });

  test('different content → distinct Consent (201, two objects)', async () => {
    const a = await post('/commands/consent', captureBody({ permissionTypes: ['read'] }), SUBJECT);
    const b = await post('/commands/consent', captureBody({ permissionTypes: ['update'] }), SUBJECT);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().consentId).not.toBe(a.json().consentId);
    expect(consentCount()).toBe(2);
  });

  test('explicit idempotency-key reused with different content → 409, no second Consent', async () => {
    const a = await postKeyed(captureBody({ permissionTypes: ['read'] }), SUBJECT, 'idem-1');
    const conflict = await postKeyed(captureBody({ permissionTypes: ['update'] }), SUBJECT, 'idem-1');
    expect(a.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(consentCount()).toBe(1);
  });
});

describe('POST /commands/consent/withdraw', () => {
  test('authenticated subject withdraws (200), object revoked', async () => {
    const cap = await post('/commands/consent', captureBody(), SUBJECT);
    const consentId = cap.json().consentId;
    const res = await post('/commands/consent/withdraw', { tenantId: TENANT, consentId }, SUBJECT);
    expect(res.statusCode).toBe(200);
    expect(res.json().withdrawn).toBe(true);
    expect(store.objects.get(consentId)?.attributes.status).toBe('revoked');
  });

  test('withdraw WITHOUT an authenticated actor fails closed (401), consent unchanged', async () => {
    const cap = await post('/commands/consent', captureBody(), SUBJECT);
    const consentId = cap.json().consentId;
    const res = await post('/commands/consent/withdraw', { tenantId: TENANT, consentId }); // no header
    expect(res.statusCode).toBe(401);
    expect(store.objects.get(consentId)?.attributes.status).toBe('active');
  });

  test('withdraw → next required-consent read is blocked', async () => {
    const cap = await post('/commands/consent', captureBody(), SUBJECT);
    expect(await readAllowed(container.db)).toBe(true);
    await post('/commands/consent/withdraw', { tenantId: TENANT, consentId: cap.json().consentId }, SUBJECT);
    expect(await readAllowed(container.db)).toBe(false);
  });

  test('repeated withdraw is idempotent: still 200 and stable, no additional event', async () => {
    const cap = await post('/commands/consent', captureBody(), SUBJECT);
    const consentId = cap.json().consentId;
    const first = await post('/commands/consent/withdraw', { tenantId: TENANT, consentId }, SUBJECT);
    const eventsAfterFirst = store.events.length;
    const second = await post('/commands/consent/withdraw', { tenantId: TENANT, consentId }, SUBJECT);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);                       // stable, still successful
    expect(second.json().withdrawn).toBe(true);
    expect(second.json().consentId).toBe(consentId);
    expect(second.json().status).toBe('revoked');
    expect(store.events.length).toBe(eventsAfterFirst);        // no redundant ObjectUpdated
  });
});

describe('consent endpoint authorization (authenticated actor)', () => {
  test('unauthorized authenticated actor cannot grant → 403, no object', async () => {
    const res = await post('/commands/consent', captureBody(), STRANGER);
    expect(res.statusCode).toBe(403);
    expect(consentCount()).toBe(0);
  });

  test('body capturedBy cannot impersonate the subject', async () => {
    // Authenticated as a stranger, but the body claims capturedBy = SUBJECT.
    // Authorization must use the authenticated actor (stranger) → 403.
    const res = await post('/commands/consent', captureBody({ capturedBy: SUBJECT }), STRANGER);
    expect(res.statusCode).toBe(403);
    expect(consentCount()).toBe(0);
  });

  test('unauthorized authenticated actor cannot withdraw → 403, consent unchanged', async () => {
    const cap = await post('/commands/consent', captureBody(), SUBJECT); // self-granted
    const consentId = cap.json().consentId;
    const res = await post('/commands/consent/withdraw', { tenantId: TENANT, consentId }, STRANGER);
    expect(res.statusCode).toBe(403);
    expect(store.objects.get(consentId)?.attributes.status).toBe('active');
  });
});
