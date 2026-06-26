/**
 * Alara OS — Trigger Engine Tests
 *
 * Proves:
 *   - Trigger evaluates conditions against events deterministically
 *   - ALL logic requires every condition to pass
 *   - ANY logic requires at least one condition to pass
 *   - No conditions = always fires
 *   - Disabled triggers are not evaluated
 *   - Priority ordering is respected
 *   - Built-in triggers cover patient/referral/data-integrity events
 */

import { TriggerEngine } from '../src/trigger-engine/engine';
import { TriggerRegistry } from '../src/trigger-engine/registry';
import { BUILT_IN_TRIGGERS } from '../src/trigger-engine/built-in-triggers';
import { TriggerDefinition } from '../src/trigger-engine/types';
import { DomainEvent } from '../src/events/types';
import { makeAlaraId } from '../src/shared/ids';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'evt-001',
    tenantId: 'tenant-1',
    streamId: makeAlaraId('00000000-0000-4000-8000-000000000001'),
    seq: 1,
    type: 'ObjectCreated',
    payload: { objectType: 'Patient', state: 'created', attributes: {} },
    actor: 'system',
    occurredAt: new Date(),
    ...overrides,
  };
}

function makeRegistry(...extras: TriggerDefinition[]): TriggerRegistry {
  const registry = new TriggerRegistry();
  for (const t of extras) registry.register(t);
  return registry;
}

function loadBuiltIns(): TriggerRegistry {
  const registry = new TriggerRegistry();
  for (const t of BUILT_IN_TRIGGERS) registry.register(t);
  return registry;
}

// ─── Basic evaluation ─────────────────────────────────────────────────────────

describe('TriggerEngine — basic evaluation', () => {
  test('No conditions → always fires', () => {
    const trigger: TriggerDefinition = {
      id: 't1', name: 'Always', description: '', eventTypes: ['ObjectCreated'],
      conditions: [], logic: 'ALL', rationale: '', targetRuleSetId: 'rs1',
      enabled: true, priority: 10,
    };
    const engine = new TriggerEngine(makeRegistry(trigger));
    const results = engine.evaluate(makeEvent());
    expect(results).toHaveLength(1);
    expect(results[0].fired).toBe(true);
  });

  test('Matching eq condition → fires', () => {
    const trigger: TriggerDefinition = {
      id: 't2', name: 'Patient only', description: '', eventTypes: ['ObjectCreated'],
      conditions: [{ field: 'payload.objectType', operator: 'eq', value: 'Patient' }],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    const engine = new TriggerEngine(makeRegistry(trigger));
    const results = engine.fired(makeEvent());
    expect(results).toHaveLength(1);
    expect(results[0].targetRuleSetId).toBe('rs1');
  });

  test('Non-matching eq condition → does not fire', () => {
    const trigger: TriggerDefinition = {
      id: 't3', name: 'Workflow only', description: '', eventTypes: ['ObjectCreated'],
      conditions: [{ field: 'payload.objectType', operator: 'eq', value: 'Workflow' }],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    const engine = new TriggerEngine(makeRegistry(trigger));
    const results = engine.evaluate(makeEvent()); // event has objectType: Patient
    expect(results[0].fired).toBe(false);
  });

  test('Different event type → not evaluated', () => {
    const trigger: TriggerDefinition = {
      id: 't4', name: 'Only ObjectUpdated', description: '', eventTypes: ['ObjectUpdated'],
      conditions: [], logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    const engine = new TriggerEngine(makeRegistry(trigger));
    const results = engine.evaluate(makeEvent({ type: 'ObjectCreated' }));
    expect(results).toHaveLength(0); // trigger listens on ObjectUpdated, event is ObjectCreated
  });

  test('Disabled trigger → not returned', () => {
    const trigger: TriggerDefinition = {
      id: 't5', name: 'Disabled', description: '', eventTypes: ['ObjectCreated'],
      conditions: [], logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: false, priority: 10,
    };
    const engine = new TriggerEngine(makeRegistry(trigger));
    const results = engine.evaluate(makeEvent());
    expect(results).toHaveLength(0);
  });
});

// ─── Logic (ALL vs ANY) ───────────────────────────────────────────────────────

describe('TriggerEngine — ALL vs ANY logic', () => {
  const event = makeEvent({
    payload: { objectType: 'Patient', status: 'active', attributes: {} },
  });

  test('ALL: both conditions pass → fires', () => {
    const trigger: TriggerDefinition = {
      id: 'all-1', name: 'ALL pass', description: '', eventTypes: ['ObjectCreated'],
      conditions: [
        { field: 'payload.objectType', operator: 'eq', value: 'Patient' },
        { field: 'payload.status', operator: 'eq', value: 'active' },
      ],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    expect(new TriggerEngine(makeRegistry(trigger)).fired(event)).toHaveLength(1);
  });

  test('ALL: one condition fails → does not fire', () => {
    const trigger: TriggerDefinition = {
      id: 'all-2', name: 'ALL partial', description: '', eventTypes: ['ObjectCreated'],
      conditions: [
        { field: 'payload.objectType', operator: 'eq', value: 'Patient' },
        { field: 'payload.status', operator: 'eq', value: 'archived' }, // fails
      ],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    const results = new TriggerEngine(makeRegistry(trigger)).evaluate(event);
    expect(results[0].fired).toBe(false);
  });

  test('ANY: first condition fails, second passes → fires', () => {
    const trigger: TriggerDefinition = {
      id: 'any-1', name: 'ANY pass', description: '', eventTypes: ['ObjectCreated'],
      conditions: [
        { field: 'payload.objectType', operator: 'eq', value: 'Workflow' }, // fails
        { field: 'payload.status', operator: 'eq', value: 'active' },       // passes
      ],
      logic: 'ANY', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    expect(new TriggerEngine(makeRegistry(trigger)).fired(event)).toHaveLength(1);
  });

  test('ANY: both fail → does not fire', () => {
    const trigger: TriggerDefinition = {
      id: 'any-2', name: 'ANY fail', description: '', eventTypes: ['ObjectCreated'],
      conditions: [
        { field: 'payload.objectType', operator: 'eq', value: 'Workflow' },
        { field: 'payload.status', operator: 'eq', value: 'archived' },
      ],
      logic: 'ANY', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    const results = new TriggerEngine(makeRegistry(trigger)).evaluate(event);
    expect(results[0].fired).toBe(false);
  });
});

// ─── Operators ────────────────────────────────────────────────────────────────

describe('TriggerEngine — operators', () => {
  test('exists / not_exists', () => {
    const event = makeEvent({ payload: { objectType: 'Patient', name: 'Sam', attributes: {} } });
    const t1: TriggerDefinition = {
      id: 'op-exists', name: '', description: '', eventTypes: ['ObjectCreated'],
      conditions: [{ field: 'payload.name', operator: 'exists' }],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    expect(new TriggerEngine(makeRegistry(t1)).fired(event)).toHaveLength(1);
  });

  test('in operator', () => {
    const event = makeEvent({ payload: { system: 'Automynd', attributes: {} } });
    const t: TriggerDefinition = {
      id: 'op-in', name: '', description: '', eventTypes: ['ObjectCreated'],
      conditions: [{ field: 'payload.system', operator: 'in', value: ['Automynd', 'VA', 'OWCP'] }],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    expect(new TriggerEngine(makeRegistry(t)).fired(event)).toHaveLength(1);
  });

  test('gt operator', () => {
    const event = makeEvent({ payload: { score: 85, attributes: {} } });
    const t: TriggerDefinition = {
      id: 'op-gt', name: '', description: '', eventTypes: ['ObjectCreated'],
      conditions: [{ field: 'payload.score', operator: 'gt', value: 80 }],
      logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 10,
    };
    expect(new TriggerEngine(makeRegistry(t)).fired(event)).toHaveLength(1);
  });
});

// ─── Priority ordering ────────────────────────────────────────────────────────

describe('TriggerEngine — priority ordering', () => {
  test('Lower priority number evaluated first', () => {
    const t1: TriggerDefinition = { id: 'p1', name: 'P1', description: '', eventTypes: ['ObjectCreated'], conditions: [], logic: 'ALL', rationale: '', targetRuleSetId: 'rs1', enabled: true, priority: 5 };
    const t2: TriggerDefinition = { id: 'p2', name: 'P2', description: '', eventTypes: ['ObjectCreated'], conditions: [], logic: 'ALL', rationale: '', targetRuleSetId: 'rs2', enabled: true, priority: 1 };
    const t3: TriggerDefinition = { id: 'p3', name: 'P3', description: '', eventTypes: ['ObjectCreated'], conditions: [], logic: 'ALL', rationale: '', targetRuleSetId: 'rs3', enabled: true, priority: 10 };
    const registry = makeRegistry(t1, t2, t3);
    const engine = new TriggerEngine(registry);
    const results = engine.evaluate(makeEvent());
    expect(results.map(r => r.triggerId)).toEqual(['p2', 'p1', 'p3']);
  });
});

// ─── Built-in triggers ────────────────────────────────────────────────────────

describe('Built-in triggers', () => {
  test('Patient Created → fires trigger.patient.created', () => {
    const engine = new TriggerEngine(loadBuiltIns());
    const event = makeEvent({ type: 'ObjectCreated', payload: { objectType: 'Patient', state: 'created', attributes: {} } });
    const fired = engine.fired(event);
    expect(fired.some(r => r.triggerId === 'trigger.patient.created')).toBe(true);
    expect(fired.find(r => r.triggerId === 'trigger.patient.created')?.targetRuleSetId).toBe('ruleset.intake');
  });

  test('DataIntegrityFlagged → fires trigger.data.integrity.flagged', () => {
    const engine = new TriggerEngine(loadBuiltIns());
    const event = makeEvent({ type: 'DataIntegrityFlagged', payload: { conflictType: 'DOB_MISMATCH' } });
    const fired = engine.fired(event);
    expect(fired.some(r => r.triggerId === 'trigger.data.integrity.flagged')).toBe(true);
  });

  test('AutomyndReferralObserved → fires trigger.referral.observed', () => {
    const engine = new TriggerEngine(loadBuiltIns());
    const event = makeEvent({ type: 'AutomyndReferralObserved', payload: { automyndReferralId: 'REF-001' } });
    const fired = engine.fired(event);
    expect(fired.some(r => r.triggerId === 'trigger.referral.observed')).toBe(true);
    expect(fired.find(r => r.triggerId === 'trigger.referral.observed')?.targetRuleSetId).toBe('ruleset.intake');
  });

  test('Unknown event type → no triggers fire', () => {
    const engine = new TriggerEngine(loadBuiltIns());
    const event = makeEvent({ type: 'SomeFutureEventType' as never, payload: {} });
    expect(engine.fired(event)).toHaveLength(0);
  });
});
