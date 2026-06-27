/**
 * Alara OS — Read Authorization Boundary tests (M9 / Permission Gate completion)
 *
 * Proves implementation pin #6: "Authorization must gate Graph reads before
 * Reality Understanding sees data." Every evidence record passes the existing
 * RetrievalPermissionGate before it can enter the ReasoningContext.
 *
 * Reuses the real Consent / Participation / AI-Act modules via the read-boundary
 * adapters. Fail-closed, ALLOW-only.
 */

import {
  assembleAuthorizedContext,
} from '../src/reasoning-engine/authorized-context';
import { AssemblerInput } from '../src/reasoning-engine/prompt-assembler';
import { registerReadAuthorizationPolicies } from '../src/reasoning-engine/read-authorization-policies';
import {
  RetrievalPermissionGate,
  RETRIEVAL_READ_RULESET,
} from '../src/retrieval-engine/permission-gate';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import {
  PolicyModule,
  PolicyEvaluation,
  RuleContext,
  RuleSet,
} from '../src/rules-engine/types';
import {
  ConsentFact,
  ParticipationFact,
  AIActionFact,
} from '../src/rules-engine/policies/context-types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const ACTOR_ALLOWED = 'wm-care-guide-allowed';
const ACTOR_DENIED = 'wm-external-denied';

const READ_RULESET: RuleSet = {
  id: RETRIEVAL_READ_RULESET,
  name: 'Retrieval Read Gate',
  description: 'Visibility gate for retrieval/reasoning reads',
  version: '1.0.0',
};

// Subject-visibility stand-in (mirrors the M11 test): ACTOR_DENIED cannot see a
// record marked restricted. Stands alongside the real consent/participation/
// ai-act adapters; here only to drive subject-level denial.
const SubjectVisibilityPolicy: PolicyModule = {
  id: 'test.read.visibility',
  name: 'Test Read Visibility',
  version: '1.0.0',
  priority: 1,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = (context.objects.record ?? {}) as Record<string, unknown>;
    const denied = isRestricted(record) && context.actor === ACTOR_DENIED;
    return mk('test.read.visibility', denied ? 'DENY' : 'ALLOW');
  },
};

// Indeterminate policy → REQUIRE_HUMAN for flagged records. An indeterminate
// decision escalates to a human and must NOT be auto-readable; the ALLOW-only
// gate suppresses it. (A lone DEFER is collapsed to ALLOW by the RulesEngine, so
// "indeterminate" is expressed as REQUIRE_HUMAN to fail closed — see boundary docs.)
const IndeterminatePolicy: PolicyModule = {
  id: 'test.read.indeterminate',
  name: 'Test Indeterminate',
  version: '1.0.0',
  priority: 2,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = (context.objects.record ?? {}) as Record<string, unknown>;
    return mk('test.read.indeterminate', record['indeterminate'] === true ? 'REQUIRE_HUMAN' : 'ALLOW');
  },
};

// Throwing policy → exercised by a record flagged boom (engine treats throw as DENY).
const BoomPolicy: PolicyModule = {
  id: 'test.read.boom',
  name: 'Test Boom',
  version: '1.0.0',
  priority: 3,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = (context.objects.record ?? {}) as Record<string, unknown>;
    if (record['boom'] === true) throw new Error('boom');
    return mk('test.read.boom', 'ALLOW');
  },
};

function mk(
  moduleId: string,
  outcome: 'ALLOW' | 'DENY' | 'DEFER' | 'REQUIRE_HUMAN',
): PolicyEvaluation {
  return { moduleId, outcome, appliedRules: [], skippedRules: [], actions: [], reasoning: outcome };
}

function isRestricted(record: Record<string, unknown>): boolean {
  if (record['restricted'] === true) return true;
  for (const v of Object.values(record)) {
    if (v && typeof v === 'object' && (v as Record<string, unknown>)['restricted'] === true) return true;
  }
  return false;
}

// ─── Harness ──────────────────────────────────────────────────────────────────

function makeGate(): RetrievalPermissionGate {
  const registry = new RulesRegistry();
  registry.registerRuleSet(READ_RULESET);
  registry.registerPolicyModule(SubjectVisibilityPolicy);
  registry.registerPolicyModule(IndeterminatePolicy);
  registry.registerPolicyModule(BoomPolicy);
  registerReadAuthorizationPolicies(registry); // real consent/participation/ai-act adapters
  const rules = new RulesEngine(registry, new NoopAuditSink());
  return new RetrievalPermissionGate(rules);
}

function rec(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, ...extra };
}

function makeInput(overrides: {
  patterns?: Record<string, unknown>[];
  knowledgeEntries?: Record<string, unknown>[];
  observations?: Record<string, unknown>[];
  objectAttributes?: Record<string, unknown>;
} = {}): AssemblerInput {
  return {
    tenantId: TENANT,
    subjectId: SUBJECT,
    subjectType: 'Patient',
    patterns: overrides.patterns ?? [],
    knowledgeEntries: overrides.knowledgeEntries ?? [],
    observations: overrides.observations ?? [],
    objectAttributes: overrides.objectAttributes ?? {},
    externalReferences: [],
    workflowSummaries: [],
    recentEventTypes: [],
  } as unknown as AssemblerInput;
}

const ids = (arr: readonly unknown[]): string[] =>
  arr.map((r) => (r as { id: string }).id);

function revokedConsent(): ConsentFact {
  return {
    consentId: 'c-1', subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR_ALLOWED,
    permissionTypes: ['read'], effectiveDate: '2020-01-01', version: 1, status: 'revoked',
    revokedAt: '2024-01-01',
  };
}

function noRoleParticipation(): ParticipationFact {
  return { workforceMemberId: ACTOR_ALLOWED, objectId: SUBJECT, role: 'None' };
}

function prohibitedAiAction(): AIActionFact {
  return { actionClass: 'order_interpret', isAutonomous: true, confidence: 0.9, agentId: 'reasoning' };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Read Authorization Boundary (Reality Understanding reads)', () => {
  test('1. authorized subject: all evidence reaches the context', async () => {
    const gate = makeGate();
    const input = makeInput({
      observations: [rec('obs-a'), rec('obs-b')],
      knowledgeEntries: [rec('k-a')],
      patterns: [rec('p-a')],
    });

    const { context, deniedCount, subjectAuthorized } = await assembleAuthorizedContext(
      gate, input, { actor: ACTOR_ALLOWED },
    );

    expect(subjectAuthorized).toBe(true);
    expect(deniedCount).toBe(0);
    expect(ids(context.observations)).toEqual(['obs-a', 'obs-b']);
    expect(ids(context.knowledgeEntries)).toEqual(['k-a']);
    expect(ids(context.patterns)).toEqual(['p-a']);
  });

  test('2. unauthorized subject: NO evidence reaches the context (fail-closed)', async () => {
    const gate = makeGate();
    const input = makeInput({
      observations: [rec('obs-a')],
      knowledgeEntries: [rec('k-a')],
      patterns: [rec('p-a')],
      objectAttributes: { restricted: true },
    });

    const { context, subjectAuthorized, deniedCount } = await assembleAuthorizedContext(
      gate, input, { actor: ACTOR_DENIED },
    );

    expect(subjectAuthorized).toBe(false);
    expect(deniedCount).toBeGreaterThanOrEqual(1);
    expect(context.observations).toHaveLength(0);
    expect(context.knowledgeEntries).toHaveLength(0);
    expect(context.patterns).toHaveLength(0);
    expect(context.objectAttributes).toEqual({});
  });

  test('3. consent denial blocks the protected record before reasoning', async () => {
    const gate = makeGate();
    const input = makeInput({
      observations: [rec('obs-open'), rec('obs-consented', { consent: revokedConsent() })],
    });

    const { context, deniedCount } = await assembleAuthorizedContext(
      gate, input, { actor: ACTOR_ALLOWED },
    );

    expect(ids(context.observations)).toEqual(['obs-open']);
    expect(deniedCount).toBe(1);
  });

  test('4. participation denial blocks the protected record', async () => {
    const gate = makeGate();
    const input = makeInput({
      patterns: [rec('p-open'), rec('p-norole', { participation: noRoleParticipation() })],
    });

    const { context, deniedCount } = await assembleAuthorizedContext(
      gate, input, { actor: ACTOR_ALLOWED },
    );

    expect(ids(context.patterns)).toEqual(['p-open']);
    expect(deniedCount).toBe(1);
  });

  test('5. AI-Act denial blocks the record from AI reasoning use', async () => {
    const gate = makeGate();
    const input = makeInput({
      knowledgeEntries: [rec('k-open'), rec('k-ai-prohibited', { aiAction: prohibitedAiAction() })],
    });

    const { context, deniedCount } = await assembleAuthorizedContext(
      gate, input, { actor: ACTOR_ALLOWED },
    );

    expect(ids(context.knowledgeEntries)).toEqual(['k-open']);
    expect(deniedCount).toBe(1);
  });

  test('6. fail-closed on indeterminate / require-human / evaluation error', async () => {
    const gate = makeGate();
    const input = makeInput({
      observations: [
        rec('obs-ok'),
        rec('obs-indeterminate', { indeterminate: true }),
        rec('obs-require-human', { aiAction: { actionClass: 'frobnicate', isAutonomous: true, confidence: 0.5, agentId: 'x' } }),
        rec('obs-throw', { boom: true }),
      ],
    });

    const { context, deniedCount } = await assembleAuthorizedContext(
      gate, input, { actor: ACTOR_ALLOWED },
    );

    expect(ids(context.observations)).toEqual(['obs-ok']);
    expect(deniedCount).toBe(3);
  });

  test('7. read-boundary policies reuse the real modules (registration is stable)', () => {
    // The adapters are registered for the read rule set and delegate to the real
    // BD-014 / ADR-014 / ADR-015 modules — no second policy engine.
    const registry = new RulesRegistry();
    registry.registerRuleSet(READ_RULESET);
    registerReadAuthorizationPolicies(registry);
    const modules = registry.getPolicyModulesForRuleSet(RETRIEVAL_READ_RULESET).map((m) => m.id);
    expect(modules).toEqual(
      expect.arrayContaining(['policy.read.ai-act', 'policy.read.consent', 'policy.read.participation']),
    );
  });
});
