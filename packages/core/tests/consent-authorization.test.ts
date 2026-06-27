/**
 * Alara OS — Who-May-Grant Consent Authorization tests
 *
 * The decision lives in the RulesEngine + ConsentAuthorityPolicyModule; the
 * ConsentAuthorizer resolves facts (participation, the consent's subject) and
 * delegates. ConsentCaptureService calls the authorizer before any canonical
 * write. Smallest rule: subject-self or a sufficient participation role (Owner/
 * Actor) may grant/withdraw; everything else (incl. missing context) fails closed.
 */

import { InMemoryStore } from './helpers/in-memory-store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { ConsentEngine } from '../src/consent-store/engine';
import { ConsentRepository } from '../src/consent-store/repository';
import { ConsentCaptureService } from '../src/consent-store/capture';
import { ConsentAuthorizer, ConsentAuthorizationError } from '../src/consent-store/authorizer';
import {
  ConsentAuthorityPolicyModule,
  CONSENT_CAPTURE_RULESET,
} from '../src/rules-engine/policies/consent-authority-policy';
import { RelationshipRepository } from '../src/relationship-engine/repository';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { RuleContext } from '../src/rules-engine/types';

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const AGENT = 'wm-care-guide';
const STRANGER = 'wm-stranger';

interface Harness {
  store: InMemoryStore;
  service: ConsentCaptureService;
  consents: ConsentRepository;
}

function makeHarness(): Harness {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const consents = new ConsentRepository(db);
  const registry = new RulesRegistry();
  registry.registerPolicyModule(ConsentAuthorityPolicyModule);
  const authorizer = new ConsentAuthorizer(new RulesEngine(registry, new NoopAuditSink()), {
    relationships: new RelationshipRepository(db),
    consents,
  });
  const service = new ConsentCaptureService(new ConsentEngine(db), authorizer);
  return { store, service, consents };
}

function captureArgs(over: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT, subjectId: SUBJECT, grantorId: 'patient', recipientId: AGENT,
    permissionTypes: ['read'] as ('read')[], capturedBy: SUBJECT, source: 'intake', ...over,
  };
}

function consentCount(store: InMemoryStore): number {
  return Array.from(store.objects.values()).filter(o => o.type === 'Consent').length;
}

// Seed an active Owner participation edge for `participant` on `subjectId`.
function seedOwnerEdge(store: InMemoryStore, subjectId: string, participant: string): void {
  const relId = makeAlaraId('00000000-0000-4000-8000-0000000000b1');
  store.relationships.set(relId, {
    id: relId, tenant_id: TENANT, type: 'PatientCareGuide', status: 'active',
    subject_id: subjectId, description: '', version: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    terminated_at: null, termination_reason: null,
  });
  const edgeId = makeAlaraId('00000000-0000-4000-8000-0000000000c1');
  store.edges.set(edgeId, {
    id: edgeId, tenant_id: TENANT, relationship_id: relId, participant_id: participant,
    participant_type: 'WorkforceMember', role: 'Owner', active: true,
    started_at: new Date().toISOString(), ended_at: null, coverage_expires_at: null, version: 1,
  });
}

describe('Who-May-Grant Consent Authorization', () => {
  test('1. subject (self) can grant consent', async () => {
    const h = makeHarness();
    const res = await h.service.capture(captureArgs({ capturedBy: SUBJECT }));
    expect(res.captured).toBe(true);
    expect(consentCount(h.store)).toBe(1);
  });

  test('1b. organizational actor with Owner participation can grant consent', async () => {
    const h = makeHarness();
    seedOwnerEdge(h.store, SUBJECT, AGENT);
    const res = await h.service.capture(captureArgs({ capturedBy: AGENT }));
    expect(res.captured).toBe(true);
    expect(consentCount(h.store)).toBe(1);
  });

  test('2. unauthorized actor cannot grant consent', async () => {
    const h = makeHarness();
    await expect(h.service.capture(captureArgs({ capturedBy: STRANGER })))
      .rejects.toBeInstanceOf(ConsentAuthorizationError);
    expect(consentCount(h.store)).toBe(0); // (6) no Consent object created on denial
  });

  test('3. missing actor context fails closed (policy + authorizer)', async () => {
    // Policy: missing actor/subject → DENY.
    const ctx: RuleContext = {
      tenantId: TENANT, actor: '', eventType: 'ConsentGrantRequested',
      eventPayload: {}, ruleSetId: CONSENT_CAPTURE_RULESET, objects: { subjectId: SUBJECT },
    };
    expect(ConsentAuthorityPolicyModule.evaluate(ctx).outcome).toBe('DENY');

    // Authorizer: empty actor → throws.
    const h = makeHarness();
    const authorizer = new ConsentAuthorizer(
      new RulesEngine((() => { const r = new RulesRegistry(); r.registerPolicyModule(ConsentAuthorityPolicyModule); return r; })(), new NoopAuditSink()),
      {},
    );
    await expect(authorizer.assertMayGrant({ tenantId: TENANT, actor: '', subjectId: SUBJECT }))
      .rejects.toBeInstanceOf(ConsentAuthorizationError);
    void h;
  });

  test('4. authorized actor (self) can withdraw consent', async () => {
    const h = makeHarness();
    const cap = await h.service.capture(captureArgs({ capturedBy: SUBJECT }));
    const res = await h.service.withdraw({ tenantId: TENANT, consentId: cap.consentId, capturedBy: SUBJECT });
    expect(res.withdrawn).toBe(true);
    expect((await h.consents.findById(TENANT, cap.consentId))?.status).toBe('revoked');
  });

  test('5. unauthorized actor cannot withdraw consent (and consent is unmodified)', async () => {
    const h = makeHarness();
    const cap = await h.service.capture(captureArgs({ capturedBy: SUBJECT }));
    await expect(h.service.withdraw({ tenantId: TENANT, consentId: cap.consentId, capturedBy: STRANGER }))
      .rejects.toBeInstanceOf(ConsentAuthorizationError);
    // (6) consent unchanged after denied withdrawal
    expect((await h.consents.findById(TENANT, cap.consentId))?.status).toBe('active');
  });
});
