/**
 * Alara OS API — Consent capture/withdraw endpoint tests
 *
 * Proves the surface boundary: POST /commands/consent (capture → ConsentEngine.grant)
 * and POST /commands/consent/withdraw (→ ConsentEngine.revoke) write canonical
 * consent state; the existing read-authorization path (ConsentRepository +
 * GraphConsentFactSource + Permission Gate) then allows/blocks reads accordingly.
 * The handler holds no authorization logic — it validates via ConsentCaptureService
 * and delegates to the engine.
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

const NO_RELATIONSHIPS: RelationshipReadPort = {
  async getActiveBySubject() { return []; },
  async getActiveEdgesForRelationship() { return []; },
};

const captureBody = (over: Record<string, unknown> = {}) => ({
  tenantId: TENANT, subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
  permissionTypes: ['read'], capturedBy: 'intake-clerk', source: 'intake', ...over,
});

// A required-consent reasoning read over the SAME store the API wrote to.
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

let app: FastifyInstance;
let store: ReturnType<typeof buildTestApp>['store'];
let container: ReturnType<typeof buildTestApp>['container'];

beforeEach(async () => {
  const t = buildTestApp();
  store = t.store;
  container = t.container;
  app = await t.buildApp();
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('POST /commands/consent (capture)', () => {
  test('1. capture grants canonical consent', async () => {
    const res = await app.inject({ method: 'POST', url: '/commands/consent', payload: captureBody() });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.captured).toBe(true);
    expect(body.status).toBe('active');
    expect(body.consentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.eventId).toBeDefined();
    const consents = Array.from(store.objects.values()).filter(o => o.type === 'Consent');
    expect(consents).toHaveLength(1);
    expect(consents[0].attributes.recipientId).toBe(ACTOR);
  });

  test('3. invalid capture input reports validation failure', async () => {
    // empty permissionTypes passes JSON schema but fails ConsentCaptureService → 422
    const empty = await app.inject({ method: 'POST', url: '/commands/consent', payload: captureBody({ permissionTypes: [] }) });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().captured).toBe(false);
    expect(empty.json().error).toContain('permissionTypes');

    // missing required field → JSON schema rejects with 400
    const missing = await app.inject({ method: 'POST', url: '/commands/consent', payload: { tenantId: TENANT, subjectId: SUBJECT } });
    expect(missing.statusCode).toBe(400);
  });

  test('4. capture → required-consent reasoning read is allowed', async () => {
    await app.inject({ method: 'POST', url: '/commands/consent', payload: captureBody() });
    expect(await readAllowed(container.db)).toBe(true);
  });
});

describe('POST /commands/consent/withdraw', () => {
  test('2. withdraw revokes canonical consent', async () => {
    const cap = await app.inject({ method: 'POST', url: '/commands/consent', payload: captureBody() });
    const consentId = cap.json().consentId;

    const res = await app.inject({ method: 'POST', url: '/commands/consent/withdraw', payload: { tenantId: TENANT, consentId, capturedBy: 'intake-clerk' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().withdrawn).toBe(true);
    expect(res.json().status).toBe('revoked');

    const consent = store.objects.get(consentId);
    expect(consent?.attributes.status).toBe('revoked');
    expect(consent?.attributes.revokedAt).toBeTruthy();
  });

  test('5. withdraw → next required-consent read is blocked', async () => {
    const cap = await app.inject({ method: 'POST', url: '/commands/consent', payload: captureBody() });
    expect(await readAllowed(container.db)).toBe(true);

    await app.inject({ method: 'POST', url: '/commands/consent/withdraw', payload: { tenantId: TENANT, consentId: cap.json().consentId, capturedBy: 'intake-clerk' } });
    expect(await readAllowed(container.db)).toBe(false);
  });
});
