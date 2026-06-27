/**
 * Alara OS — Consent Store / ConsentFactSource tests
 *
 * Proves positive consent ALLOW from canonical state and fail-closed denial:
 * Consent objects are stored in the unified object graph; `ConsentRepository`
 * reads them; `GraphConsentFactSource` selects the relevant fact; the existing
 * ConsentPolicyModule (via the read adapters + Permission Gate) decides.
 */

import { InMemoryStore } from './helpers/in-memory-store';
import { DatabaseClient } from '../src/shared/database';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { ConsentRepository } from '../src/consent-store/repository';
import { GraphConsentFactSource } from '../src/consent-store/consent-fact-source';
import { GraphFactResolver, RelationshipReadPort } from '../src/reasoning-engine/fact-resolver';
import { assembleAuthorizedContext } from '../src/reasoning-engine/authorized-context';
import { AssemblerInput } from '../src/reasoning-engine/prompt-assembler';
import { registerReadAuthorizationPolicies } from '../src/reasoning-engine/read-authorization-policies';
import {
  RetrievalPermissionGate,
  RETRIEVAL_READ_RULESET,
} from '../src/retrieval-engine/permission-gate';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { RuleSet } from '../src/rules-engine/types';

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const ACTOR = 'wm-care-guide';

const READ_RULESET: RuleSet = {
  id: RETRIEVAL_READ_RULESET, name: 'Retrieval Read Gate',
  description: 'Visibility gate for reasoning reads', version: '1.0.0',
};

// No participation in these tests — stub returns no relationships.
const NO_RELATIONSHIPS: RelationshipReadPort = {
  async getActiveBySubject() { return []; },
  async getActiveEdgesForRelationship() { return []; },
};

interface Harness {
  objects: ObjectGraphRepository;
  resolver: GraphFactResolver;
  gate: RetrievalPermissionGate;
}

function makeHarness(): Harness {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const objects = new ObjectGraphRepository(db);
  const consentRepo = new ConsentRepository(db);
  const resolver = new GraphFactResolver({
    relationships: NO_RELATIONSHIPS,
    consent: new GraphConsentFactSource(consentRepo),
  });
  const registry = new RulesRegistry();
  registry.registerRuleSet(READ_RULESET);
  registerReadAuthorizationPolicies(registry);
  const gate = new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));
  return { objects, resolver, gate };
}

async function seedConsent(h: Harness, attrs: Record<string, unknown>): Promise<void> {
  await h.objects.create({
    tenantId: TENANT, type: 'Consent', state: String(attrs['status'] ?? 'active'),
    attributes: attrs, actor: 'system',
  });
}

function makeInput(): AssemblerInput {
  return {
    tenantId: TENANT, subjectId: SUBJECT, subjectType: 'Patient',
    patterns: [], knowledgeEntries: [], observations: [{ id: 'o1' }],
    objectAttributes: {}, externalReferences: [], workflowSummaries: [], recentEventTypes: [],
  } as unknown as AssemblerInput;
}

const READ_REQUIRED = { actor: ACTOR, requires: { consent: true } } as const;

function baseConsent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
    permissionTypes: ['read'], effectiveDate: '2020-01-01', status: 'active', ...over,
  };
}

describe('Consent Store / ConsentFactSource', () => {
  test('1. valid canonical consent allows a required consent read', async () => {
    const h = makeHarness();
    await seedConsent(h, baseConsent());
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(true);
    expect(r.context.observations).toHaveLength(1);
  });

  test('2. revoked canonical consent blocks', async () => {
    const h = makeHarness();
    await seedConsent(h, baseConsent({ status: 'revoked', revokedAt: '2024-01-01' }));
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(false);
    expect(r.context.observations).toHaveLength(0);
  });

  test('3. missing required consent fails closed', async () => {
    const h = makeHarness(); // nothing seeded
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(false);
  });

  test('4. expired consent blocks', async () => {
    const h = makeHarness();
    await seedConsent(h, baseConsent({ expirationDate: '2000-01-01' })); // status active but expired
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(false);
  });

  test('5. consent for a different subject does not allow', async () => {
    const h = makeHarness();
    await seedConsent(h, baseConsent({ subjectId: 'someone-else' }));
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(false);
  });

  test('6. consent for a different actor does not allow', async () => {
    const h = makeHarness();
    await seedConsent(h, baseConsent({ recipientId: 'a-different-actor' }));
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(false);
  });

  test('7. consent for a different permission/use does not allow', async () => {
    const h = makeHarness();
    await seedConsent(h, baseConsent({ permissionTypes: ['update'] })); // no 'read'
    const r = await assembleAuthorizedContext(h.gate, makeInput(), { ...READ_REQUIRED, resolver: h.resolver });
    expect(r.subjectAuthorized).toBe(false);
  });

  test('8. existing manually-injected consent facts still work (no resolver)', async () => {
    const h = makeHarness();
    const input = {
      tenantId: TENANT, subjectId: SUBJECT, subjectType: 'Patient',
      patterns: [], knowledgeEntries: [],
      observations: [{ id: 'o-open' }, { id: 'o-rev', consent: baseConsent({ status: 'revoked', revokedAt: '2024-01-01' }) }],
      objectAttributes: {}, externalReferences: [], workflowSummaries: [], recentEventTypes: [],
    } as unknown as AssemblerInput;
    const r = await assembleAuthorizedContext(h.gate, input, { actor: ACTOR }); // no resolver, no requires
    expect(r.subjectAuthorized).toBe(true);
    expect(r.context.observations.map((o) => (o as { id: string }).id)).toEqual(['o-open']);
    expect(r.deniedCount).toBe(1);
  });

  test('9. ConsentRepository + source resolution (canonical query path)', async () => {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const objects = new ObjectGraphRepository(db);
    const consentRepo = new ConsentRepository(db);
    const source = new GraphConsentFactSource(consentRepo);

    await objects.create({ tenantId: TENANT, type: 'Consent', state: 'active', attributes: baseConsent(), actor: 'system' });
    await objects.create({ tenantId: TENANT, type: 'Consent', state: 'active', attributes: baseConsent({ subjectId: 'other' }), actor: 'system' });

    const forSubject = await consentRepo.findForSubject(TENANT, SUBJECT);
    expect(forSubject).toHaveLength(1);
    expect(forSubject[0].recipientId).toBe(ACTOR);

    expect((await source.resolveConsent(TENANT, SUBJECT, ACTOR))?.status).toBe('active');
    expect(await source.resolveConsent(TENANT, SUBJECT, 'unknown-actor')).toBeUndefined();
  });
});
