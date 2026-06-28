/**
 * Alara OS — Consent Capture / Intake Integration tests
 *
 * Proves the capture loop: an intake/portal-style capture command → ConsentEngine
 * (canonical Consent object + events) → ConsentRepository + GraphConsentFactSource →
 * existing ConsentPolicyModule / Permission Gate decide. Capture owns no
 * authorization and no lifecycle logic — it validates and calls the engine.
 */

import { InMemoryStore } from './helpers/in-memory-store';
import { DatabaseClient } from '../src/shared/database';
import { EventStore } from '../src/events/store';
import { reconstructFromEvents } from '../src/object-graph/command-handler';
import { ConsentEngine } from '../src/consent-store/engine';
import { ConsentCaptureService, ConsentCaptureValidationError, ConsentIdempotencyConflictError, CaptureConsentInput } from '../src/consent-store/capture';
import { ConsentRepository } from '../src/consent-store/repository';
import { GraphConsentFactSource } from '../src/consent-store/consent-fact-source';
import { GraphFactResolver, RelationshipReadPort } from '../src/reasoning-engine/fact-resolver';
import { assembleAuthorizedContext } from '../src/reasoning-engine/authorized-context';
import { AssemblerInput } from '../src/reasoning-engine/prompt-assembler';
import { registerReadAuthorizationPolicies } from '../src/reasoning-engine/read-authorization-policies';
import { RetrievalPermissionGate, RETRIEVAL_READ_RULESET } from '../src/retrieval-engine/permission-gate';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { RuleSet } from '../src/rules-engine/types';
import { ConsentPermissionType } from '../src/rules-engine/policies/context-types';

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const ACTOR = 'wm-care-guide';
const CLERK = 'intake-clerk';

const READ_RULESET: RuleSet = {
  id: RETRIEVAL_READ_RULESET, name: 'Retrieval Read Gate', description: 'read gate', version: '1.0.0',
};
const NO_RELATIONSHIPS: RelationshipReadPort = {
  async getActiveBySubject() { return []; },
  async getActiveEdgesForRelationship() { return []; },
};

interface Harness {
  capture: ConsentCaptureService;
  repo: ConsentRepository;
  events: EventStore;
  resolver: GraphFactResolver;
  gate: RetrievalPermissionGate;
}

function makeHarness(): Harness {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const capture = new ConsentCaptureService(new ConsentEngine(db));
  const repo = new ConsentRepository(db);
  const events = new EventStore(db);
  const resolver = new GraphFactResolver({
    relationships: NO_RELATIONSHIPS,
    consent: new GraphConsentFactSource(repo),
  });
  const registry = new RulesRegistry();
  registry.registerRuleSet(READ_RULESET);
  registerReadAuthorizationPolicies(registry);
  const gate = new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));
  return { capture, repo, events, resolver, gate };
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

function captureArgs(over: Partial<CaptureConsentInput> = {}): CaptureConsentInput {
  return {
    tenantId: TENANT, subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
    permissionTypes: ['read'] as ConsentPermissionType[], capturedBy: CLERK, source: 'intake', ...over,
  };
}

describe('Consent Capture / Intake Integration', () => {
  test('1. intake capture grants canonical consent', async () => {
    const h = makeHarness();
    const res = await h.capture.capture(captureArgs());
    expect(res.captured).toBe(true);
    expect(res.status).toBe('active');
    const facts = await h.repo.findForSubject(TENANT, SUBJECT);
    expect(facts).toHaveLength(1);
    expect(facts[0].recipientId).toBe(ACTOR);
  });

  test('2. capture creates auditable object/event state', async () => {
    const h = makeHarness();
    const { consentId } = await h.capture.capture(captureArgs());
    const stream = await h.events.loadStream(TENANT, consentId);
    expect(stream.map((e) => e.type)).toEqual(['ObjectCreated']);
    const rebuilt = await reconstructFromEvents(h.events, TENANT, consentId);
    expect(rebuilt?.type).toBe('Consent');
    expect((rebuilt?.attributes as { status?: string }).status).toBe('active');
  });

  test('3. required-consent reasoning read is allowed after capture', async () => {
    const h = makeHarness();
    await h.capture.capture(captureArgs());
    expect(await readAllowed(h)).toBe(true);
  });

  test('4. captured withdrawal blocks the next required-consent read', async () => {
    const h = makeHarness();
    const { consentId } = await h.capture.capture(captureArgs());
    expect(await readAllowed(h)).toBe(true);
    const w = await h.capture.withdraw({ tenantId: TENANT, consentId, capturedBy: CLERK });
    expect(w.status).toBe('revoked');
    expect(await readAllowed(h)).toBe(false);
  });

  test('5. missing required fields are rejected', async () => {
    const h = makeHarness();
    await expect(h.capture.capture(captureArgs({ permissionTypes: [] }))).rejects.toBeInstanceOf(ConsentCaptureValidationError);
    await expect(h.capture.capture(captureArgs({ recipientId: '' }))).rejects.toBeInstanceOf(ConsentCaptureValidationError);
    await expect(h.capture.capture(captureArgs({ subjectId: '' }))).rejects.toBeInstanceOf(ConsentCaptureValidationError);
  });

  test('6. wrong subject / actor / permission still blocks', async () => {
    const wrongSubject = makeHarness();
    await wrongSubject.capture.capture(captureArgs());
    expect(await readAllowed(wrongSubject, 'other-subject')).toBe(false);

    const wrongActor = makeHarness();
    await wrongActor.capture.capture(captureArgs({ recipientId: 'a-different-actor' }));
    expect(await readAllowed(wrongActor)).toBe(false);

    const wrongPermission = makeHarness();
    await wrongPermission.capture.capture(captureArgs({ permissionTypes: ['update'] as ConsentPermissionType[] }));
    expect(await readAllowed(wrongPermission)).toBe(false);
  });
});

// ─── Capture idempotency (eventStore wired) ───────────────────────────────────

describe('Consent Capture idempotency', () => {
  // A harness whose capture service has the event store wired (idempotency active),
  // mirroring the API container. Shares one db so the repo can count Consent objects.
  function makeIdem() {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const events = new EventStore(db);
    const capture = new ConsentCaptureService(new ConsentEngine(db), undefined, events);
    const repo = new ConsentRepository(db);
    return { db, events, capture, repo };
  }
  const consentCount = (repo: ConsentRepository) => repo.findForSubject(TENANT, SUBJECT).then((f) => f.length);

  test('1. first capture succeeds and creates one Consent', async () => {
    const h = makeIdem();
    const res = await h.capture.capture(captureArgs());
    expect(res.captured).toBe(true);
    expect(res.idempotentReplay).toBeFalsy();
    expect(await consentCount(h.repo)).toBe(1);
  });

  test('2/3. identical resubmit (no explicit key) → safe replay, no duplicate Consent or events', async () => {
    const h = makeIdem();
    const first = await h.capture.capture(captureArgs());
    const second = await h.capture.capture(captureArgs());

    expect(second.idempotentReplay).toBe(true);
    expect(second.consentId).toBe(first.consentId);   // stable response
    expect(second.eventId).toBe(first.eventId);
    expect(await consentCount(h.repo)).toBe(1);        // no second Consent

    // The single Consent's stream still has exactly one ObjectCreated (no duplicate write).
    const stream = await h.events.loadStream(TENANT, first.consentId);
    expect(stream.map((e) => e.type)).toEqual(['ObjectCreated']);
  });

  test('4. different content → distinct Consent (idempotency does not collapse them)', async () => {
    const h = makeIdem();
    const a = await h.capture.capture(captureArgs({ permissionTypes: ['read'] as ConsentPermissionType[] }));
    const b = await h.capture.capture(captureArgs({ permissionTypes: ['update'] as ConsentPermissionType[] }));
    expect(b.idempotentReplay).toBeFalsy();
    expect(b.consentId).not.toBe(a.consentId);
    expect(await consentCount(h.repo)).toBe(2);
  });

  test('4b. different explicit idempotency key with identical content → distinct Consent', async () => {
    const h = makeIdem();
    const a = await h.capture.capture(captureArgs({ idempotencyKey: 'key-A' }));
    const b = await h.capture.capture(captureArgs({ idempotencyKey: 'key-B' }));
    expect(b.consentId).not.toBe(a.consentId);
    expect(await consentCount(h.repo)).toBe(2);
  });

  test('5. missing explicit key still dedups via content key (referral natural-key convention)', async () => {
    const h = makeIdem();
    const first = await h.capture.capture(captureArgs()); // no idempotencyKey
    const second = await h.capture.capture(captureArgs()); // no idempotencyKey
    expect(second.idempotentReplay).toBe(true);
    expect(second.consentId).toBe(first.consentId);
    expect(await consentCount(h.repo)).toBe(1);
  });

  test('6. same explicit key reused with DIFFERENT content → conflict, no second Consent', async () => {
    const h = makeIdem();
    await h.capture.capture(captureArgs({ idempotencyKey: 'k1', permissionTypes: ['read'] as ConsentPermissionType[] }));
    await expect(
      h.capture.capture(captureArgs({ idempotencyKey: 'k1', permissionTypes: ['update'] as ConsentPermissionType[] })),
    ).rejects.toBeInstanceOf(ConsentIdempotencyConflictError);
    expect(await consentCount(h.repo)).toBe(1); // conflict created nothing new
  });
});
