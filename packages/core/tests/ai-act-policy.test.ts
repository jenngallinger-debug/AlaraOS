/**
 * Alara OS — AI Act Constraint Policy Module Tests
 *
 * Proves:
 *   ✓ AI may draft, recommend, summarize, classify, flag autonomously → ALLOW
 *   ✓ AI may NOT autonomously escalate clinical → DENY + FLAG_FOR_HUMAN
 *   ✓ AI may NOT autonomously disclose PHI externally → DENY
 *   ✓ AI may NOT autonomously change consent → DENY
 *   ✓ AI may NOT autonomously authorize benefits → DENY
 *   ✓ AI may NOT autonomously send external communications → DENY
 *   ✓ Prohibited class in assist mode (not autonomous) → ALLOW with REQUIRE_HUMAN action
 *   ✓ Unknown action class → REQUIRE_HUMAN (safe default)
 *   ✓ No AI action fact → module skips (passes through)
 *   ✓ Every DENY includes ADR-015 reference in explanation
 */

import { RulesEngine } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS } from '../src/rules-engine/built-in-policies';
import { AIActConstraintPolicyModule } from '../src/rules-engine/policies/ai-act-policy';
import { AIActionClass, AIActionFact } from '../src/rules-engine/policies/context-types';
import { RuleContext } from '../src/rules-engine/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAIFact(actionClass: AIActionClass, isAutonomous = true, confidence = 0.85): AIActionFact {
  return { actionClass, isAutonomous, confidence, agentId: 'clinical-signal-agent-1' };
}

function makeContext(aiAction?: AIActionFact): RuleContext {
  return {
    tenantId: 'tenant-1',
    actor: 'ai-agent-1',
    eventType: 'ObjectCreated',
    eventPayload: { objectType: 'Patient', state: 'created', attributes: {} },
    ruleSetId: 'ruleset.intake',
    objects: aiAction ? { aiAction } : {},
  };
}

function makeEngine(): RulesEngine {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registry.registerPolicyModule(AIActConstraintPolicyModule);
  return new RulesEngine(registry);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AI Act Constraint — permitted autonomous actions', () => {
  const permitted: AIActionClass[] = ['draft', 'recommend', 'summarize', 'classify', 'flag'];

  test.each(permitted)('"%s" is permitted autonomously → ALLOW', async (cls) => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeAIFact(cls, true)));
    expect(d.outcome).toBe('ALLOW');
    expect(d.explanation.appliedRules[0].ruleId).toBe('ai-act.permitted');
  });
});

describe('AI Act Constraint — prohibited autonomous actions (ADR-015)', () => {
  const prohibited: AIActionClass[] = [
    'clinical_escalate',
    'external_disclose',
    'consent_change',
    'order_interpret',
    'benefit_auth',
    'communicate_external',
  ];

  test.each(prohibited)('"%s" is prohibited autonomously → DENY + FLAG_FOR_HUMAN', async (cls) => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeAIFact(cls, true)));

    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('ai-act.prohibited-autonomous');
    // Must include ADR-015 reference
    expect(d.explanation.reasoning.some(r => r.includes('ADR-015'))).toBe(true);
    // Must recommend FLAG_FOR_HUMAN with human approval
    const flagAction = d.actions.find(a => a.type === 'FLAG_FOR_HUMAN');
    expect(flagAction).toBeDefined();
    expect(flagAction?.requiresHumanApproval).toBe(true);
  });

  test('Prohibited class in assist mode (isAutonomous=false) → ALLOW with REQUIRE_HUMAN action', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeAIFact('clinical_escalate', false)));

    // The AI Act module returns ALLOW, but the action requires human approval.
    // The Rules Engine correctly escalates ALLOW + requiresHumanApproval=true → REQUIRE_HUMAN.
    expect(d.outcome).toBe('REQUIRE_HUMAN');
    // The action must require human approval
    expect(d.actions.some(a => a.requiresHumanApproval)).toBe(true);
    expect(d.actions.some(a => a.type === 'ASSIGN_TASK')).toBe(true);
  });
});

describe('AI Act Constraint — edge cases', () => {
  test('No AI action fact → ALLOW (module not applicable)', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(undefined));
    expect(d.outcome).toBe('ALLOW');
    expect(d.explanation.appliedRules[0].ruleId).toBe('ai-act.not-applicable');
  });

  test('Unknown action class → REQUIRE_HUMAN (safe default)', async () => {
    const engine = makeEngine();
    const unknownFact: AIActionFact = {
      actionClass: 'some_future_action_class' as AIActionClass,
      isAutonomous: true,
      confidence: 0.9,
      agentId: 'test-agent',
    };
    const d = await engine.evaluate(makeContext(unknownFact));
    expect(d.outcome).toBe('REQUIRE_HUMAN');
    expect(d.explanation.appliedRules[0].ruleId).toBe('ai-act.unknown-class');
  });

  test('All denied actions produce non-empty explanations', async () => {
    const engine = makeEngine();
    const prohibited: AIActionClass[] = ['clinical_escalate', 'external_disclose', 'consent_change'];

    for (const cls of prohibited) {
      const d = await engine.evaluate(makeContext(makeAIFact(cls, true)));
      expect(d.explanation.summary).toBeTruthy();
      expect(d.explanation.appliedRules[0].reason).toContain('ADR-015');
    }
  });
});
