/**
 * Alara OS — Consent Issuance / Lifecycle tests
 *
 * Proves the canonical loop: grant/revoke/expire Consent objects via ConsentEngine
 * (object-graph + event-store), resolve via ConsentRepository + GraphConsentFactSource,
 * and let the existing ConsentPolicyModule / Permission Gate decide. The Permission
 * Gate is unchanged; the lifecycle only creates/changes canonical consent state.
 */

import { InMemoryStore } from './helpers/in-memory-store';
import { DatabaseClient } from '../src/shared/database';
import { EventStore } from '../src/events/store';
import { reconstructFromEvents } from '../src/object-graph/command-handler';
import { ConsentEngine } from '../src/consent-store/engine';
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
import { ConsentPermissionType } from '../src/rules-engine/policies/context-types';

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const ACTOR = 'wm-care-guide';

const READ_RULESET: RuleSet = {
  id: RETRIEVAL_READ_RULESET, name: 'Retrieval Read Gate',
  description: 'reasoning read gate', version: '1.0.0',
};
const NO_RELATIONSHIPS: RelationshipReadPort = {
  async getActiveBySubject() { return []; },
  async getActiveEdgesForRelationship() { return []; },
};

interface Harness {
  engine: ConsentEngine;
  events: EventStore;
  resolver: GraphFactResolver;
  gate: RetrievalPermissionGate;
}

function makeHarness(): Harness {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const engine = new ConsentEngine(db);
  const events = new EventStore(db);
  const resolver = new GraphFactResolver({
    relationships: NO_RELATIONSHIPS,
    consent: new GraphConsentFactSource(new ConsentRepository(db)),
  });
  const registry = new RulesRegistry();
  registry.registerRuleSet(READ_RULESET);
  registerReadAuthorizationPolicies(registry);
  const gate = new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));
  return { engine, events, resolver, gate };
}

function input(subjectId = SUBJECT): AssemblerInput {
  return {
    tenantId: TENANT, subjectId, subjectType: 'Patient',
    patterns: [], knowledgeEntries: [], observations: [{ id: 'o1' }],
    objectAttributes: {}, externalReferences: [], workflowSummaries: [], recentEventTypes: [],
  } as unknown as AssemblerInput;
}

async function readAllowed(h: Harness, subjectId = SUBJECT): Promise<boolean> {
  const r = await assembleAuthorizedContext(h.gate, input(subjectId), {
    actor: ACTOR, resolver: h.resolver, requires: { consent: true },
  });
  return r.subjectAuthorized;
}

function grantArgs(over: Partial<{ subjectId: string; recipientId: string; permissionTypes: ConsentPermissionType[]; expirationDate: string }> = {}) {
  return {
    tenantId: TENANT, subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
    permissionTypes: ['read'] as ConsentPermissionType[], actor: 'system', ...over,
  };
}

describe('Consent Issuance / Lifecycle', () => {
  test('1. granted consent allows a required consent read', async () => {
    const h = makeHarness();
    await h.engine.grant(grantArgs());
    expect(await readAllowed(h)).toBe(true);
  });

  test('2. revoked consent blocks', async () => {
    const h = makeHarness();
    const { consentId } = await h.engine.grant(grantArgs());
    await h.engine.revoke({ tenantId: TENANT, consentId, actor: 'system' });
    expect(await readAllowed(h)).toBe(false);
  });

  test('3. expired consent blocks (past expirationDate, and explicit expire)', async () => {
    const past = makeHarness();
    await past.engine.grant(grantArgs({ expirationDate: '2000-01-01' }));
    expect(await readAllowed(past)).toBe(false);

    const explicit = makeHarness();
    const { consentId } = await explicit.engine.grant(grantArgs());
    await explicit.engine.expire({ tenantId: TENANT, consentId, actor: 'system' });
    expect(await readAllowed(explicit)).toBe(false);
  });

  test('4. missing consent fails closed', async () => {
    const h = makeHarness(); // no grant
    expect(await readAllowed(h)).toBe(false);
  });

  test('5. consent for a different subject does not allow', async () => {
    const h = makeHarness();
    await h.engine.grant(grantArgs({ subjectId: 'other-subject' }));
    expect(await readAllowed(h, SUBJECT)).toBe(false);
  });

  test('6. consent for a different actor/recipient does not allow', async () => {
    const h = makeHarness();
    await h.engine.grant(grantArgs({ recipientId: 'a-different-actor' }));
    expect(await readAllowed(h)).toBe(false);
  });

  test('7. consent for a different permission does not allow', async () => {
    const h = makeHarness();
    await h.engine.grant(grantArgs({ permissionTypes: ['update'] as ConsentPermissionType[] }));
    expect(await readAllowed(h)).toBe(false);
  });

  test('8. grant → revoke → next read blocked', async () => {
    const h = makeHarness();
    const { consentId } = await h.engine.grant(grantArgs());
    expect(await readAllowed(h)).toBe(true);
    await h.engine.revoke({ tenantId: TENANT, consentId, actor: 'system' });
    expect(await readAllowed(h)).toBe(false);
  });

  test('9. consent state is canonical and auditable (event-sourced)', async () => {
    const h = makeHarness();
    const { consentId } = await h.engine.grant(grantArgs());
    await h.engine.revoke({ tenantId: TENANT, consentId, actor: 'system' });

    const stream = await h.events.loadStream(TENANT, consentId);
    expect(stream.map((e) => e.type)).toEqual(['ObjectCreated', 'ObjectUpdated']);

    const rebuilt = await reconstructFromEvents(h.events, TENANT, consentId);
    expect(rebuilt?.type).toBe('Consent');
    expect((rebuilt?.attributes as { status?: string }).status).toBe('revoked');
    expect((rebuilt?.attributes as { revokedAt?: string }).revokedAt).toBeTruthy();
  });
});
