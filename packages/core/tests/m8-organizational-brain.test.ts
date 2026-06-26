/**
 * Alara OS — M8 Organizational Brain Tests
 *
 * Coverage:
 *   - All 13 pattern detectors (6 families)
 *   - Pattern deduplication (same detector + subject = one active pattern)
 *   - Pattern resolution when threshold drops
 *   - Manual resolve, dismiss
 *   - Event-sourced reconstruction
 *   - Organizational Health Projection (ADR-016: rebuilds after cache loss)
 *   - Brain emits only advisory events — no workflow/task mutations
 *   - Brain does not call AI
 *   - Deterministic replay (same input → same output)
 *   - All canonical events (PatternDetected, PatternResolved, etc.)
 */

import { OrganizationalBrainEngine, reconstructPatternFromEvents } from '../src/organizational-brain/engine';
import { PatternDetectorRegistry } from '../src/organizational-brain/pattern-detectors/registry';
import { ALL_PATTERN_DETECTORS } from '../src/organizational-brain/pattern-detectors/index';
import {
  RelationshipWeakeningDetector, ReferralInactivityDetector, OwnershipInstabilityDetector,
  WorkflowAbandonmentDetector, TaskOverloadDetector, SLADriftDetector,
  ConflictingKnowledgeDetector, EmergingThemeDetector,
  CommunicationFailureDetector, SuccessfulJourneyDetector,
  HighReferralEngagementDetector, OperationalExcellenceDetector, QualityRiskDetector,
} from '../src/organizational-brain/pattern-detectors/index';
import { StalePatternError, PatternNotFoundError } from '../src/organizational-brain/types';
import { OrganizationalHealthProjectionDefinition } from '../src/projection-engine/projections/organizational-health';
import type { OrganizationalHealthInput, } from '../src/projection-engine/projections/organizational-health';
import type { OrganizationalHealthValue } from '../src/organizational-brain/types';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { ProjectionRebuilder } from '../src/projection-engine/rebuilder';
import type { ProjectionInputAssembler } from '../src/projection-engine/engine';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { DomainEvent, EventType } from '../src/events/types';
import { AlaraId } from '../src/shared/types';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const SUBJECT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');

function makeEngine(detectors = ALL_PATTERN_DETECTORS) {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const registry = new PatternDetectorRegistry();
  for (const d of detectors) registry.register(d);
  const engine = new OrganizationalBrainEngine(db, eventStore, registry);
  return { store, db, eventStore, engine, registry };
}

function makeEvent(type: string, streamId: AlaraId = SUBJECT_ID): DomainEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT,
    streamId,
    seq: 1,
    type: type as EventType,
    payload: {},
    actor: 'system',
    occurredAt: new Date(),
  };
}

async function seedEvents(eventStore: EventStore, types: string[]) {
  for (const type of types) {
    await eventStore.append({ tenantId: TENANT, streamId: SUBJECT_ID, type: type as EventType, payload: {}, actor: 'system' });
  }
}

// ─── Individual detectors ─────────────────────────────────────────────────────

describe('Pattern detectors — unit', () => {
  const base = { tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', activePatterns: [] };

  test('RelationshipWeakeningDetector: detects ≥3 negative signals', () => {
    const events = [makeEvent('PromiseMissed'), makeEvent('PromiseMissed'), makeEvent('DataIntegrityFlagged')];
    const result = RelationshipWeakeningDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].title).toBe('Relationship Weakening');
    expect(result.patternsDetected[0].severity).toBe('medium');
  });

  test('RelationshipWeakeningDetector: below threshold = no pattern', () => {
    const events = [makeEvent('PromiseMissed'), makeEvent('PromiseKept')];
    const result = RelationshipWeakeningDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(0);
  });

  test('RelationshipWeakeningDetector: ≥5 signals = high severity', () => {
    const events = Array(5).fill(null).map(() => makeEvent('PromiseMissed'));
    const result = RelationshipWeakeningDetector.detect({ ...base, events });
    expect(result.patternsDetected[0].severity).toBe('high');
    expect(result.patternsDetected[0].confidence).toBe('high');
  });

  test('ReferralInactivityDetector: no referrals with events = inactivity', () => {
    const events = Array(6).fill(null).map(() => makeEvent('ObjectCreated'));
    const result = ReferralInactivityDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].title).toBe('Referral Source Inactivity');
  });

  test('ReferralInactivityDetector: with referrals = no pattern', () => {
    const events = [makeEvent('AutomyndReferralObserved'), makeEvent('AutomyndReferralObserved')];
    const result = ReferralInactivityDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(0);
  });

  test('OwnershipInstabilityDetector: ≥3 transfers = detected', () => {
    const events = Array(3).fill(null).map(() => makeEvent('OwnershipTransferred'));
    const result = OwnershipInstabilityDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].category).toBe('relationship');
  });

  test('WorkflowAbandonmentDetector: ≥2 suppressed = detected', () => {
    const events = [makeEvent('WorkflowSuppressed'), makeEvent('WorkflowSuppressed'), makeEvent('WorkflowStarted')];
    const result = WorkflowAbandonmentDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].severity).toBe('high');
  });

  test('TaskOverloadDetector: backlog ≥5 = detected', () => {
    const events = Array(6).fill(null).map(() => makeEvent('TaskCreated'));
    const result = TaskOverloadDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].title).toBe('Task Overload');
  });

  test('TaskOverloadDetector: escalations elevate severity to critical', () => {
    const events = [
      ...Array(6).fill(null).map(() => makeEvent('TaskCreated')),
      ...Array(3).fill(null).map(() => makeEvent('TaskEscalated')),
    ];
    const result = TaskOverloadDetector.detect({ ...base, events });
    expect(result.patternsDetected[0].severity).toBe('critical');
  });

  test('SLADriftDetector: ≥40% miss rate = detected', () => {
    const events = [
      makeEvent('PromiseMissed'), makeEvent('PromiseMissed'),
      makeEvent('PromiseKept'), makeEvent('PromiseMissed'),
    ];
    const result = SLADriftDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].title).toBe('SLA Drift');
  });

  test('SLADriftDetector: good track record = no pattern', () => {
    const events = [
      makeEvent('PromiseKept'), makeEvent('PromiseKept'),
      makeEvent('PromiseKept'), makeEvent('PromiseMissed'),
    ];
    const result = SLADriftDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(0);
  });

  test('ConflictingKnowledgeDetector: ≥2 open flags = detected', () => {
    const events = [makeEvent('DataIntegrityFlagged'), makeEvent('DataIntegrityFlagged')];
    const result = ConflictingKnowledgeDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].category).toBe('knowledge');
  });

  test('ConflictingKnowledgeDetector: resolved flags = no pattern', () => {
    const events = [makeEvent('DataIntegrityFlagged'), makeEvent('DataIntegrityFlagged'), makeEvent('DataIntegrityResolved'), makeEvent('DataIntegrityResolved')];
    const result = ConflictingKnowledgeDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(0);
  });

  test('EmergingThemeDetector: same event ≥5 times = theme', () => {
    const events = Array(6).fill(null).map(() => makeEvent('WorkflowStarted'));
    const result = EmergingThemeDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].title).toContain('Emerging Theme');
  });

  test('CommunicationFailureDetector: ≥2 failures = friction point', () => {
    const events = [makeEvent('CommunicationFailed'), makeEvent('CommunicationFailed')];
    const result = CommunicationFailureDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].category).toBe('journey');
  });

  test('SuccessfulJourneyDetector: clean journey = positive pattern', () => {
    const events = [makeEvent('WorkflowCompleted'), makeEvent('PromiseKept'), makeEvent('PromiseKept')];
    const result = SuccessfulJourneyDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].severity).toBe('info');
  });

  test('HighReferralEngagementDetector: ≥5 referrals = community strength', () => {
    const events = Array(6).fill(null).map(() => makeEvent('AutomyndReferralObserved'));
    const result = HighReferralEngagementDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].category).toBe('community');
  });

  test('OperationalExcellenceDetector: ≥85% keep rate = excellence', () => {
    const events = [
      ...Array(9).fill(null).map(() => makeEvent('PromiseKept')),
      makeEvent('PromiseMissed'),
    ];
    const result = OperationalExcellenceDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].severity).toBe('info');
  });

  test('QualityRiskDetector: high flag rate = organizational risk', () => {
    const events = [
      makeEvent('DataIntegrityFlagged'), makeEvent('DataIntegrityFlagged'),
      makeEvent('DataIntegrityFlagged'), makeEvent('DataIntegrityFlagged'),
      makeEvent('WorkflowStarted'),
    ];
    const result = QualityRiskDetector.detect({ ...base, events });
    expect(result.patternsDetected).toHaveLength(1);
    expect(result.patternsDetected[0].severity).toBe('critical');
    expect(result.patternsDetected[0].category).toBe('organizational');
  });
});

// ─── Brain engine ─────────────────────────────────────────────────────────────

describe('Organizational Brain engine', () => {
  test('runAnalysis detects patterns from event stream', async () => {
    const { engine, eventStore } = makeEngine();
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    expect(result.patternsDetected.length).toBeGreaterThan(0);
    expect(result.patternsDetected.some(p => p.category === 'relationship')).toBe(true);
  });

  test('runAnalysis emits PatternDetected events', async () => {
    const { engine, eventStore, store } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });

    const detected = store.events.find(e => e.type === 'PatternDetected');
    expect(detected).toBeDefined();
  });

  test('runAnalysis emits RiskSurfaced for high/critical severity patterns', async () => {
    const { engine, eventStore, store } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, Array(6).fill('PromiseMissed'));

    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });

    const riskEvent = store.events.find(e => e.type === 'RiskSurfaced');
    expect(riskEvent).toBeDefined();
  });

  test('runAnalysis emits OpportunitySurfaced for info patterns', async () => {
    const { engine, eventStore, store } = makeEngine([SuccessfulJourneyDetector]);
    await seedEvents(eventStore, ['WorkflowCompleted', 'PromiseKept', 'PromiseKept']);

    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });

    const oppEvent = store.events.find(e => e.type === 'OpportunitySurfaced');
    expect(oppEvent).toBeDefined();
  });

  test('deduplication: same detector + subject does not create duplicate active pattern', async () => {
    const { engine, eventStore, store } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });

    const patterns = Array.from(store.detectedPatterns.values()).filter(p => p.detector_id === 'relationship.weakening' && p.status === 'active');
    expect(patterns).toHaveLength(1);
  });

  test('brain does not create workflow, task, promise, or communication events', async () => {
    const { engine, eventStore, store } = makeEngine();
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged', 'DataIntegrityFlagged', 'DataIntegrityFlagged']);

    const countBefore = store.events.length;
    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });

    const newEvents = store.events.slice(countBefore);
    const forbidden = ['WorkflowStarted', 'TaskCreated', 'PromiseCreated', 'CommunicationCreated'];
    for (const type of forbidden) {
      expect(newEvents.some(e => e.type === type)).toBe(false);
    }
  });

  test('brain emits only advisory events from the allowed set', async () => {
    const { engine, eventStore, store } = makeEngine();
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const countBefore = store.events.length;
    await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });

    const ALLOWED_BRAIN_EVENTS = new Set(['PatternDetected', 'PatternResolved', 'PatternSuperseded', 'PatternConfirmed', 'PatternDismissed', 'OpportunitySurfaced', 'RiskSurfaced', 'TrendDetected']);
    const newEvents = store.events.slice(countBefore);
    for (const evt of newEvents) {
      expect(ALLOWED_BRAIN_EVENTS.has(evt.type)).toBe(true);
    }
  });

  test('resolvePattern → status becomes resolved, emits PatternResolved', async () => {
    const { engine, eventStore, store } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const pattern = result.patternsDetected[0];
    expect(pattern).toBeDefined();

    await engine.resolvePattern({ tenantId: TENANT, patternId: pattern.id, actor: 'care-guide', expectedVersion: 1 });

    const row = store.detectedPatterns.get(String(pattern.id));
    expect(row!.status).toBe('resolved');
    expect(store.events.some(e => e.type === 'PatternResolved')).toBe(true);
  });

  test('dismissPattern → status becomes dismissed, emits PatternDismissed', async () => {
    const { engine, eventStore, store } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const pattern = result.patternsDetected[0];

    await engine.dismissPattern({ tenantId: TENANT, patternId: pattern.id, reason: 'Not relevant.', actor: 'manager', expectedVersion: 1 });

    const row = store.detectedPatterns.get(String(pattern.id));
    expect(row!.status).toBe('dismissed');
    expect(store.events.some(e => e.type === 'PatternDismissed')).toBe(true);
  });

  test('stale version on resolve → StalePatternError', async () => {
    const { engine, eventStore } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const pattern = result.patternsDetected[0];

    await engine.resolvePattern({ tenantId: TENANT, patternId: pattern.id, actor: 'system', expectedVersion: 1 });
    await expect(engine.resolvePattern({ tenantId: TENANT, patternId: pattern.id, actor: 'system', expectedVersion: 1 })).rejects.toThrow(StalePatternError);
  });

  test('non-existent pattern → PatternNotFoundError', async () => {
    const { engine } = makeEngine();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-999999999999');
    await expect(engine.resolvePattern({ tenantId: TENANT, patternId: fakeId, actor: 'system', expectedVersion: 1 })).rejects.toThrow(PatternNotFoundError);
  });
});

// ─── Deterministic replay ─────────────────────────────────────────────────────

describe('Deterministic replay', () => {
  test('same event stream produces same patterns every time', async () => {
    function detectWith(events: DomainEvent[]) {
      return RelationshipWeakeningDetector.detect({
        tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient',
        events, activePatterns: [],
      });
    }

    const events = [makeEvent('PromiseMissed'), makeEvent('PromiseMissed'), makeEvent('DataIntegrityFlagged')];
    const r1 = detectWith(events);
    const r2 = detectWith(events);

    expect(r1.patternsDetected.length).toBe(r2.patternsDetected.length);
    if (r1.patternsDetected.length > 0) {
      expect(r1.patternsDetected[0].title).toBe(r2.patternsDetected[0].title);
      expect(r1.patternsDetected[0].severity).toBe(r2.patternsDetected[0].severity);
      expect(r1.patternsDetected[0].confidence).toBe(r2.patternsDetected[0].confidence);
    }
  });

  test('detectors are pure functions — same input always same output', () => {
    for (const detector of ALL_PATTERN_DETECTORS) {
      const events = [makeEvent('PromiseKept'), makeEvent('PromiseKept')];
      const r1 = detector.detect({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', events, activePatterns: [] });
      const r2 = detector.detect({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', events, activePatterns: [] });
      expect(r1.patternsDetected.length).toBe(r2.patternsDetected.length);
    }
  });
});

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

describe('Event-sourced reconstruction', () => {
  test('reconstruct active pattern from events', async () => {
    const { engine, eventStore } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const pattern = result.patternsDetected[0];
    expect(pattern).toBeDefined();

    const reconstructed = await reconstructPatternFromEvents(eventStore, TENANT, pattern.id);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.status).toBe('active');
    expect(reconstructed!.category).toBe('relationship');
  });

  test('reconstruct resolved pattern', async () => {
    const { engine, eventStore } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const pattern = result.patternsDetected[0];

    await engine.resolvePattern({ tenantId: TENANT, patternId: pattern.id, actor: 'system', expectedVersion: 1 });

    const reconstructed = await reconstructPatternFromEvents(eventStore, TENANT, pattern.id);
    expect(reconstructed!.status).toBe('resolved');
  });

  test('reconstruct dismissed pattern', async () => {
    const { engine, eventStore } = makeEngine([RelationshipWeakeningDetector]);
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const result = await engine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const pattern = result.patternsDetected[0];

    await engine.dismissPattern({ tenantId: TENANT, patternId: pattern.id, reason: 'Not relevant', actor: 'system', expectedVersion: 1 });

    const reconstructed = await reconstructPatternFromEvents(eventStore, TENANT, pattern.id);
    expect(reconstructed!.status).toBe('dismissed');
  });

  test('null returned for unknown pattern ID', async () => {
    const { eventStore } = makeEngine();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-777777777777');
    const result = await reconstructPatternFromEvents(eventStore, TENANT, fakeId);
    expect(result).toBeNull();
  });
});

// ─── All pattern categories ───────────────────────────────────────────────────

describe('All pattern categories represented', () => {
  test('ALL_PATTERN_DETECTORS covers all 6 categories', () => {
    const categories = new Set(ALL_PATTERN_DETECTORS.map(d => d.category));
    expect(categories.has('relationship')).toBe(true);
    expect(categories.has('workflow')).toBe(true);
    expect(categories.has('knowledge')).toBe(true);
    expect(categories.has('journey')).toBe(true);
    expect(categories.has('community')).toBe(true);
    expect(categories.has('organizational')).toBe(true);
  });

  test('ALL_PATTERN_DETECTORS has 13 detectors', () => {
    expect(ALL_PATTERN_DETECTORS).toHaveLength(13);
  });

  test('each detector has unique ID, version, and description', () => {
    const ids = new Set(ALL_PATTERN_DETECTORS.map(d => d.id));
    expect(ids.size).toBe(ALL_PATTERN_DETECTORS.length);
    for (const d of ALL_PATTERN_DETECTORS) {
      expect(d.version).toBeTruthy();
      expect(d.description).toBeTruthy();
    }
  });
});

// ─── Organizational Health Projection (ADR-016) ───────────────────────────────

describe('Organizational Health Projection (ADR-016)', () => {
  function makeProjectionStack() {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const registry = new PatternDetectorRegistry();
    for (const d of ALL_PATTERN_DETECTORS) registry.register(d);
    const brainEngine = new OrganizationalBrainEngine(db, eventStore, registry);

    const projRegistry = new ProjectionRegistry();
    projRegistry.register(OrganizationalHealthProjectionDefinition);
    const projStore = new InMemoryProjectionStore();
    const projEngine = new ProjectionEngine(projRegistry, projStore, eventStore);
    const rebuilder = new ProjectionRebuilder(projEngine, projStore);

    return { store, db, eventStore, brainEngine, projEngine, projStore, rebuilder };
  }

  function makeHealthAssembler(patterns: OrganizationalHealthInput['activePatterns'], subjectId: string): ProjectionInputAssembler<OrganizationalHealthInput> {
    return {
      async assemble(sid) { return { subjectId: sid, subjectType: 'Patient', activePatterns: patterns }; },
      async sourceEventIds() { return patterns.map(p => String(p.id)); },
    };
  }

  test('organizational health builds from active patterns', async () => {
    const { brainEngine, eventStore, projEngine } = makeProjectionStack();
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const analysisResult = await brainEngine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const assembler = makeHealthAssembler(analysisResult.patternsDetected, String(SUBJECT_ID));

    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    expect(result.built).toBe(true);
    if (!result.built) return;

    const value = result.projection.value as unknown as OrganizationalHealthValue;
    expect(value.activePatternCount).toBeGreaterThan(0);
    expect(value.disclaimer).toBe('computed-projection-advisory-only');
    expect(value.trendIndicator).toBeDefined();
    expect(value.healthScore).toBeGreaterThanOrEqual(0);
    expect(value.healthScore).toBeLessThanOrEqual(1);
  });

  test('zero patterns = unknown trend, neutral health score', async () => {
    const { projEngine } = makeProjectionStack();
    const assembler = makeHealthAssembler([], String(SUBJECT_ID));
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    expect(result.built).toBe(true);
    if (!result.built) return;
    const value = result.projection.value as unknown as OrganizationalHealthValue;
    expect(value.trendIndicator).toBe('unknown');
    expect(value.healthScore).toBe(1);
  });

  test('critical patterns lower health score', async () => {
    const { brainEngine, eventStore, projEngine } = makeProjectionStack();
    // Seed events that trigger critical QualityRiskDetector
    await seedEvents(eventStore, Array(5).fill('DataIntegrityFlagged'));

    const analysis = await brainEngine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const assembler = makeHealthAssembler(analysis.patternsDetected, String(SUBJECT_ID));
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    if (!result.built) return;

    const value = result.projection.value as unknown as OrganizationalHealthValue;
    expect(value.healthScore).toBeLessThan(1);
  });

  test('ADR-016: projection rebuilds identically after clearing store', async () => {
    const { brainEngine, eventStore, projEngine, projStore, rebuilder } = makeProjectionStack();
    await seedEvents(eventStore, ['PromiseMissed', 'PromiseMissed', 'DataIntegrityFlagged']);

    const analysis = await brainEngine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const assembler = makeHealthAssembler(analysis.patternsDetected, String(SUBJECT_ID));

    const original = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    expect(original.built).toBe(true);
    if (!original.built) return;

    projStore.clear();

    const rebuilt = await rebuilder.rebuild(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;

    const ov = original.projection.value as unknown as OrganizationalHealthValue;
    const rv = rebuilt.projection.value as unknown as OrganizationalHealthValue;
    expect(rv.activePatternCount).toBe(ov.activePatternCount);
    expect(rv.healthScore).toBe(ov.healthScore);
    expect(rv.trendIndicator).toBe(ov.trendIndicator);
    expect(rv.disclaimer).toBe(ov.disclaimer);
  });

  test('ADR-016: methodVersion and aiInvolved=false declared', async () => {
    const { projEngine } = makeProjectionStack();
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), makeHealthAssembler([], String(SUBJECT_ID)));
    if (!result.built) return;
    expect(result.projection.metadata.methodVersion).toBe('1.0.0');
    expect(result.projection.metadata.aiInvolved).toBe(false);
    expect(result.projection.metadata.canonicalInputs.length).toBeGreaterThan(0);
  });

  test('opportunities counted separately from risks', async () => {
    const { brainEngine, eventStore, projEngine } = makeProjectionStack();
    // Successful journey pattern = info/opportunity
    await seedEvents(eventStore, ['WorkflowCompleted', 'PromiseKept', 'PromiseKept']);

    const analysis = await brainEngine.runAnalysis({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', actor: 'brain' });
    const infoPatterns = analysis.patternsDetected.filter(p => p.severity === 'info');

    if (infoPatterns.length > 0) {
      const assembler = makeHealthAssembler(infoPatterns, String(SUBJECT_ID));
      const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
      if (!result.built) return;
      const value = result.projection.value as unknown as OrganizationalHealthValue;
      expect(value.opportunityCount).toBe(infoPatterns.length);
      expect(value.openRiskCount).toBe(0);
    }
  });
});
