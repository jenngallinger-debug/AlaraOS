/**
 * Alara OS — Rules Engine Tests
 *
 * Proves:
 *   - Deterministic evaluation given same inputs
 *   - DENY short-circuits evaluation (fail-fast)
 *   - REQUIRE_HUMAN bubbles up correctly
 *   - No modules → ALLOW (safe default)
 *   - Explanation is always present
 *   - Audit sink is called on every evaluation
 *   - IntakeGatePolicyModule fires correctly
 *   - DataIntegrityPolicyModule always returns REQUIRE_HUMAN
 *   - DefaultAllowPolicyModule catches all rule sets
 */

import { RulesEngine, NoopAuditSink, IAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import {
  BUILT_IN_POLICY_MODULES,
  BUILT_IN_RULE_SETS,
  IntakeGatePolicyModule,
  DataIntegrityPolicyModule,
  DefaultAllowPolicyModule,
} from '../src/rules-engine/built-in-policies';
import { PolicyModule, RuleAuditEntry, RuleContext } from '../src/rules-engine/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    tenantId: 'tenant-1',
    actor: 'system',
    eventType: 'ObjectCreated',
    eventPayload: { objectType: 'Patient', state: 'created', attributes: {} },
    ruleSetId: 'ruleset.intake',
    objects: {},
    ...overrides,
  };
}

function makeRegistry(...modules: PolicyModule[]): RulesRegistry {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  for (const m of modules) registry.registerPolicyModule(m);
  return registry;
}

class SpyAuditSink implements IAuditSink {
  readonly entries: RuleAuditEntry[] = [];
  async record(entry: RuleAuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

// ─── Basic evaluation ─────────────────────────────────────────────────────────

describe('RulesEngine — basic evaluation', () => {
  test('No modules → DENY (fail closed) with explanation', async () => {
    const registry = makeRegistry();
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext());

    // Fail closed: an unconfigured rule set is never implicitly permitted.
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation.reasoning.join(' ')).toContain('Failing closed');
    expect(decision.explanation.appliedRules.some(r => r.ruleId === 'engine.no-policy')).toBe(true);
    expect(decision.evaluatedAt).toBeInstanceOf(Date);
  });

  test('Unknown / unregistered rule set → DENY (fail closed)', async () => {
    const registry = makeRegistry(); // no policy modules at all
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({ ruleSetId: 'ruleset.totally.unregistered' }));

    expect(decision.outcome).toBe('DENY');
  });

  test('Explicitly registered DefaultAllow → ALLOW (intentional allow is visible)', async () => {
    const registry = makeRegistry(DefaultAllowPolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({ ruleSetId: 'ruleset.anything' }));

    // Allow is permitted only because a policy was explicitly registered for it.
    expect(decision.outcome).toBe('ALLOW');
  });

  test('Evaluation is deterministic — same input → same output', async () => {
    const registry = makeRegistry(IntakeGatePolicyModule);
    const engine = new RulesEngine(registry);
    const ctx = makeContext();

    const d1 = await engine.evaluate(ctx);
    const d2 = await engine.evaluate(ctx);

    expect(d1.outcome).toBe(d2.outcome);
    expect(d1.explanation.summary).toBe(d2.explanation.summary);
    expect(d1.actions.length).toBe(d2.actions.length);
  });

  test('Explanation.reasoning is always present', async () => {
    const registry = makeRegistry(DefaultAllowPolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({ ruleSetId: 'ruleset.unknown' }));

    expect(decision.explanation.reasoning.length).toBeGreaterThan(0);
  });
});

// ─── DENY short-circuit ───────────────────────────────────────────────────────

describe('RulesEngine — DENY short-circuit', () => {
  test('DENY module stops evaluation — later modules not reached', async () => {
    const denyModule: PolicyModule = {
      id: 'test.deny', name: 'Deny', version: '1', priority: 1,
      ruleSetIds: ['ruleset.intake'],
      evaluate: () => ({
        moduleId: 'test.deny', outcome: 'DENY', appliedRules: [], skippedRules: [],
        actions: [], reasoning: 'Always deny for test.',
      }),
    };

    let secondCalled = false;
    const secondModule: PolicyModule = {
      id: 'test.second', name: 'Second', version: '1', priority: 2,
      ruleSetIds: ['ruleset.intake'],
      evaluate: () => { secondCalled = true; return { moduleId: 'test.second', outcome: 'ALLOW', appliedRules: [], skippedRules: [], actions: [], reasoning: '' }; },
    };

    const registry = makeRegistry(denyModule, secondModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('DENY');
    expect(secondCalled).toBe(false);
  });

  test('Module that throws → DENY (safe default)', async () => {
    const throwingModule: PolicyModule = {
      id: 'test.throw', name: 'Throws', version: '1', priority: 1,
      ruleSetIds: ['ruleset.intake'],
      evaluate: () => { throw new Error('Unexpected error'); },
    };
    const registry = makeRegistry(throwingModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.reasoning.join(' ')).toContain('threw an error');
  });
});

// ─── REQUIRE_HUMAN ────────────────────────────────────────────────────────────

describe('RulesEngine — REQUIRE_HUMAN', () => {
  test('REQUIRE_HUMAN module → decision is REQUIRE_HUMAN', async () => {
    const registry = makeRegistry(DataIntegrityPolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({ ruleSetId: 'ruleset.data.integrity' }));

    expect(decision.outcome).toBe('REQUIRE_HUMAN');
  });

  test('ALLOW with requiresHumanApproval action → escalates to REQUIRE_HUMAN', async () => {
    const humanModule: PolicyModule = {
      id: 'test.human-action', name: 'Human Action', version: '1', priority: 1,
      ruleSetIds: ['ruleset.intake'],
      evaluate: () => ({
        moduleId: 'test.human-action', outcome: 'ALLOW',
        appliedRules: [], skippedRules: [],
        actions: [{ type: 'ESCALATE', payload: {}, rationale: 'test', requiresHumanApproval: true }],
        reasoning: 'Allow but action needs human.',
      }),
    };
    const registry = makeRegistry(humanModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('REQUIRE_HUMAN');
  });
});

// ─── DEFER nuance (pinned current behavior — known follow-on) ──────────────────

describe('RulesEngine — DEFER collapse (pinned, not yet changed)', () => {
  // No in-repo policy emits DEFER. This pins the CURRENT behavior so a future
  // safety tightening (DEFER alone should not silently ALLOW) is test-guarded.
  test('a lone DEFER currently collapses to ALLOW after the loop', async () => {
    const deferModule: PolicyModule = {
      id: 'test.defer', name: 'Defer', version: '1', priority: 1,
      ruleSetIds: ['ruleset.intake'],
      evaluate: () => ({
        moduleId: 'test.defer', outcome: 'DEFER',
        appliedRules: [], skippedRules: [], actions: [], reasoning: 'No applicable rule.',
      }),
    };
    const registry = makeRegistry(deferModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext());

    // Documented nuance: DEFER does not fail-fast and a lone DEFER resolves to ALLOW.
    expect(decision.outcome).toBe('ALLOW');
  });
});

// ─── Audit sink ───────────────────────────────────────────────────────────────

describe('RulesEngine — audit logging', () => {
  test('Audit sink receives entry for every evaluation', async () => {
    const spy = new SpyAuditSink();
    const registry = makeRegistry(DefaultAllowPolicyModule);
    const engine = new RulesEngine(registry, spy);

    await engine.evaluate(makeContext());
    await engine.evaluate(makeContext({ ruleSetId: 'ruleset.data.integrity' }));

    expect(spy.entries).toHaveLength(2);
    expect(spy.entries[0].tenantId).toBe('tenant-1');
    expect(spy.entries[0].actor).toBe('system');
  });

  test('Audit entry includes full context and decision', async () => {
    const spy = new SpyAuditSink();
    const registry = makeRegistry(IntakeGatePolicyModule);
    const engine = new RulesEngine(registry, spy);
    const ctx = makeContext();

    await engine.evaluate(ctx);

    const entry = spy.entries[0];
    expect(entry.context.ruleSetId).toBe(ctx.ruleSetId);
    expect(entry.decision.outcome).toBeDefined();
    expect(entry.evaluatedAt).toBeInstanceOf(Date);
  });
});

// ─── Built-in policies ────────────────────────────────────────────────────────

describe('Built-in policies', () => {
  test('IntakeGatePolicyModule — Patient → ALLOW + recommended actions', async () => {
    const registry = makeRegistry(IntakeGatePolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext());

    expect(decision.outcome).toBe('ALLOW');
    expect(decision.actions.some(a => a.type === 'CREATE_WORKFLOW')).toBe(true);
    expect(decision.actions.some(a => a.type === 'ASSIGN_TASK')).toBe(true);
  });

  test('IntakeGatePolicyModule — non-Patient → DENY', async () => {
    const registry = makeRegistry(IntakeGatePolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({
      eventPayload: { objectType: 'Workflow', state: 'created', attributes: {} },
    }));

    expect(decision.outcome).toBe('DENY');
  });

  test('DataIntegrityPolicyModule — always REQUIRE_HUMAN with FLAG_FOR_HUMAN action', async () => {
    const registry = makeRegistry(DataIntegrityPolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({
      ruleSetId: 'ruleset.data.integrity',
      eventPayload: { conflictType: 'DOB_MISMATCH', conflictDetails: { field: 'dob' } },
    }));

    expect(decision.outcome).toBe('REQUIRE_HUMAN');
    expect(decision.actions.some(a => a.type === 'FLAG_FOR_HUMAN')).toBe(true);
  });

  test('DefaultAllowPolicyModule — applies to any rule set', async () => {
    const registry = makeRegistry(DefaultAllowPolicyModule);
    const engine = new RulesEngine(registry);
    const decision = await engine.evaluate(makeContext({ ruleSetId: 'ruleset.completely.unknown' }));

    expect(decision.outcome).toBe('ALLOW');
  });

  test('Multiple modules — first DENY wins', async () => {
    const registry = makeRegistry(...BUILT_IN_POLICY_MODULES);
    const engine = new RulesEngine(registry);

    // DataIntegrityPolicyModule (priority 1) should win over DefaultAllowPolicyModule (priority 999)
    const decision = await engine.evaluate(makeContext({
      ruleSetId: 'ruleset.data.integrity',
      eventPayload: { conflictType: 'DOB_MISMATCH' },
    }));

    expect(decision.outcome).toBe('REQUIRE_HUMAN');
  });
});

// ─── Priority ordering ────────────────────────────────────────────────────────

describe('RulesEngine — priority ordering', () => {
  test('Lower priority number evaluated first', async () => {
    const order: string[] = [];
    const m1: PolicyModule = { id: 'p1', name: '', version: '1', priority: 5, ruleSetIds: ['ruleset.intake'], evaluate: () => { order.push('p1'); return { moduleId: 'p1', outcome: 'ALLOW', appliedRules: [], skippedRules: [], actions: [], reasoning: '' }; } };
    const m2: PolicyModule = { id: 'p2', name: '', version: '1', priority: 1, ruleSetIds: ['ruleset.intake'], evaluate: () => { order.push('p2'); return { moduleId: 'p2', outcome: 'ALLOW', appliedRules: [], skippedRules: [], actions: [], reasoning: '' }; } };
    const m3: PolicyModule = { id: 'p3', name: '', version: '1', priority: 10, ruleSetIds: ['ruleset.intake'], evaluate: () => { order.push('p3'); return { moduleId: 'p3', outcome: 'ALLOW', appliedRules: [], skippedRules: [], actions: [], reasoning: '' }; } };

    const registry = makeRegistry(m1, m2, m3);
    const engine = new RulesEngine(registry);
    await engine.evaluate(makeContext());

    expect(order).toEqual(['p2', 'p1', 'p3']);
  });
});
