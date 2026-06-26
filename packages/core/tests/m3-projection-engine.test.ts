/**
 * Alara OS — M3 Projection Engine Tests
 *
 * Acceptance criteria:
 *   AC-1:  Timeline projection builds from events.
 *   AC-2:  Timeline projection rebuilds identically from replay.
 *   AC-3:  Digital Care Twin v0 builds from canonical inputs.
 *   AC-4:  Digital Care Twin does not store clinical document content.
 *   AC-5:  Referral Source Strength computes from events.
 *   AC-6:  Relationship Health computes from events.
 *   AC-7:  Projection requires dependency declaration.
 *   AC-8:  Projection deletion loses no truth — rebuild restores it.
 *   AC-9:  Projection cannot mutate canonical objects.
 *   AC-10: Projection cannot trigger side effects.
 *   AC-11: Projection records method version.
 *   AC-12: Projection records confidence.
 *   AC-13: Projection records source event IDs.
 *   AC-14: Projection supports invalidation and rebuild.
 *   AC-15: All tests pass.
 */

import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRebuilder } from '../src/projection-engine/rebuilder';
import { registerAllProjections } from '../src/projection-engine';
import { TimelineProjectionDefinition, TimelineInput } from '../src/projection-engine/projections/timeline';
import { DigitalCareTwinProjectionDefinition, DigitalCareTwinInput } from '../src/projection-engine/projections/digital-care-twin';
import { ReferralSourceStrengthProjectionDefinition, ReferralSourceStrengthInput, RelationshipHealthProjectionDefinition, RelationshipHealthInput } from '../src/projection-engine/projections/referral-and-relationship';
import { ProjectionDefinition, ProjectionDependency, TimelineValue, DigitalCareTwinValue, ReferralSourceStrengthValue, RelationshipHealthValue, StoredProjection } from '../src/projection-engine/types';
import { ProjectionInputAssembler } from '../src/projection-engine/engine';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { DomainEvent, EventType } from '../src/events/types';
import { AlaraId } from '../src/shared/types';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup helpers ─────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const PATIENT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');

function makeEvent(type: string, payload: Record<string, unknown> = {}, streamId: AlaraId = PATIENT_ID): DomainEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT,
    streamId,
    seq: 1,
    type: type as EventType,
    payload,
    actor: 'system',
    occurredAt: new Date(),
  };
}

function makeEngine() {
  const inMemStore = new InMemoryStore();
  const db = inMemStore as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const registry = new ProjectionRegistry();
  registerAllProjections(registry);
  const projectionStore = new InMemoryProjectionStore();
  const engine = new ProjectionEngine(registry, projectionStore, eventStore);
  const rebuilder = new ProjectionRebuilder(engine, projectionStore);
  return { engine, registry, projectionStore, eventStore, rebuilder, inMemStore, db };
}

// ─── Simple assemblers for tests ───────────────────────────────────────────────

function timelineAssembler(events: DomainEvent[], subjectType = 'Patient'): ProjectionInputAssembler<TimelineInput> {
  return {
    async assemble(subjectId) { return { subjectId, subjectType, events }; },
    async sourceEventIds() { return events.map(e => e.id); },
  };
}

function twinAssembler(input: Omit<DigitalCareTwinInput, 'patientId'> & { patientId?: string }): ProjectionInputAssembler<DigitalCareTwinInput> {
  return {
    async assemble(subjectId) { return { patientId: subjectId, ...input }; },
    async sourceEventIds() { return input.events.map(e => e.id); },
  };
}

function referralAssembler(events: DomainEvent[]): ProjectionInputAssembler<ReferralSourceStrengthInput> {
  return {
    async assemble(subjectId) { return { referralSourceId: subjectId, events }; },
    async sourceEventIds() { return events.map(e => e.id); },
  };
}

function relHealthAssembler(events: DomainEvent[]): ProjectionInputAssembler<RelationshipHealthInput> {
  return {
    async assemble(subjectId) { return { relationshipId: subjectId, events }; },
    async sourceEventIds() { return events.map(e => e.id); },
  };
}

// ─── AC-1: Timeline builds from events ───────────────────────────────────────

describe('AC-1: Timeline projection builds from events', () => {
  test('Empty event stream → empty timeline', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([]));
    expect(result.built).toBe(true);
    if (!result.built) return;
    const value = result.projection.value as unknown as TimelineValue;
    expect(value.eventCount).toBe(0);
    expect(value.entries).toHaveLength(0);
  });

  test('Multiple events → ordered timeline entries', async () => {
    const { engine } = makeEngine();
    const events = [
      makeEvent('ObjectCreated', { objectType: 'Patient', state: 'created', attributes: {} }),
      makeEvent('WorkflowStarted', { name: 'Intake', templateId: 'template.intake' }),
      makeEvent('PromiseCreated', { description: 'Alara will respond' }),
    ];
    const result = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler(events));
    expect(result.built).toBe(true);
    if (!result.built) return;
    const value = result.projection.value as unknown as TimelineValue;
    expect(value.eventCount).toBe(3);
    expect(value.entries[0].eventType).toBe('ObjectCreated');
    expect(value.entries[1].summary).toContain('Intake');
  });

  test('Summary is generated for each event type', async () => {
    const { engine } = makeEngine();
    const events = [
      makeEvent('TaskCreated', { title: 'Acknowledge Referral', taskType: 'AcknowledgeReferral' }),
      makeEvent('PromiseKept', { description: 'call tomorrow' }),
      makeEvent('WorkflowCompleted', {}),
    ];
    const result = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler(events));
    if (!result.built) throw new Error('build failed');
    const value = result.projection.value as unknown as TimelineValue;
    expect(value.entries.some(e => e.summary.includes('Task'))).toBe(true);
    expect(value.entries.some(e => e.summary.includes('Promise kept'))).toBe(true);
  });
});

// ─── AC-2: Timeline rebuilds identically ──────────────────────────────────────

describe('AC-2: Timeline projection rebuilds identically from replay', () => {
  test('Build and rebuild produce identical values', async () => {
    const { engine, projectionStore, rebuilder } = makeEngine();
    const events = [
      makeEvent('ObjectCreated', { objectType: 'Patient', state: 'created', attributes: {} }),
      makeEvent('WorkflowStarted', { name: 'Intake', templateId: 'template.intake' }),
    ];
    const assembler = timelineAssembler(events);
    const r1 = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(r1.built).toBe(true);

    // Simulate discarding projection cache
    projectionStore.clear();

    // Rebuild from same canonical inputs
    const r2 = await rebuilder.rebuild(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(r2.built).toBe(true);
    if (!r1.built || !r2.built) return;

    const v1 = r1.projection.value as unknown as TimelineValue;
    const v2 = r2.projection.value as unknown as TimelineValue;
    expect(v1.eventCount).toBe(v2.eventCount);
    expect(v1.entries.map(e => e.eventType)).toEqual(v2.entries.map(e => e.eventType));
  });

  test('Build number increments on rebuild', async () => {
    const { engine } = makeEngine();
    const assembler = timelineAssembler([makeEvent('ObjectCreated', {})]);
    const r1 = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    const r2 = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    if (!r1.built || !r2.built) return;
    expect(r2.projection.metadata.buildNumber).toBe(r1.projection.metadata.buildNumber + 1);
  });
});

// ─── AC-3: Digital Care Twin builds from canonical inputs ─────────────────────

describe('AC-3: Digital Care Twin v0 builds from canonical inputs', () => {
  test('Builds with patient attributes + external refs + workflows', async () => {
    const { engine } = makeEngine();
    const input: Omit<DigitalCareTwinInput, 'patientId'> = {
      patientAttributes: { name: 'Samuel Brown', programContext: 'EEOICPA' },
      externalReferences: [{ system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }],
      activeWorkflows: [{ workflowId: 'wf-001', templateId: 'template.intake', status: 'active', currentStepId: 'step.intake.acknowledge' }],
      openTasks: [{ taskId: 'task-001', taskType: 'AcknowledgeReferral', ownerId: 'care-guide-001', dueAt: null }],
      openPromises: [{ promiseId: 'p-001', description: 'Alara will respond', dueAt: new Date().toISOString() }],
      events: [makeEvent('ObjectCreated', { objectType: 'Patient', state: 'created', attributes: {} })],
    };

    const result = await engine.build(TENANT, 'DigitalCareTwin', String(PATIENT_ID), twinAssembler(input));
    expect(result.built).toBe(true);
    if (!result.built) return;

    const value = result.projection.value as unknown as DigitalCareTwinValue;
    expect(value.patientId).toBe(String(PATIENT_ID));
    expect(value.externalReferences).toHaveLength(1);
    expect(value.activeWorkflows).toHaveLength(1);
    expect(value.openTasks).toHaveLength(1);
    expect(value.openPromises).toHaveLength(1);
    expect(value.disclaimer).toBe('computed-projection-advisory-only');
  });
});

// ─── AC-4: Digital Care Twin excludes clinical content ────────────────────────

describe('AC-4: Digital Care Twin does not store clinical document content (ADR-001)', () => {
  test('Clinical content keys are stripped from patient attributes', async () => {
    const { engine } = makeEngine();
    const input: Omit<DigitalCareTwinInput, 'patientId'> = {
      patientAttributes: {
        name: 'Samuel Brown',
        visitNotes: 'Patient presented with SOB...', // clinical — must be stripped
        assessmentText: 'OASIS assessment result', // clinical — must be stripped
        planOfCare: 'Full 485 plan',               // clinical — must be stripped
        programContext: 'EEOICPA',                  // non-clinical — must be kept
      },
      externalReferences: [],
      activeWorkflows: [],
      openTasks: [],
      openPromises: [],
      events: [],
    };

    const result = await engine.build(TENANT, 'DigitalCareTwin', String(PATIENT_ID), twinAssembler(input));
    if (!result.built) throw new Error('build failed');

    const value = result.projection.value as unknown as DigitalCareTwinValue;
    expect(value.patientAttributes.visitNotes).toBeUndefined();
    expect(value.patientAttributes.assessmentText).toBeUndefined();
    expect(value.patientAttributes.planOfCare).toBeUndefined();
    expect(value.patientAttributes.name).toBe('Samuel Brown');
    expect(value.patientAttributes.programContext).toBe('EEOICPA');
  });

  test('Digital Care Twin disclaimer is always advisory', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'DigitalCareTwin', String(PATIENT_ID), twinAssembler({ patientAttributes: {}, externalReferences: [], activeWorkflows: [], openTasks: [], openPromises: [], events: [] }));
    if (!result.built) return;
    expect((result.projection.value as unknown as DigitalCareTwinValue).disclaimer).toBe('computed-projection-advisory-only');
  });
});

// ─── AC-5: Referral Source Strength ──────────────────────────────────────────

describe('AC-5: Referral Source Strength computes from events', () => {
  test('No events → insufficient_data trend, score 0', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'ReferralSourceStrength', 'source-001', referralAssembler([]));
    if (!result.built) throw new Error('build failed');
    const value = result.projection.value as unknown as ReferralSourceStrengthValue;
    expect(value.trend).toBe('insufficient_data');
    expect(value.totalReferrals).toBe(0);
  });

  test('Multiple referrals with kept promises → improving trend', async () => {
    const { engine } = makeEngine();
    const events = [
      makeEvent('AutomyndReferralObserved', {}),
      makeEvent('AutomyndReferralObserved', {}),
      makeEvent('AutomyndReferralObserved', {}),
      makeEvent('WorkflowCompleted', {}),
      makeEvent('PromiseKept', {}),
      makeEvent('PromiseKept', {}),
    ];
    const result = await engine.build(TENANT, 'ReferralSourceStrength', 'source-001', referralAssembler(events));
    if (!result.built) throw new Error('build failed');
    const value = result.projection.value as unknown as ReferralSourceStrengthValue;
    expect(value.totalReferrals).toBe(3);
    expect(value.keptPromises).toBe(2);
    expect(value.strengthScore).toBeGreaterThan(0.5);
    expect(['improving', 'stable']).toContain(value.trend);
  });

  test('Data integrity flags lower strength score', async () => {
    const { engine } = makeEngine();
    const cleanEvents = [makeEvent('AutomyndReferralObserved', {}), makeEvent('AutomyndReferralObserved', {}), makeEvent('AutomyndReferralObserved', {})];
    const flaggedEvents = [...cleanEvents, makeEvent('DataIntegrityFlagged', {}), makeEvent('DataIntegrityFlagged', {})];

    const r1 = await engine.build(TENANT, 'ReferralSourceStrength', 'source-clean', referralAssembler(cleanEvents));
    const r2 = await engine.build(TENANT, 'ReferralSourceStrength', 'source-flagged', referralAssembler(flaggedEvents));
    if (!r1.built || !r2.built) throw new Error('build failed');

    const v1 = r1.projection.value as unknown as ReferralSourceStrengthValue;
    const v2 = r2.projection.value as unknown as ReferralSourceStrengthValue;
    expect(v1.strengthScore).toBeGreaterThan(v2.strengthScore);
  });
});

// ─── AC-6: Relationship Health ────────────────────────────────────────────────

describe('AC-6: Relationship Health computes from events', () => {
  test('No events → unknown health label', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'RelationshipHealth', 'rel-001', relHealthAssembler([]));
    if (!result.built) throw new Error('build failed');
    const value = result.projection.value as unknown as RelationshipHealthValue;
    expect(value.healthLabel).toBe('unknown');
    expect(value.healthScore).toBe(0.5); // neutral
  });

  test('Kept promises + completed tasks → healthy', async () => {
    const { engine } = makeEngine();
    const events = Array(5).fill(null).map(() => makeEvent('PromiseKept', {}))
      .concat(Array(3).fill(null).map(() => makeEvent('TaskCompleted', {})));
    const result = await engine.build(TENANT, 'RelationshipHealth', 'rel-001', relHealthAssembler(events));
    if (!result.built) throw new Error('build failed');
    const value = result.projection.value as unknown as RelationshipHealthValue;
    expect(value.healthLabel).toBe('healthy');
    expect(value.healthScore).toBeGreaterThan(0.7);
  });

  test('Missed promises → at_risk', async () => {
    const { engine } = makeEngine();
    const events = [
      makeEvent('PromiseMissed', {}), makeEvent('PromiseMissed', {}),
      makeEvent('DataIntegrityFlagged', {}),
    ];
    const result = await engine.build(TENANT, 'RelationshipHealth', 'rel-001', relHealthAssembler(events));
    if (!result.built) throw new Error('build failed');
    const value = result.projection.value as unknown as RelationshipHealthValue;
    expect(value.healthLabel).toBe('at_risk');
  });
});

// ─── AC-7: Dependency declaration required ────────────────────────────────────

describe('AC-7: Projection requires dependency declaration (ADR-016)', () => {
  test('Projection with no dependencies → build fails', async () => {
    const { engine, registry } = makeEngine();

    // Override Timeline definition with a version that has no dependencies
    const noDepsDefinition: ProjectionDefinition<TimelineInput, TimelineValue> = {
      ...TimelineProjectionDefinition,
      type: 'Timeline', // Can't register twice, so test the definition directly
      declareDependencies: () => [], // Returns empty — ADR-016 violation
    };

    // Test via direct engine call with a custom registry
    const emptyRegistry = new ProjectionRegistry();
    emptyRegistry.register(noDepsDefinition);
    const store = new InMemoryProjectionStore();
    const inMemStore = new InMemoryStore();
    const db = inMemStore as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const testEngine = new ProjectionEngine(emptyRegistry, store, eventStore);

    const result = await testEngine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([]));
    expect(result.built).toBe(false);
    if (result.built) return;
    expect(result.reason).toContain('ADR-016');
    expect(result.reason).toContain('no canonical inputs');
  });

  test('Projection with missing method version → build fails', async () => {
    const badDef: ProjectionDefinition<TimelineInput, TimelineValue> = {
      ...TimelineProjectionDefinition,
      methodVersion: '', // ADR-016 violation
    };

    const registry = new ProjectionRegistry();
    registry.register(badDef);
    const store = new InMemoryProjectionStore();
    const inMemStore = new InMemoryStore();
    const db = inMemStore as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const testEngine = new ProjectionEngine(registry, store, eventStore);

    const result = await testEngine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([]));
    expect(result.built).toBe(false);
    if (result.built) return;
    expect(result.reason).toContain('method version');
  });

  test('Every built-in projection has declared dependencies', () => {
    const definitions = [
      TimelineProjectionDefinition,
      DigitalCareTwinProjectionDefinition,
      ReferralSourceStrengthProjectionDefinition,
      RelationshipHealthProjectionDefinition,
    ];
    for (const def of definitions) {
      const deps = def.declareDependencies('test-subject');
      expect(deps.length).toBeGreaterThan(0);
    }
  });
});

// ─── AC-8: Deletion loses no truth ───────────────────────────────────────────

describe('AC-8: Projection deletion loses no truth — rebuild restores it', () => {
  test('Clear store → rebuild → identical result', async () => {
    const { engine, projectionStore, rebuilder } = makeEngine();
    const events = [
      makeEvent('ObjectCreated', { objectType: 'Patient', state: 'created', attributes: {} }),
      makeEvent('WorkflowStarted', { name: 'Intake', templateId: 'template.intake' }),
      makeEvent('PromiseCreated', { description: 'Will respond within 4h' }),
    ];
    const assembler = timelineAssembler(events);

    const original = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(original.built).toBe(true);
    if (!original.built) return;

    // Discard the projection
    projectionStore.clear();
    expect(projectionStore.size()).toBe(0);

    // Rebuild from same canonical inputs
    const rebuilt = await rebuilder.rebuild(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;

    // Values must be identical
    const ov = original.projection.value as unknown as TimelineValue;
    const rv = rebuilt.projection.value as unknown as TimelineValue;
    expect(ov.eventCount).toBe(rv.eventCount);
    expect(ov.entries.map(e => e.eventType)).toEqual(rv.entries.map(e => e.eventType));
  });
});

// ─── AC-9: Cannot mutate canonical objects ────────────────────────────────────

describe('AC-9: Projection cannot mutate canonical objects', () => {
  test('build() is a pure function — no mutation of input', async () => {
    const events = [makeEvent('ObjectCreated', { objectType: 'Patient', state: 'created', attributes: {} })];
    const input: TimelineInput = { subjectId: String(PATIENT_ID), subjectType: 'Patient', events };
    const originalEventCount = input.events.length;

    TimelineProjectionDefinition.build(input);

    // Input is unchanged
    expect(input.events.length).toBe(originalEventCount);
    expect(events[0].type).toBe('ObjectCreated');
  });

  test('Projection build result has no side effects on event store', async () => {
    const { engine, inMemStore } = makeEngine();
    const eventsBefore = inMemStore.events.length;

    await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([
      makeEvent('ObjectCreated', { objectType: 'Patient', state: 'created', attributes: {} }),
    ]));

    // Only ProjectionRebuilt event should be added (emitted by engine, not by the projection definition)
    const eventsAfter = inMemStore.events.length;
    const newEvents = inMemStore.events.slice(eventsBefore);
    expect(newEvents.every(e => e.type === 'ProjectionRebuilt' || e.type === 'ProjectionFailed')).toBe(true);
  });
});

// ─── AC-10: Cannot trigger side effects ──────────────────────────────────────

describe('AC-10: Projection cannot trigger side effects', () => {
  test('Projection definition build() returns only value — no commands', () => {
    const events = [makeEvent('WorkflowStarted', {})];
    const input: TimelineInput = { subjectId: 'test', subjectType: 'Patient', events };
    const result = TimelineProjectionDefinition.build(input);

    // Result only has value, confidence, inferenceBasis, aiInvolved, sourceEventIds, freshUntil
    expect('value' in result).toBe(true);
    expect('confidence' in result).toBe(true);
    // No workflow/task/communication commands
    expect('commands' in result).toBe(false);
    expect('actions' in result).toBe(false);
    expect('mutations' in result).toBe(false);
  });

  test('Engine only emits Projection event types', async () => {
    const { engine, inMemStore } = makeEngine();
    await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([makeEvent('ObjectCreated', {})]));
    await engine.invalidate(TENANT, 'Timeline', String(PATIENT_ID), 'test invalidation');

    const projectionEvents = inMemStore.events.filter(e =>
      e.type.startsWith('Projection')
    );
    const allAllowed = projectionEvents.every(e =>
      ['ProjectionRebuilt', 'ProjectionInvalidated', 'ProjectionFailed'].includes(e.type)
    );
    expect(allAllowed).toBe(true);
    // No workflow / task / communication events from the engine
    const forbidden = inMemStore.events.filter(e =>
      e.type.startsWith('Workflow') || e.type.startsWith('Task') || e.type.startsWith('Promise')
    );
    expect(forbidden).toHaveLength(0);
  });
});

// ─── AC-11: Records method version ───────────────────────────────────────────

describe('AC-11: Projection records method version', () => {
  test('Stored projection includes method version', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([]));
    if (!result.built) return;
    expect(result.projection.metadata.methodVersion).toBe('1.0.0');
    expect(result.projection.metadata.methodName).toBe('timeline-event-fold');
  });

  test('Digital Care Twin records its method version', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'DigitalCareTwin', String(PATIENT_ID), twinAssembler({ patientAttributes: {}, externalReferences: [], activeWorkflows: [], openTasks: [], openPromises: [], events: [] }));
    if (!result.built) return;
    expect(result.projection.metadata.methodVersion).toBe('0.1.0');
  });
});

// ─── AC-12: Records confidence ────────────────────────────────────────────────

describe('AC-12: Projection records confidence', () => {
  test('Timeline confidence is "high" (fact-based)', async () => {
    const { engine } = makeEngine();
    const result = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([makeEvent('ObjectCreated', {})]));
    if (!result.built) return;
    expect(result.projection.metadata.confidence).toBe('high');
  });

  test('Referral strength confidence scales with data volume', async () => {
    const { engine } = makeEngine();

    const low = await engine.build(TENANT, 'ReferralSourceStrength', 'source-a', referralAssembler([]));
    const mod = await engine.build(TENANT, 'ReferralSourceStrength', 'source-b', referralAssembler([makeEvent('AutomyndReferralObserved', {})]));
    const high = await engine.build(TENANT, 'ReferralSourceStrength', 'source-c', referralAssembler(Array(3).fill(null).map(() => makeEvent('AutomyndReferralObserved', {}))));

    if (!low.built || !mod.built || !high.built) return;
    expect(low.projection.metadata.confidence).toBe('low');
    expect(mod.projection.metadata.confidence).toBe('moderate');
    expect(high.projection.metadata.confidence).toBe('high');
  });
});

// ─── AC-13: Records source event IDs ─────────────────────────────────────────

describe('AC-13: Projection records source event IDs', () => {
  test('Source event IDs match the events used to build', async () => {
    const { engine } = makeEngine();
    const events = [
      makeEvent('ObjectCreated', {}),
      makeEvent('WorkflowStarted', {}),
    ];
    const result = await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler(events));
    if (!result.built) return;
    const storedIds = result.projection.metadata.sourceEventIds;
    const inputIds = events.map(e => e.id);
    for (const id of inputIds) {
      expect(storedIds).toContain(id);
    }
  });
});

// ─── AC-14: Invalidation and rebuild ─────────────────────────────────────────

describe('AC-14: Projection supports invalidation and rebuild', () => {
  test('After invalidation, get() returns null', async () => {
    const { engine, projectionStore } = makeEngine();
    await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([makeEvent('ObjectCreated', {})]));

    expect(await projectionStore.get(TENANT, 'Timeline', String(PATIENT_ID))).not.toBeNull();

    await engine.invalidate(TENANT, 'Timeline', String(PATIENT_ID), 'New event arrived');

    expect(await projectionStore.get(TENANT, 'Timeline', String(PATIENT_ID))).toBeNull();
  });

  test('Invalidation emits ProjectionInvalidated event', async () => {
    const { engine, inMemStore } = makeEngine();
    await engine.build(TENANT, 'Timeline', String(PATIENT_ID), timelineAssembler([]));
    await engine.invalidate(TENANT, 'Timeline', String(PATIENT_ID), 'test');

    const invalidated = inMemStore.events.find(e => e.type === 'ProjectionInvalidated');
    expect(invalidated).toBeDefined();
    expect((invalidated?.payload as Record<string, unknown>)?.projectionType).toBe('Timeline');
  });

  test('Rebuild after invalidation produces correct result', async () => {
    const { engine, rebuilder } = makeEngine();
    const events = [makeEvent('ObjectCreated', {}), makeEvent('WorkflowStarted', {})];
    const assembler = timelineAssembler(events);

    await engine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    await engine.invalidate(TENANT, 'Timeline', String(PATIENT_ID), 'test');

    const result = await rebuilder.rebuild(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(result.built).toBe(true);
    if (!result.built) return;
    expect((result.projection.value as unknown as TimelineValue).eventCount).toBe(2);
  });
});
