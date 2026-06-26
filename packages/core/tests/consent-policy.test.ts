/**
 * Alara OS — Consent Policy Module Tests
 *
 * Proves:
 *   ✓ Active consent with correct recipient and permission → ALLOW
 *   ✓ Revoked consent → DENY
 *   ✓ Expired consent → DENY
 *   ✓ Pending consent → DENY
 *   ✓ Permission type not in scope → DENY
 *   ✓ Recipient mismatch → DENY
 *   ✓ Missing consent → DENY
 *   ✓ Every denial includes an explanation
 *   ✓ Wildcard recipient (*) allows any actor
 */

import { RulesEngine } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS } from '../src/rules-engine/built-in-policies';
import { ConsentPolicyModule } from '../src/rules-engine/policies/consent-policy';
import { ConsentFact, ConsentPermissionType } from '../src/rules-engine/policies/context-types';
import { RuleContext } from '../src/rules-engine/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConsent(overrides: Partial<ConsentFact> = {}): ConsentFact {
  return {
    consentId: 'consent-001',
    subjectId: 'patient-uuid-001',
    grantorId: 'family-member-001',
    recipientId: 'care-guide-001',
    permissionTypes: ['read', 'update', 'communicate'],
    effectiveDate: '2026-01-01',
    version: 1,
    status: 'active',
    ...overrides,
  };
}

function makeContext(
  consent: ConsentFact | undefined,
  requiredPermission?: ConsentPermissionType,
  actor = 'care-guide-001',
): RuleContext {
  return {
    tenantId: 'tenant-1',
    actor,
    eventType: 'ObjectCreated',
    eventPayload: { objectType: 'Patient', state: 'created', attributes: {} },
    ruleSetId: 'ruleset.intake',
    objects: consent ? { consent } : {},
    metadata: requiredPermission ? { requiredPermission } : {},
  };
}

function makeEngine(): RulesEngine {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registry.registerPolicyModule(ConsentPolicyModule);
  return new RulesEngine(registry);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Consent Policy Module — ALLOW cases', () => {
  test('Active consent with matching recipient → ALLOW', async () => {
    const engine = makeEngine();
    const decision = await engine.evaluate(makeContext(makeConsent()));
    expect(decision.outcome).toBe('ALLOW');
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.valid');
  });

  test('Active consent with wildcard recipient → ALLOW for any actor', async () => {
    const engine = makeEngine();
    const consent = makeConsent({ recipientId: '*' });
    const decision = await engine.evaluate(makeContext(consent, undefined, 'any-actor-xyz'));
    expect(decision.outcome).toBe('ALLOW');
  });

  test('Required permission in consent scope → ALLOW', async () => {
    const engine = makeEngine();
    const decision = await engine.evaluate(makeContext(makeConsent(), 'read'));
    expect(decision.outcome).toBe('ALLOW');
  });

  test('No required permission specified → ALLOW (scope not checked)', async () => {
    const engine = makeEngine();
    const decision = await engine.evaluate(makeContext(makeConsent()));
    expect(decision.outcome).toBe('ALLOW');
  });
});

describe('Consent Policy Module — DENY cases', () => {
  test('Missing consent → DENY with explanation', async () => {
    const engine = makeEngine();
    const decision = await engine.evaluate(makeContext(undefined));
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.reasoning.some(r => r.includes('No consent record'))).toBe(true);
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.missing');
  });

  test('Revoked consent → DENY', async () => {
    const engine = makeEngine();
    const consent = makeConsent({ status: 'revoked', revokedAt: '2026-05-01T00:00:00Z' });
    const decision = await engine.evaluate(makeContext(consent));
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.revoked');
    // Explanation must reference the revocation
    expect(decision.explanation.reasoning.some(r => r.includes('revoked'))).toBe(true);
  });

  test('Expired consent → DENY', async () => {
    const engine = makeEngine();
    const consent = makeConsent({
      expirationDate: '2020-01-01', // past
      status: 'active',
    });
    const decision = await engine.evaluate(makeContext(consent));
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.expired');
  });

  test('Pending consent → DENY', async () => {
    const engine = makeEngine();
    const consent = makeConsent({ status: 'pending' });
    const decision = await engine.evaluate(makeContext(consent));
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.not-active');
  });

  test('Recipient mismatch → DENY', async () => {
    const engine = makeEngine();
    const consent = makeConsent({ recipientId: 'different-actor' });
    const decision = await engine.evaluate(makeContext(consent, undefined, 'care-guide-001'));
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.recipient-mismatch');
  });

  test('Required permission not in consent scope → DENY', async () => {
    const engine = makeEngine();
    const consent = makeConsent({ permissionTypes: ['read'] }); // no 'disclose_external'
    const decision = await engine.evaluate(makeContext(consent, 'disclose_external'));
    expect(decision.outcome).toBe('DENY');
    expect(decision.explanation.appliedRules[0].ruleId).toBe('consent.permission-not-in-scope');
  });

  test('Missing consent for external disclosure → DENY (AC: missing consent denies external disclosure)', async () => {
    const engine = makeEngine();
    const decision = await engine.evaluate(makeContext(undefined, 'disclose_external'));
    expect(decision.outcome).toBe('DENY');
    // Explanation present
    expect(decision.explanation.appliedRules.length).toBeGreaterThan(0);
    expect(decision.explanation.summary).toBeTruthy();
  });
});

describe('Consent Policy Module — explanation completeness', () => {
  test('Every denial has a non-empty explanation with reasoning', async () => {
    const engine = makeEngine();
    const denyCases = [
      makeContext(undefined),
      makeContext(makeConsent({ status: 'revoked', revokedAt: '2026-01-01' })),
      makeContext(makeConsent({ expirationDate: '2020-01-01', status: 'active' })),
      makeContext(makeConsent({ status: 'pending' })),
      makeContext(makeConsent({ recipientId: 'wrong' })),
      makeContext(makeConsent({ permissionTypes: ['read'] }), 'communicate'),
    ];

    for (const ctx of denyCases) {
      const decision = await engine.evaluate(ctx);
      expect(decision.outcome).toBe('DENY');
      expect(decision.explanation.summary).toBeTruthy();
      expect(decision.explanation.appliedRules.length).toBeGreaterThan(0);
      expect(decision.explanation.appliedRules[0].reason).toBeTruthy();
    }
  });
});
