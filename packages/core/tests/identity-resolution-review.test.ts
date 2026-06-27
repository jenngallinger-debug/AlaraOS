/**
 * Alara OS — Identity Resolution Phase 3: identity review human gate
 *
 * Proves the REQUIRE_HUMAN gate (docs/architecture/identity-resolution-spec.md §5/§5.1):
 *   - multiple candidates requires human
 *   - conflicting candidate requires human
 *   - PHI-risk action requires human
 *   - exact clean match does NOT require review
 *   - missing policy fails open (the reason it must always be registered); the
 *     factory always registers it, and a missing fact fails closed
 *   - the gate uses a dedicated identity-review rule set (not data-integrity)
 */

import { ObjectCommandHandler } from '../src/object-graph/command-handler';
import { EventStore } from '../src/events/store';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import {
  IdentityResolutionRepository,
  IdentityResolutionEngine,
  IdentityReviewGate,
  createIdentityReviewRulesEngine,
  buildIdentityConflictFact,
} from '../src/identity-resolution';
import { IDENTITY_REVIEW_RULESET } from '../src/rules-engine/policies/identity-review-policy';
import { RulesEngine, RulesRegistry, NoopAuditSink } from '../src/rules-engine';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore } from './helpers/in-memory-store';

const TENANT = 'tenant-1';
const REF = { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' };

function setup() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const repo = new ObjectGraphRepository(db);
  const eventStore = new EventStore(db);
  const handler = new ObjectCommandHandler(db, repo, eventStore);
  const engine = new IdentityResolutionEngine(new IdentityResolutionRepository(db));
  const gate = new IdentityReviewGate();
  return { store, handler, engine, gate };
}

describe('Identity Resolution — review human gate (Phase 3)', () => {
  test('multiple candidates requires human', async () => {
    const { handler, engine, gate } = setup();
    const { object: p1 } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    const { object: p2 } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, p1.id, REF, 'system');
    await handler.addExternalReference(TENANT, p2.id, REF, 'system');

    const result = await engine.resolve({ tenantId: TENANT, externalReferences: [REF] });
    const decision = await gate.review({ tenantId: TENANT, externalReferences: [REF] }, result);
    expect(result.outcome).toBe('POSSIBLE_MATCH_REVIEW_REQUIRED');
    expect(decision.requiresHuman).toBe(true);
    expect(decision.outcome).toBe('REQUIRE_HUMAN');
  });

  test('conflicting candidate requires human', async () => {
    const { handler, engine, gate } = setup();
    const { object: patient } = await handler.createObject({
      tenantId: TENANT, type: 'Patient', actor: 'system', attributes: { dob: '1950-01-01' },
    });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const input = { tenantId: TENANT, externalReferences: [REF], dob: '1960-02-02' };
    const result = await engine.resolve(input);
    const decision = await gate.review(input, result);
    expect(decision.requiresHuman).toBe(true);
  });

  test('PHI-risk action requires human even for an otherwise-clean match', async () => {
    const { handler, engine, gate } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const input = { tenantId: TENANT, externalReferences: [REF] };
    const result = await engine.resolve(input);
    expect(result.outcome).toBe('MATCH');
    const decision = await gate.review(input, result, { phiRisk: true });
    expect(decision.requiresHuman).toBe(true);
  });

  test('exact clean match does NOT require review', async () => {
    const { handler, engine, gate } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const input = { tenantId: TENANT, externalReferences: [REF] };
    const result = await engine.resolve(input);
    const decision = await gate.review(input, result);
    expect(result.outcome).toBe('MATCH');
    expect(decision.requiresHuman).toBe(false);
    expect(decision.outcome).toBe('ALLOW');
  });

  test('NO_MATCH (safe create) does not require identity review', async () => {
    const { engine, gate } = setup();
    const input = { tenantId: TENANT, name: 'Jane Doe' };
    const result = await engine.resolve(input);
    const decision = await gate.review(input, result);
    expect(result.outcome).toBe('NO_MATCH');
    expect(decision.requiresHuman).toBe(false);
  });

  test('missing policy fails OPEN — which is why the factory always registers it', async () => {
    // A RulesEngine with the rule set but NO policy registered: the engine
    // default-ALLOWs (fail open). This is the hazard the factory prevents.
    const bareRegistry = new RulesRegistry();
    bareRegistry.registerRuleSet({ id: IDENTITY_REVIEW_RULESET, name: 'x', description: '', version: '1' });
    const bareEngine = new RulesEngine(bareRegistry, new NoopAuditSink());
    const conflictFact = buildIdentityConflictFact(
      { tenantId: TENANT, externalReferences: [REF] },
      { outcome: 'POSSIBLE_MATCH_REVIEW_REQUIRED', candidateIds: ['a', 'b'], reasonCodes: ['multiple_candidates'], conflicts: [] },
    );
    const bare = await bareEngine.evaluate({
      tenantId: TENANT, actor: 'system', eventType: 'IdentityResolution', eventPayload: {},
      ruleSetId: IDENTITY_REVIEW_RULESET, objects: { identityConflict: conflictFact },
    });
    expect(bare.outcome).toBe('ALLOW'); // fail-open hazard demonstrated

    // The factory always registers the policy → the same ambiguous case requires human.
    const safeEngine = createIdentityReviewRulesEngine();
    const safe = await safeEngine.evaluate({
      tenantId: TENANT, actor: 'system', eventType: 'IdentityResolution', eventPayload: {},
      ruleSetId: IDENTITY_REVIEW_RULESET, objects: { identityConflict: conflictFact },
    });
    expect(safe.outcome).toBe('REQUIRE_HUMAN');
  });

  test('missing identity-conflict fact fails CLOSED (REQUIRE_HUMAN)', async () => {
    const engine = createIdentityReviewRulesEngine();
    const decision = await engine.evaluate({
      tenantId: TENANT, actor: 'system', eventType: 'IdentityResolution', eventPayload: {},
      ruleSetId: IDENTITY_REVIEW_RULESET, objects: {}, // no fact
    });
    expect(decision.outcome).toBe('REQUIRE_HUMAN');
  });

  test('the gate uses the identity-review rule set, not data-integrity', () => {
    expect(IDENTITY_REVIEW_RULESET).toBe('ruleset.identity.review');
    expect(IDENTITY_REVIEW_RULESET).not.toBe('ruleset.data.integrity');
  });
});
