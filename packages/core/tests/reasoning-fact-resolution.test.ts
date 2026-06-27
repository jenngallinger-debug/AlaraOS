/**
 * Alara OS — Fact Resolution for Read Authorization tests
 *
 * Proves: absence of a REQUIRED consent/participation/ai-act fact does not become
 * implicit permission. The resolver resolves facts (only); the boundary marks
 * required kinds; the existing Permission Gate + read adapters fail closed on a
 * required-but-unresolved fact. Consent/participation are resolved per (actor,
 * subject), so a missing required fact denies the subject (and thus all evidence).
 */

import { assembleAuthorizedContext } from '../src/reasoning-engine/authorized-context';
import { AssemblerInput } from '../src/reasoning-engine/prompt-assembler';
import { registerReadAuthorizationPolicies } from '../src/reasoning-engine/read-authorization-policies';
import {
  GraphFactResolver,
  FactResolver,
  AuthorizationFacts,
  RelationshipReadPort,
} from '../src/reasoning-engine/fact-resolver';
import {
  RetrievalPermissionGate,
  RETRIEVAL_READ_RULESET,
} from '../src/retrieval-engine/permission-gate';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { RuleSet } from '../src/rules-engine/types';
import { ConsentFact, ParticipationFact, AIActionFact, ParticipationRole }
  from '../src/rules-engine/policies/context-types';
import { ParticipationEdge } from '../src/relationship-engine/types';

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const ACTOR = 'wm-care-guide';

const READ_RULESET: RuleSet = {
  id: RETRIEVAL_READ_RULESET, name: 'Retrieval Read Gate',
  description: 'Visibility gate for retrieval/reasoning reads', version: '1.0.0',
};

function makeGate(): RetrievalPermissionGate {
  const registry = new RulesRegistry();
  registry.registerRuleSet(READ_RULESET);
  registerReadAuthorizationPolicies(registry);
  return new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));
}

function fixedResolver(facts: AuthorizationFacts): FactResolver {
  return { async resolve() { return facts; } };
}

function rec(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, ...extra };
}

function makeInput(observations: Record<string, unknown>[]): AssemblerInput {
  return {
    tenantId: TENANT, subjectId: SUBJECT, subjectType: 'Patient',
    patterns: [], knowledgeEntries: [], observations,
    objectAttributes: {}, externalReferences: [], workflowSummaries: [], recentEventTypes: [],
  } as unknown as AssemblerInput;
}

const ids = (arr: readonly unknown[]): string[] => arr.map((r) => (r as { id: string }).id);

function activeConsent(): ConsentFact {
  return {
    consentId: 'c-ok', subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
    permissionTypes: ['read'], effectiveDate: '2020-01-01', version: 1, status: 'active',
  };
}
function revokedConsent(): ConsentFact {
  return { ...activeConsent(), consentId: 'c-rev', status: 'revoked', revokedAt: '2024-01-01' };
}
function participation(role: ParticipationRole): ParticipationFact {
  return { workforceMemberId: ACTOR, objectId: SUBJECT, role };
}
function prohibitedAi(): AIActionFact {
  return { actionClass: 'order_interpret', isAutonomous: true, confidence: 0.9, agentId: 'reasoning' };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Fact Resolution for Read Authorization', () => {
  test('1. resolved valid consent → record passes', async () => {
    const r = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({ consent: activeConsent() }), requires: { consent: true },
    });
    expect(r.subjectAuthorized).toBe(true);
    expect(ids(r.context.observations)).toEqual(['o1']);
  });

  test('2. resolved denied (revoked) consent → excluded', async () => {
    const r = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({ consent: revokedConsent() }), requires: { consent: true },
    });
    expect(r.subjectAuthorized).toBe(false);
    expect(r.context.observations).toHaveLength(0);
    expect(r.deniedCount).toBeGreaterThanOrEqual(1);
  });

  test('3. missing consent fails closed when consent is required', async () => {
    const r = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({}), requires: { consent: true },
    });
    expect(r.subjectAuthorized).toBe(false);
    expect(r.context.observations).toHaveLength(0);
  });

  test('4. resolved valid participation → record passes', async () => {
    const r = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({ participation: participation('Actor') }), requires: { participation: true },
    });
    expect(r.subjectAuthorized).toBe(true);
    expect(ids(r.context.observations)).toEqual(['o1']);
  });

  test('5. missing/invalid participation excludes when participation is required', async () => {
    const none = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({ participation: participation('None') }), requires: { participation: true },
    });
    expect(none.subjectAuthorized).toBe(false);
    expect(none.context.observations).toHaveLength(0);

    const missing = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({}), requires: { participation: true },
    });
    expect(missing.subjectAuthorized).toBe(false);
  });

  test('6. AI-Act denial excludes AI reasoning use', async () => {
    const r = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({ aiAction: prohibitedAi() }),
    });
    expect(r.subjectAuthorized).toBe(false);
    expect(r.context.observations).toHaveLength(0);
  });

  test('7. missing AI-Act fact fails closed when ai-act is required', async () => {
    const r = await assembleAuthorizedContext(makeGate(), makeInput([rec('o1')]), {
      actor: ACTOR, resolver: fixedResolver({}), requires: { aiAct: true },
    });
    expect(r.subjectAuthorized).toBe(false);
    expect(r.context.observations).toHaveLength(0);
  });

  test('8. existing manually-attached facts still work (no resolver)', async () => {
    // No resolver, nothing required → a record with no facts passes; a record with
    // a manually attached revoked consent is still excluded.
    const r = await assembleAuthorizedContext(
      makeGate(),
      makeInput([rec('o-open'), rec('o-revoked', { consent: revokedConsent() })]),
      { actor: ACTOR },
    );
    expect(r.subjectAuthorized).toBe(true);
    expect(ids(r.context.observations)).toEqual(['o-open']);
    expect(r.deniedCount).toBe(1);
  });

  test('9. GraphFactResolver resolves participation from canonical relationship edges', async () => {
    const edge = (participantId: string, role: ParticipationEdge['role']): ParticipationEdge => ({
      id: ('e-' + participantId) as unknown as ParticipationEdge['id'],
      tenantId: TENANT,
      relationshipId: 'rel-1' as unknown as ParticipationEdge['relationshipId'],
      participantId, participantType: 'WorkforceMember', role, active: true,
      startedAt: new Date(), endedAt: null, coverageExpiresAt: null, version: 1,
    });
    const port: RelationshipReadPort = {
      async getActiveBySubject(_t, s) { return s === SUBJECT ? [{ id: 'rel-1' }] : []; },
      async getActiveEdgesForRelationship(_t, relId) {
        return relId === 'rel-1' ? [edge(ACTOR, 'Owner'), edge('someone-else', 'Stakeholder')] : [];
      },
    };
    const resolver = new GraphFactResolver({ relationships: port });

    const facts = await resolver.resolve({ tenantId: TENANT, actor: ACTOR, subjectId: SUBJECT });
    expect(facts.participation?.role).toBe('Owner');

    const noEdge = await resolver.resolve({ tenantId: TENANT, actor: 'nobody', subjectId: SUBJECT });
    expect(noEdge.participation?.role).toBe('None');
  });
});
