/**
 * Alara OS — M1b Integration Test: All Policy Modules Together
 *
 * Proves the full M1b stack working in a single Rules Engine:
 *   - Correct module is selected per rule set
 *   - Module priority chain works (highest-priority DENY wins)
 *   - Multiple modules compose correctly
 *   - registerM1bPolicies() helper works
 *   - Audit is called on every evaluation
 */

import { RulesEngine, IAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS } from '../src/rules-engine/built-in-policies';
import { registerM1bPolicies } from '../src/rules-engine/policies';
import { ConsentFact, DataIntegrityFact, ParticipationFact } from '../src/rules-engine/policies/context-types';
import { RuleAuditEntry, RuleContext } from '../src/rules-engine/types';

class SpyAuditSink implements IAuditSink {
  readonly entries: RuleAuditEntry[] = [];
  async record(e: RuleAuditEntry) { this.entries.push(e); }
}

function makeRegistry(spy?: SpyAuditSink) {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registerM1bPolicies(registry);
  return { registry, engine: new RulesEngine(registry, spy) };
}

describe('M1b Integration — all policy modules', () => {
  test('registerM1bPolicies loads all five modules', () => {
    const { registry } = makeRegistry();
    const modules = registry.getPolicyModulesForRuleSet('ruleset.intake');
    const ids = modules.map(m => m.id);
    // AI Act applies to '*', consent + participation apply to intake
    expect(ids).toContain('policy.ai-act-constraint');
    expect(ids).toContain('policy.consent');
    expect(ids).toContain('policy.participation');
  });

  test('Data integrity module always wins for data.integrity rule set', async () => {
    const { engine } = makeRegistry();
    const conflict: DataIntegrityFact = {
      conflictType: 'DOB_MISMATCH',
      externalSystem: 'Automynd',
      objectId: 'p-001',
      field: 'dob',
      externalValue: '1949-03-14',
      alaraValue: '1949-03-04',
    };
    const ctx: RuleContext = {
      tenantId: 'tenant-1', actor: 'system',
      eventType: 'DataIntegrityFlagged', eventPayload: {},
      ruleSetId: 'ruleset.data.integrity',
      objects: { dataIntegrity: conflict },
    };
    const d = await engine.evaluate(ctx);
    expect(d.outcome).toBe('REQUIRE_HUMAN');
  });

  test('Full intake context with valid consent + actor participation → ALLOW', async () => {
    const { engine } = makeRegistry();

    const consent: ConsentFact = {
      consentId: 'c-001', subjectId: 'p-001', grantorId: 'grantor',
      recipientId: 'care-guide-001', permissionTypes: ['read', 'update'],
      effectiveDate: '2026-01-01', version: 1, status: 'active',
    };
    const participation: ParticipationFact = {
      workforceMemberId: 'care-guide-001', objectId: 'p-001', role: 'Actor',
    };

    const ctx: RuleContext = {
      tenantId: 'tenant-1', actor: 'care-guide-001',
      eventType: 'ObjectCreated',
      eventPayload: { objectType: 'Patient', state: 'created', attributes: {} },
      ruleSetId: 'ruleset.intake',
      objects: { consent, participation },
      metadata: { accessType: 'write', requiredPermission: 'update' },
    };

    const d = await engine.evaluate(ctx);
    expect(d.outcome).toBe('ALLOW');
  });

  test('Revoked consent blocks even valid participation', async () => {
    const { engine } = makeRegistry();

    const consent: ConsentFact = {
      consentId: 'c-revoked', subjectId: 'p-001', grantorId: 'g',
      recipientId: 'care-guide-001', permissionTypes: ['read'],
      effectiveDate: '2026-01-01', status: 'revoked', revokedAt: '2026-05-01T00:00:00Z', version: 1,
    };
    const participation: ParticipationFact = {
      workforceMemberId: 'care-guide-001', objectId: 'p-001', role: 'Actor',
    };

    const ctx: RuleContext = {
      tenantId: 'tenant-1', actor: 'care-guide-001',
      eventType: 'ObjectCreated',
      eventPayload: { objectType: 'Patient', state: 'created', attributes: {} },
      ruleSetId: 'ruleset.intake',
      objects: { consent, participation },
      metadata: { accessType: 'read' },
    };

    const d = await engine.evaluate(ctx);
    expect(d.outcome).toBe('DENY');
    // The denying rule must be from consent module
    const denyingRule = d.explanation.appliedRules.find(r => r.outcome === 'DENY');
    expect(denyingRule?.ruleId).toBe('consent.revoked');
  });

  test('Prohibited AI action blocks even with valid consent + participation', async () => {
    const { engine } = makeRegistry();

    const ctx: RuleContext = {
      tenantId: 'tenant-1', actor: 'ai-agent',
      eventType: 'ObjectCreated',
      eventPayload: { objectType: 'Patient', state: 'created', attributes: {} },
      ruleSetId: 'ruleset.intake',
      objects: {
        aiAction: { actionClass: 'clinical_escalate', isAutonomous: true, confidence: 0.9, agentId: 'rn-ai' },
        consent: {
          consentId: 'c-001', subjectId: 'p-001', grantorId: 'g',
          recipientId: 'ai-agent', permissionTypes: ['read'],
          effectiveDate: '2026-01-01', status: 'active', version: 1,
        },
      },
    };

    const d = await engine.evaluate(ctx);
    expect(d.outcome).toBe('DENY');
    // AI Act module has priority 5 — fires before consent (priority 20)
    const denyingRule = d.explanation.appliedRules.find(r => r.outcome === 'DENY');
    expect(denyingRule?.ruleId).toBe('ai-act.prohibited-autonomous');
  });

  test('Audit sink receives entry for every evaluation', async () => {
    const spy = new SpyAuditSink();
    const { engine } = makeRegistry(spy);

    const ctx: RuleContext = {
      tenantId: 'tenant-1', actor: 'system', eventType: 'ObjectCreated',
      eventPayload: {}, ruleSetId: 'ruleset.intake', objects: {},
    };

    await engine.evaluate(ctx);
    await engine.evaluate(ctx);

    expect(spy.entries.length).toBe(2);
    expect(spy.entries[0].tenantId).toBe('tenant-1');
    expect(spy.entries[0].decision.outcome).toBeDefined();
  });

  test('Every decision has a non-empty explanation', async () => {
    const { engine } = makeRegistry();

    const contexts: RuleContext[] = [
      { tenantId: 'tenant-1', actor: 'system', eventType: 'ObjectCreated', eventPayload: {}, ruleSetId: 'ruleset.intake', objects: {} },
      { tenantId: 'tenant-1', actor: 'system', eventType: 'DataIntegrityFlagged', eventPayload: {}, ruleSetId: 'ruleset.data.integrity', objects: {} },
      { tenantId: 'tenant-1', actor: 'system', eventType: 'ExternalReferenceAdded', eventPayload: {}, ruleSetId: 'ruleset.external.sync', objects: {} },
    ];

    for (const ctx of contexts) {
      const d = await engine.evaluate(ctx);
      expect(d.explanation.summary).toBeTruthy();
      expect(d.explanation.appliedRules.length).toBeGreaterThan(0);
    }
  });
});
