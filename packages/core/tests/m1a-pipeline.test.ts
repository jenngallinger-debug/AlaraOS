/**
 * Alara OS — M1a Integration Test: Event → Trigger → Rules Pipeline
 *
 * Proves the full M1a pipeline works end-to-end:
 *   Event fires → Trigger evaluates → Rule set selected → Rules Engine evaluates
 *   → Decision returned with explanation + recommended actions
 *
 * Also proves the Automynd adapter feeds into the pipeline correctly.
 */

import { TriggerEngine } from '../src/trigger-engine/engine';
import { TriggerRegistry } from '../src/trigger-engine/registry';
import { BUILT_IN_TRIGGERS } from '../src/trigger-engine/built-in-triggers';
import { RulesEngine } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_POLICY_MODULES, BUILT_IN_RULE_SETS } from '../src/rules-engine/built-in-policies';
import { FixtureAutomyndAdapter, FIXTURE_PATIENTS, FIXTURE_REFERRALS } from '../src/automynd-adapter/fixture-adapter';
import { DomainEvent, EventType } from '../src/events/types';
import { makeAlaraId } from '../src/shared/ids';
import { RuleContext } from '../src/rules-engine/types';

// ─── Setup ────────────────────────────────────────────────────────────────────

function buildPipeline() {
  const triggerRegistry = new TriggerRegistry();
  for (const t of BUILT_IN_TRIGGERS) triggerRegistry.register(t);

  const rulesRegistry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) rulesRegistry.registerRuleSet(rs);
  for (const m of BUILT_IN_POLICY_MODULES) rulesRegistry.registerPolicyModule(m);

  return {
    trigger: new TriggerEngine(triggerRegistry),
    rules: new RulesEngine(rulesRegistry),
    adapter: new FixtureAutomyndAdapter(),
  };
}

function makeEvent(type: string, payload: Record<string, unknown>): DomainEvent {
  return {
    id: 'evt-pipeline-test',
    tenantId: 'alara-home-care',
    streamId: makeAlaraId('00000000-0000-4000-8000-000000000099'),
    seq: 1,
    type: type as EventType,
    payload,
    actor: 'system',
    occurredAt: new Date(),
  };
}

// ─── Pipeline tests ───────────────────────────────────────────────────────────

describe('M1a Pipeline: Event → Trigger → Rules', () => {
  test('Patient created → intake trigger fires → intake rule evaluates → ALLOW + workflow action', async () => {
    const { trigger, rules } = buildPipeline();

    // 1. Event: patient object created
    const event = makeEvent('ObjectCreated', {
      objectType: 'Patient',
      state: 'created',
      attributes: { name: 'Samuel Brown' },
    });

    // 2. Trigger: evaluate event
    const firedTriggers = trigger.fired(event);
    expect(firedTriggers.length).toBeGreaterThan(0);

    const intakeTrigger = firedTriggers.find(t => t.targetRuleSetId === 'ruleset.intake');
    expect(intakeTrigger).toBeDefined();

    // 3. Rules: build context from the fired trigger + event
    const context: RuleContext = {
      tenantId: event.tenantId,
      actor: event.actor,
      eventType: event.type,
      eventPayload: event.payload as Record<string, unknown>,
      ruleSetId: intakeTrigger!.targetRuleSetId,
      objects: {},
    };

    const decision = await rules.evaluate(context);

    // 4. Assert decision
    expect(decision.outcome).toBe('ALLOW');
    expect(decision.actions.some(a => a.type === 'CREATE_WORKFLOW')).toBe(true);
    expect(decision.explanation.summary).toContain('Permitted');
  });

  test('Automynd referral → adapter → event → pipeline → ALLOW', async () => {
    const { trigger, rules, adapter } = buildPipeline();

    // 1. Adapter converts Automynd referral to payload
    const referral = FIXTURE_REFERRALS[0];
    const payload = await adapter.emitReferralObserved(referral);

    // 2. Event: referral observed
    const event = makeEvent('AutomyndReferralObserved', payload as unknown as Record<string, unknown>);

    // 3. Trigger evaluation
    const fired = trigger.fired(event);
    const referralTrigger = fired.find(t => t.triggerId === 'trigger.referral.observed');
    expect(referralTrigger).toBeDefined();

    // 4. Rules evaluation
    const context: RuleContext = {
      tenantId: event.tenantId,
      actor: event.actor,
      eventType: event.type,
      eventPayload: event.payload as Record<string, unknown>,
      ruleSetId: referralTrigger!.targetRuleSetId,
      objects: {},
    };
    const decision = await rules.evaluate(context);
    expect(decision.outcome).toBe('ALLOW');
  });

  test('Data integrity conflict → trigger fires → REQUIRE_HUMAN + FLAG_FOR_HUMAN action', async () => {
    const { trigger, rules, adapter } = buildPipeline();

    // 1. Adapter detects DOB mismatch (JV-002 scenario: Samuel Brown)
    const automyndPatient = FIXTURE_PATIENTS[0]; // Automynd: 1949-03-14
    const alaraAttributes = { name: 'Samuel Brown', dob: '1949-03-04' }; // Alara: 1949-03-04

    const integrityResult = adapter.checkDataIntegrity(automyndPatient, alaraAttributes);
    expect(integrityResult.hasConflict).toBe(true);

    // 2. Event: data integrity flagged
    const event = makeEvent('DataIntegrityFlagged', {
      conflictType: integrityResult.conflictType,
      conflictDetails: integrityResult.conflictDetails,
      objectId: 'patient-alara-uuid',
    });

    // 3. Trigger
    const fired = trigger.fired(event);
    const integrityTrigger = fired.find(t => t.triggerId === 'trigger.data.integrity.flagged');
    expect(integrityTrigger).toBeDefined();

    // 4. Rules — must route to human (ADR-001: Alara never overwrites Automynd)
    const context: RuleContext = {
      tenantId: event.tenantId,
      actor: event.actor,
      eventType: event.type,
      eventPayload: event.payload as Record<string, unknown>,
      ruleSetId: integrityTrigger!.targetRuleSetId,
      objects: {},
    };
    const decision = await rules.evaluate(context);

    expect(decision.outcome).toBe('REQUIRE_HUMAN');
    expect(decision.actions.some(a => a.type === 'FLAG_FOR_HUMAN')).toBe(true);

    // Verify ADR-001 language in the action payload
    const flagAction = decision.actions.find(a => a.type === 'FLAG_FOR_HUMAN');
    expect(flagAction?.payload?.rule).toContain('ADR-001');
  });

  test('Pipeline isolation: different tenants produce identical decisions', async () => {
    const { trigger, rules } = buildPipeline();

    const ctx1: RuleContext = { tenantId: 'tenant-A', actor: 'system', eventType: 'ObjectCreated', eventPayload: { objectType: 'Patient', state: 'created', attributes: {} }, ruleSetId: 'ruleset.intake', objects: {} };
    const ctx2: RuleContext = { ...ctx1, tenantId: 'tenant-B' };

    const d1 = await rules.evaluate(ctx1);
    const d2 = await rules.evaluate(ctx2);

    expect(d1.outcome).toBe(d2.outcome);
    expect(d1.actions.length).toBe(d2.actions.length);
  });
});
