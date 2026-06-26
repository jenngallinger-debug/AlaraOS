/**
 * Alara OS — Participation Policy Module Tests
 *
 * Proves:
 *   ✓ Actor role → ALLOW read + write
 *   ✓ Owner role → ALLOW read + write
 *   ✓ Covering role (active) → ALLOW
 *   ✓ Covering role (expired) → DENY
 *   ✓ Stakeholder → ALLOW read, DENY write
 *   ✓ Informed → DENY read (receives output only)
 *   ✓ None role → DENY
 *   ✓ Missing participation fact → DENY
 *   ✓ Covering access logs an audit event action
 *   ✓ Every denial has an explanation
 */

import { RulesEngine } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS } from '../src/rules-engine/built-in-policies';
import { ParticipationPolicyModule } from '../src/rules-engine/policies/participation-policy';
import { ParticipationFact, ParticipationRole } from '../src/rules-engine/policies/context-types';
import { RuleContext } from '../src/rules-engine/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeParticipation(role: ParticipationRole, overrides: Partial<ParticipationFact> = {}): ParticipationFact {
  return {
    workforceMemberId: 'wm-001',
    objectId: 'patient-uuid-001',
    role,
    ...overrides,
  };
}

function makeContext(
  participation: ParticipationFact | undefined,
  accessType: 'read' | 'write' = 'read',
): RuleContext {
  return {
    tenantId: 'tenant-1',
    actor: 'wm-001',
    eventType: 'ObjectCreated',
    eventPayload: {},
    ruleSetId: 'ruleset.intake',
    objects: participation ? { participation } : {},
    metadata: { accessType },
  };
}

function makeEngine(): RulesEngine {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registry.registerPolicyModule(ParticipationPolicyModule);
  return new RulesEngine(registry);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Participation Policy — ALLOW cases', () => {
  test('Actor role → ALLOW read', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('Actor'), 'read'));
    expect(d.outcome).toBe('ALLOW');
  });

  test('Actor role → ALLOW write', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('Actor'), 'write'));
    expect(d.outcome).toBe('ALLOW');
  });

  test('Owner role → ALLOW read + write', async () => {
    const engine = makeEngine();
    const r = await engine.evaluate(makeContext(makeParticipation('Owner'), 'read'));
    const w = await engine.evaluate(makeContext(makeParticipation('Owner'), 'write'));
    expect(r.outcome).toBe('ALLOW');
    expect(w.outcome).toBe('ALLOW');
  });

  test('Covering role (not expired) → ALLOW + emits CoveringAccessUsed event', async () => {
    const engine = makeEngine();
    const future = new Date(Date.now() + 86_400_000).toISOString(); // tomorrow
    const d = await engine.evaluate(
      makeContext(makeParticipation('Covering', { coverageExpiresAt: future }), 'write'),
    );
    expect(d.outcome).toBe('ALLOW');
    const emitAction = d.actions.find(a => a.type === 'EMIT_EVENT');
    expect(emitAction).toBeDefined();
    expect((emitAction?.payload as Record<string, unknown>)?.type).toBe('CoveringAccessUsed');
  });

  test('Covering role with no expiry → ALLOW', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('Covering'), 'write'));
    expect(d.outcome).toBe('ALLOW');
  });

  test('Stakeholder → ALLOW read', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('Stakeholder'), 'read'));
    expect(d.outcome).toBe('ALLOW');
  });
});

describe('Participation Policy — DENY cases', () => {
  test('Missing participation → DENY', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(undefined));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('participation.missing');
  });

  test('None role → DENY', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('None')));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('participation.no-role');
  });

  test('Covering role expired → DENY', async () => {
    const engine = makeEngine();
    const past = new Date(Date.now() - 86_400_000).toISOString(); // yesterday
    const d = await engine.evaluate(
      makeContext(makeParticipation('Covering', { coverageExpiresAt: past }), 'read'),
    );
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('participation.coverage-expired');
  });

  test('Stakeholder → DENY write', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('Stakeholder'), 'write'));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('participation.insufficient-role');
  });

  test('Informed → DENY read (output only)', async () => {
    const engine = makeEngine();
    const d = await engine.evaluate(makeContext(makeParticipation('Informed'), 'read'));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('participation.insufficient-role');
  });

  test('Every denial has explanation with non-empty reasoning', async () => {
    const engine = makeEngine();
    const denyCases = [
      makeContext(undefined),
      makeContext(makeParticipation('None')),
      makeContext(makeParticipation('Stakeholder'), 'write'),
      makeContext(makeParticipation('Informed'), 'read'),
    ];
    for (const ctx of denyCases) {
      const d = await engine.evaluate(ctx);
      expect(d.outcome).toBe('DENY');
      expect(d.explanation.appliedRules[0].reason).toBeTruthy();
    }
  });
});
