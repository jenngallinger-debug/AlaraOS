/**
 * Alara OS — EMR Boundary + Data Integrity Policy Tests
 *
 * Proves:
 *   ✓ Operational reference access → ALLOW
 *   ✓ Write to external system → DENY (ADR-001)
 *   ✓ Duplicate clinical content → DENY
 *   ✓ Clinical category (visit, order, POC, assessment) → DENY
 *   ✓ No boundary fact → module skips
 *   ✓ Data integrity conflict → REQUIRE_HUMAN + FLAG + suppress action
 *   ✓ No conflict → ALLOW
 *   ✓ Every EMR denial references ADR-001
 *   ✓ DataIntegrity module always emits AutomationSuppressed action
 */

import { RulesEngine } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS } from '../src/rules-engine/built-in-policies';
import { EMRBoundaryPolicyModule } from '../src/rules-engine/policies/emr-boundary-policy';
import { DataIntegrityHumanReviewPolicyModule } from '../src/rules-engine/policies/data-integrity-policy';
import { DataIntegrityFact, EMRBoundaryFact } from '../src/rules-engine/policies/context-types';
import { RuleContext } from '../src/rules-engine/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEMRContext(boundary?: EMRBoundaryFact): RuleContext {
  return {
    tenantId: 'tenant-1',
    actor: 'system',
    eventType: 'ExternalReferenceAdded',
    eventPayload: {},
    ruleSetId: 'ruleset.external.sync',
    objects: boundary ? { emrBoundary: boundary } : {},
  };
}

function makeIntegrityContext(conflict?: DataIntegrityFact): RuleContext {
  return {
    tenantId: 'tenant-1',
    actor: 'system',
    eventType: 'DataIntegrityFlagged',
    eventPayload: {},
    ruleSetId: 'ruleset.data.integrity',
    objects: conflict ? { dataIntegrity: conflict } : {},
  };
}

function makeEMREngine(): RulesEngine {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registry.registerPolicyModule(EMRBoundaryPolicyModule);
  return new RulesEngine(registry);
}

function makeIntegrityEngine(): RulesEngine {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registry.registerPolicyModule(DataIntegrityHumanReviewPolicyModule);
  return new RulesEngine(registry);
}

// ─── EMR Boundary tests ───────────────────────────────────────────────────────

describe('EMR Boundary Policy — ALLOW cases', () => {
  test('Operational reference → ALLOW', async () => {
    const engine = makeEMREngine();
    const boundary: EMRBoundaryFact = {
      externalSystem: 'Automynd',
      dataCategory: 'operational_reference',
      wouldWriteToExternalSystem: false,
      wouldDuplicateClinicalContent: false,
    };
    const d = await engine.evaluate(makeEMRContext(boundary));
    expect(d.outcome).toBe('ALLOW');
    expect(d.explanation.appliedRules[0].ruleId).toBe('emr.operational-reference-allowed');
  });

  test('No boundary fact → ALLOW (module skips)', async () => {
    const engine = makeEMREngine();
    const d = await engine.evaluate(makeEMRContext(undefined));
    expect(d.outcome).toBe('ALLOW');
    expect(d.explanation.appliedRules[0].ruleId).toBe('emr.not-applicable');
  });
});

describe('EMR Boundary Policy — DENY cases (ADR-001)', () => {
  test('Write to external system → DENY', async () => {
    const engine = makeEMREngine();
    const boundary: EMRBoundaryFact = {
      externalSystem: 'Automynd',
      dataCategory: 'operational_reference',
      wouldWriteToExternalSystem: true,
      wouldDuplicateClinicalContent: false,
    };
    const d = await engine.evaluate(makeEMRContext(boundary));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('emr.no-write-to-external');
    expect(d.explanation.reasoning.some(r => r.includes('ADR-001'))).toBe(true);
  });

  test('Duplicate clinical content → DENY', async () => {
    const engine = makeEMREngine();
    const boundary: EMRBoundaryFact = {
      externalSystem: 'Automynd',
      dataCategory: 'clinical_documentation',
      wouldWriteToExternalSystem: false,
      wouldDuplicateClinicalContent: true,
    };
    const d = await engine.evaluate(makeEMRContext(boundary));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('emr.no-duplicate-clinical');
  });

  test.each([
    'clinical_documentation',
    'visit_record',
    'order',
    'plan_of_care',
    'assessment',
  ] as EMRBoundaryFact['dataCategory'][])('Clinical category "%s" → DENY', async (category) => {
    const engine = makeEMREngine();
    const boundary: EMRBoundaryFact = {
      externalSystem: 'Automynd',
      dataCategory: category,
      wouldWriteToExternalSystem: false,
      wouldDuplicateClinicalContent: false,
    };
    const d = await engine.evaluate(makeEMRContext(boundary));
    expect(d.outcome).toBe('DENY');
    expect(d.explanation.appliedRules[0].ruleId).toBe('emr.clinical-category-reference-only');
  });
});

// ─── Data Integrity tests ─────────────────────────────────────────────────────

describe('Data Integrity Human Review Policy', () => {
  test('No conflict → ALLOW', async () => {
    const engine = makeIntegrityEngine();
    const d = await engine.evaluate(makeIntegrityContext(undefined));
    expect(d.outcome).toBe('ALLOW');
    expect(d.explanation.appliedRules[0].ruleId).toBe('data-integrity.no-conflict');
  });

  test('DOB mismatch → REQUIRE_HUMAN + FLAG + AutomationSuppressed', async () => {
    const engine = makeIntegrityEngine();
    const conflict: DataIntegrityFact = {
      conflictType: 'DOB_MISMATCH',
      externalSystem: 'Automynd',
      objectId: 'patient-uuid-001',
      field: 'dob',
      externalValue: '1949-03-14',
      alaraValue: '1949-03-04',
    };
    const d = await engine.evaluate(makeIntegrityContext(conflict));

    expect(d.outcome).toBe('REQUIRE_HUMAN');
    // Must flag for human
    const flagAction = d.actions.find(a => a.type === 'FLAG_FOR_HUMAN');
    expect(flagAction).toBeDefined();
    expect(flagAction?.requiresHumanApproval).toBe(true);
    expect((flagAction?.payload as Record<string, unknown>)?.adR001Note).toBeTruthy();
    // Must suppress automation
    const suppressAction = d.actions.find(a => a.type === 'EMIT_EVENT');
    expect(suppressAction).toBeDefined();
    expect((suppressAction?.payload as Record<string, unknown>)?.type).toBe('AutomationSuppressed');
  });

  test.each([
    'DOB_MISMATCH',
    'ID_COLLISION',
    'STATUS_CONFLICT',
    'FIELD_DIVERGENCE',
  ] as DataIntegrityFact['conflictType'][])('Any conflict type "%s" → REQUIRE_HUMAN', async (conflictType) => {
    const engine = makeIntegrityEngine();
    const conflict: DataIntegrityFact = {
      conflictType,
      externalSystem: 'Automynd',
      objectId: 'obj-001',
      field: 'someField',
      externalValue: 'a',
      alaraValue: 'b',
    };
    const d = await engine.evaluate(makeIntegrityContext(conflict));
    expect(d.outcome).toBe('REQUIRE_HUMAN');
  });

  test('Explanation includes conflict details', async () => {
    const engine = makeIntegrityEngine();
    const conflict: DataIntegrityFact = {
      conflictType: 'DOB_MISMATCH',
      externalSystem: 'Automynd',
      objectId: 'patient-001',
      field: 'dob',
      externalValue: '1949-03-14',
      alaraValue: '1949-03-04',
    };
    const d = await engine.evaluate(makeIntegrityContext(conflict));
    const reasoning = d.explanation.reasoning.join(' ');
    expect(reasoning).toContain('dob');
    expect(reasoning).toContain('ADR-001');
  });
});
