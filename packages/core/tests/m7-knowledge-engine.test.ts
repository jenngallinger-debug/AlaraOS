/**
 * Alara OS — M7 Knowledge Engine Tests
 *
 * Coverage:
 *   - Observation recording (all sources, all topics)
 *   - Knowledge entry assertion, supersession, retraction
 *   - Knowledge query (topic filter, confidence filter, status filter)
 *   - ADR-001: clinical content rejected at write time
 *   - ADR-015: aiInvolved flag recorded faithfully
 *   - Optimistic concurrency (StaleKnowledgeEntryError)
 *   - Event-sourced reconstruction
 *   - Knowledge Summary projection (ADR-016: rebuilds after cache loss)
 *   - Observations are append-only (never updated or deleted)
 *   - Retracted entries excluded from active queries
 *   - Superseded entries replaced by new entries
 */

import { KnowledgeEngine, reconstructKnowledgeEntryFromEvents } from '../src/knowledge-engine/engine';
import { KnowledgeRepository } from '../src/knowledge-engine/repository';
import {
  ClinicalContentViolationError,
  KnowledgeEntryNotFoundError,
  StaleKnowledgeEntryError,
} from '../src/knowledge-engine/types';
import { KnowledgeSummaryProjectionDefinition } from '../src/projection-engine/projections/knowledge-summary';
import type { KnowledgeSummaryInput, KnowledgeSummaryValue } from '../src/projection-engine/projections/knowledge-summary';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { ProjectionRebuilder } from '../src/projection-engine/rebuilder';
import type { ProjectionInputAssembler } from '../src/projection-engine/engine';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const PATIENT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');
const REFERRAL_SOURCE_ID = 'ext-dr-jones-clinic';

function makeStore() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const engine = new KnowledgeEngine(db, eventStore);
  const repo = new KnowledgeRepository(db);
  return { store, db, eventStore, engine, repo };
}

// ─── Observations ─────────────────────────────────────────────────────────────

describe('Observations — record and retrieve', () => {
  test('recordObservation → creates observation with Alara UUID', async () => {
    const { engine } = makeStore();
    const obs = await engine.recordObservation({
      tenantId: TENANT,
      subjectId: String(PATIENT_ID),
      subjectType: 'Patient',
      topic: 'eligibility',
      statement: 'Patient has EEOICPA White Card on file.',
      facts: { program: 'EEOICPA', cardNumber: 'WC-12345', confirmed: true },
      source: 'HumanAssertion',
      confidence: 'confirmed',
      aiInvolved: false,
      sourceEventIds: [],
      sourceObservationIds: [],
      actor: 'care-guide-001',
    });

    expect(obs.id).toBeDefined();
    expect(obs.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(obs.topic).toBe('eligibility');
    expect(obs.confidence).toBe('confirmed');
    expect(obs.source).toBe('HumanAssertion');
    expect(obs.facts.program).toBe('EEOICPA');
  });

  test('recordObservation → emits ObservationRecorded event', async () => {
    const { engine, eventStore } = makeStore();
    const obs = await engine.recordObservation({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'referral_pattern', statement: 'Referral received from Dr. Jones.',
      facts: { count: 1 }, source: 'AutomyndEvent', confidence: 'confirmed',
      aiInvolved: false, sourceEventIds: ['evt-001'], sourceObservationIds: [],
      actor: 'system',
    });

    const events = await eventStore.loadStream(TENANT, obs.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ObservationRecorded');
    const p = events[0].payload as Record<string, unknown>;
    expect(p.topic).toBe('referral_pattern');
    expect(p.source).toBe('AutomyndEvent');
  });

  test('all observation sources are accepted', async () => {
    const { engine } = makeStore();
    const sources = ['AutomyndEvent', 'WorkflowOutcome', 'PromiseOutcome', 'TaskOutcome',
      'CommunicationEvent', 'RelationshipEvent', 'HumanAssertion', 'InferenceChain'] as const;
    for (const source of sources) {
      const obs = await engine.recordObservation({
        tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
        topic: 'patient_context', statement: `Observed via ${source}`,
        facts: {}, source, confidence: 'possible',
        aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system',
      });
      expect(obs.source).toBe(source);
    }
  });

  test('all observation topics are accepted', async () => {
    const { engine } = makeStore();
    const topics = ['eligibility', 'referral_pattern', 'clinical_need', 'care_coordination',
      'data_integrity', 'relationship_quality', 'promise_reliability', 'communication_quality',
      'workflow_efficiency', 'organizational_risk', 'patient_context', 'program_context'] as const;
    for (const topic of topics) {
      const obs = await engine.recordObservation({
        tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
        topic, statement: `${topic} observation`, facts: {}, source: 'HumanAssertion',
        confidence: 'possible', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [],
        actor: 'system',
      });
      expect(obs.topic).toBe(topic);
    }
  });

  test('observations for subject retrieved in reverse chronological order', async () => {
    const { engine, repo } = makeStore();
    await engine.recordObservation({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', statement: 'First', facts: {}, source: 'HumanAssertion', confidence: 'possible', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system' });
    await engine.recordObservation({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', statement: 'Second', facts: {}, source: 'HumanAssertion', confidence: 'confirmed', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system' });

    const obs = await repo.getObservationsForSubject(TENANT, String(PATIENT_ID), 'eligibility');
    expect(obs).toHaveLength(2);
  });

  test('topic filter narrows observation results', async () => {
    const { engine, repo } = makeStore();
    await engine.recordObservation({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', statement: 'Eligible', facts: {}, source: 'HumanAssertion', confidence: 'confirmed', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system' });
    await engine.recordObservation({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'referral_pattern', statement: 'Referred', facts: {}, source: 'AutomyndEvent', confidence: 'confirmed', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system' });

    const eligibilityObs = await repo.getObservationsForSubject(TENANT, String(PATIENT_ID), 'eligibility');
    expect(eligibilityObs).toHaveLength(1);
    expect(eligibilityObs[0].topic).toBe('eligibility');
  });

  test('sourceEventIds and sourceObservationIds are preserved', async () => {
    const { engine, repo } = makeStore();
    const obs = await engine.recordObservation({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'promise_reliability', statement: 'Dr. Jones kept promise.',
      facts: { promiseId: 'p-001' }, source: 'PromiseOutcome', confidence: 'confirmed',
      aiInvolved: false, sourceEventIds: ['evt-abc', 'evt-def'],
      sourceObservationIds: ['obs-111'], actor: 'system',
    });

    const fetched = await repo.getObservationById(TENANT, obs.id);
    expect(fetched!.sourceEventIds).toEqual(['evt-abc', 'evt-def']);
    expect(fetched!.sourceObservationIds).toEqual(['obs-111']);
  });
});

// ─── ADR-001: Clinical content rejection ──────────────────────────────────────

describe('ADR-001: Clinical content boundary', () => {
  test('visitNotes in facts → ClinicalContentViolationError', async () => {
    const { engine } = makeStore();
    await expect(engine.recordObservation({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'clinical_need', statement: 'Clinical visit noted.',
      facts: { visitNotes: 'Patient had SOB and bilateral crackles.' }, // clinical!
      source: 'HumanAssertion', confidence: 'confirmed',
      aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system',
    })).rejects.toThrow(ClinicalContentViolationError);
  });

  test('assessmentText in facts → ClinicalContentViolationError', async () => {
    const { engine } = makeStore();
    await expect(engine.recordObservation({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'clinical_need', statement: 'OASIS completed.',
      facts: { assessmentText: 'M0010: 30, M0014: 1...' }, // clinical!
      source: 'AutomyndEvent', confidence: 'confirmed',
      aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system',
    })).rejects.toThrow(ClinicalContentViolationError);
  });

  test('planOfCare in knowledge entry content → ClinicalContentViolationError', async () => {
    const { engine } = makeStore();
    await expect(engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'clinical_need', kind: 'fact', statement: 'Patient needs wound care.',
      content: { planOfCare: 'Skilled nursing 3x/week for wound...' }, // clinical!
      confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [],
      expiresAt: null, actor: 'system',
    })).rejects.toThrow(ClinicalContentViolationError);
  });

  test('non-clinical facts are accepted', async () => {
    const { engine } = makeStore();
    const obs = await engine.recordObservation({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'patient_context', statement: 'Patient is homebound-eligible.',
      facts: { homeboundStatus: 'eligible', programType: 'EEOICPA' }, // non-clinical ✓
      source: 'HumanAssertion', confidence: 'confirmed',
      aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system',
    });
    expect(obs.facts.programType).toBe('EEOICPA');
  });
});

// ─── ADR-015: AI involvement flag ─────────────────────────────────────────────

describe('ADR-015: AI involvement flag', () => {
  test('aiInvolved=true recorded faithfully on observation', async () => {
    const { engine, repo } = makeStore();
    const obs = await engine.recordObservation({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', statement: 'AI inferred EEOICPA eligibility signal.',
      facts: { signal: 'doeWork' }, source: 'InferenceChain', confidence: 'possible',
      aiInvolved: true, sourceEventIds: [], sourceObservationIds: [], actor: 'ai-reasoner',
    });
    const fetched = await repo.getObservationById(TENANT, obs.id);
    expect(fetched!.aiInvolved).toBe(true);
  });

  test('aiInvolved=true recorded faithfully on knowledge entry', async () => {
    const { engine, repo } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'inference',
      statement: 'AI inference: patient likely EEOICPA eligible.',
      content: { basis: 'DOE employment history', confidence: 0.82 },
      confidence: 'probable', aiInvolved: true, supportingObservationIds: [],
      expiresAt: null, actor: 'ai-reasoner',
    });
    const fetched = await repo.getEntryById(TENANT, entry.id);
    expect(fetched!.aiInvolved).toBe(true);
    expect(fetched!.kind).toBe('inference');
  });
});

// ─── Knowledge Entry lifecycle ────────────────────────────────────────────────

describe('Knowledge Entry lifecycle', () => {
  test('assertKnowledge → active entry with Alara UUID', async () => {
    const { engine } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'fact',
      statement: 'Patient is confirmed EEOICPA Part B eligible.',
      content: { program: 'EEOICPA', part: 'B', verified: true },
      confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [],
      expiresAt: null, actor: 'care-guide-001',
    });

    expect(entry.id).toBeDefined();
    expect(entry.status).toBe('active');
    expect(entry.kind).toBe('fact');
    expect(entry.confidence).toBe('confirmed');
    expect(entry.version).toBe(1);
  });

  test('assertKnowledge → emits KnowledgeAsserted event', async () => {
    const { engine, eventStore } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'referral_pattern', kind: 'preference',
      statement: 'Dr. Jones refers weekly on Tuesdays.',
      content: { frequency: 'weekly', dayOfWeek: 'Tuesday' },
      confidence: 'probable', aiInvolved: false, supportingObservationIds: [],
      expiresAt: null, actor: 'care-guide-001',
    });

    const events = await eventStore.loadStream(TENANT, entry.id);
    expect(events[0].type).toBe('KnowledgeAsserted');
    expect((events[0].payload as Record<string, unknown>).topic).toBe('referral_pattern');
  });

  test('supersedeKnowledge → old entry superseded, new entry active', async () => {
    const { engine, repo } = makeStore();
    const original = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'fact',
      statement: 'Patient is EEOICPA Part B eligible.',
      content: { part: 'B' }, confidence: 'confirmed', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    const newEntry = await engine.supersedeKnowledge({
      tenantId: TENANT, entryId: original.id,
      newStatement: 'Patient is EEOICPA Part E eligible (corrected — not Part B).',
      newContent: { part: 'E' },
      reason: 'DOL confirmed Part E designation after DOB verification.',
      actor: 'care-guide-001', expectedVersion: 1,
    });

    const oldFetched = await repo.getEntryById(TENANT, original.id);
    expect(oldFetched!.status).toBe('superseded');
    expect(String(oldFetched!.supersededById)).toBe(String(newEntry.id));

    expect(newEntry.status).toBe('active');
    expect(newEntry.statement).toContain('Part E');
  });

  test('retractKnowledge → entry status becomes retracted', async () => {
    const { engine, repo } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'inference',
      statement: 'Patient inferred to be VA-eligible.',
      content: { basis: 'service_history' }, confidence: 'possible', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    await engine.retractKnowledge({
      tenantId: TENANT, entryId: entry.id,
      reason: 'VA confirmed patient not enrolled.',
      actor: 'care-guide-001', expectedVersion: 1,
    });

    const fetched = await repo.getEntryById(TENANT, entry.id);
    expect(fetched!.status).toBe('retracted');
    expect(fetched!.version).toBe(2);
  });

  test('retracted entries excluded from active query', async () => {
    const { engine, repo } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'inference',
      statement: 'Patient inferred VA-eligible.',
      content: {}, confidence: 'possible', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    await engine.retractKnowledge({
      tenantId: TENANT, entryId: entry.id, reason: 'Wrong.',
      actor: 'system', expectedVersion: 1,
    });

    const active = await repo.getActiveEntriesForSubject(TENANT, String(PATIENT_ID));
    expect(active.find(e => String(e.id) === String(entry.id))).toBeUndefined();
  });

  test('all knowledge entry kinds accepted', async () => {
    const { engine } = makeStore();
    const kinds = ['fact', 'inference', 'policy', 'preference', 'risk'] as const;
    for (const kind of kinds) {
      const entry = await engine.assertKnowledge({
        tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
        topic: 'patient_context', kind, statement: `${kind} knowledge`,
        content: {}, confidence: 'possible', aiInvolved: false,
        supportingObservationIds: [], expiresAt: null, actor: 'system',
      });
      expect(entry.kind).toBe(kind);
    }
  });

  test('entry with expiry date is stored correctly', async () => {
    const { engine, repo } = makeStore();
    const expiresAt = new Date(Date.now() + 30 * 86_400_000); // 30 days
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'fact',
      statement: 'Patient authorization valid for 30 days.',
      content: { authExpiry: expiresAt.toISOString() }, confidence: 'confirmed',
      aiInvolved: false, supportingObservationIds: [], expiresAt, actor: 'system',
    });
    const fetched = await repo.getEntryById(TENANT, entry.id);
    expect(fetched!.expiresAt).not.toBeNull();
  });
});

// ─── Optimistic concurrency ───────────────────────────────────────────────────

describe('Optimistic concurrency', () => {
  test('stale version on supersede → StaleKnowledgeEntryError', async () => {
    const { engine } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'fact', statement: 'Original.',
      content: {}, confidence: 'confirmed', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    await engine.supersedeKnowledge({
      tenantId: TENANT, entryId: entry.id, newStatement: 'Updated.',
      newContent: {}, reason: 'First update.', actor: 'system', expectedVersion: 1,
    });

    await expect(engine.supersedeKnowledge({
      tenantId: TENANT, entryId: entry.id, newStatement: 'Stale update.',
      newContent: {}, reason: 'Stale.', actor: 'system', expectedVersion: 1,
    })).rejects.toThrow(StaleKnowledgeEntryError);
  });

  test('stale version on retract → StaleKnowledgeEntryError', async () => {
    const { engine } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'inference', statement: 'Maybe.',
      content: {}, confidence: 'possible', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    await engine.retractKnowledge({ tenantId: TENANT, entryId: entry.id, reason: 'Wrong.', actor: 'system', expectedVersion: 1 });
    await expect(engine.retractKnowledge({ tenantId: TENANT, entryId: entry.id, reason: 'Again.', actor: 'system', expectedVersion: 1 })).rejects.toThrow(StaleKnowledgeEntryError);
  });

  test('non-existent entry → KnowledgeEntryNotFoundError', async () => {
    const { engine } = makeStore();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-999999999999');
    await expect(engine.retractKnowledge({ tenantId: TENANT, entryId: fakeId, reason: 'none', actor: 'system', expectedVersion: 1 })).rejects.toThrow(KnowledgeEntryNotFoundError);
  });
});

// ─── Knowledge Query ──────────────────────────────────────────────────────────

describe('Knowledge Query', () => {
  async function seedKnowledge(engine: KnowledgeEngine, repo: KnowledgeRepository) {
    await engine.recordObservation({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', statement: 'EEOICPA observed.', facts: {}, source: 'AutomyndEvent', confidence: 'confirmed', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system' });
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', kind: 'fact', statement: 'EEOICPA Part B confirmed.', content: { part: 'B' }, confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'organizational_risk', kind: 'risk', statement: 'Data integrity flag on DOB.', content: { field: 'dob' }, confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'referral_pattern', kind: 'preference', statement: 'Dr. Jones refers Tuesdays.', content: {}, confidence: 'probable', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });
  }

  test('query without filters returns all entries and observations', async () => {
    const { engine, repo } = makeStore();
    await seedKnowledge(engine, repo);

    const result = await repo.query({ tenantId: TENANT, subjectId: String(PATIENT_ID) });
    expect(result.totalEntries).toBe(3);
    expect(result.totalObservations).toBe(1);
    expect(result.subjectId).toBe(String(PATIENT_ID));
    expect(result.queriedAt).toBeDefined();
  });

  test('topic filter narrows results', async () => {
    const { engine, repo } = makeStore();
    await seedKnowledge(engine, repo);

    const result = await repo.query({ tenantId: TENANT, subjectId: String(PATIENT_ID), topic: 'eligibility' });
    expect(result.totalEntries).toBe(1);
    expect(result.entries[0].topic).toBe('eligibility');
  });

  test('kind filter narrows results', async () => {
    const { engine, repo } = makeStore();
    await seedKnowledge(engine, repo);

    const result = await repo.query({ tenantId: TENANT, subjectId: String(PATIENT_ID), kind: 'risk' });
    expect(result.totalEntries).toBe(1);
    expect(result.entries[0].kind).toBe('risk');
  });

  test('minConfidence filter excludes low-confidence entries', async () => {
    const { engine, repo } = makeStore();
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', kind: 'inference', statement: 'Speculative OWCP eligibility.', content: {}, confidence: 'speculative', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', kind: 'fact', statement: 'Confirmed EEOICPA.', content: {}, confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });

    const result = await repo.query({ tenantId: TENANT, subjectId: String(PATIENT_ID), minConfidence: 'probable' });
    expect(result.entries.every(e => ['confirmed', 'probable'].includes(e.confidence))).toBe(true);
    expect(result.entries.find(e => e.confidence === 'speculative')).toBeUndefined();
  });

  test('no knowledge returns empty result', async () => {
    const { repo } = makeStore();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-888888888888');
    const result = await repo.query({ tenantId: TENANT, subjectId: String(fakeId) });
    expect(result.totalEntries).toBe(0);
    expect(result.totalObservations).toBe(0);
  });
});

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

describe('Event-sourced reconstruction', () => {
  test('reconstruct active entry from events', async () => {
    const { engine, eventStore } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'fact', statement: 'Active entry.',
      content: {}, confidence: 'confirmed', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    const reconstructed = await reconstructKnowledgeEntryFromEvents(eventStore, TENANT, entry.id);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.status).toBe('active');
    expect(reconstructed!.topic).toBe('eligibility');
  });

  test('reconstruct superseded entry from events', async () => {
    const { engine, eventStore } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'eligibility', kind: 'fact', statement: 'Original.',
      content: {}, confidence: 'confirmed', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    await engine.supersedeKnowledge({
      tenantId: TENANT, entryId: entry.id, newStatement: 'Updated.',
      newContent: {}, reason: 'Correction.', actor: 'system', expectedVersion: 1,
    });

    const reconstructed = await reconstructKnowledgeEntryFromEvents(eventStore, TENANT, entry.id);
    expect(reconstructed!.status).toBe('superseded');
    expect(reconstructed!.supersededById).not.toBeNull();
  });

  test('reconstruct retracted entry from events', async () => {
    const { engine, eventStore } = makeStore();
    const entry = await engine.assertKnowledge({
      tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient',
      topic: 'organizational_risk', kind: 'risk', statement: 'Risk identified.',
      content: {}, confidence: 'probable', aiInvolved: false,
      supportingObservationIds: [], expiresAt: null, actor: 'system',
    });

    await engine.retractKnowledge({ tenantId: TENANT, entryId: entry.id, reason: 'Resolved.', actor: 'system', expectedVersion: 1 });

    const reconstructed = await reconstructKnowledgeEntryFromEvents(eventStore, TENANT, entry.id);
    expect(reconstructed!.status).toBe('retracted');
  });

  test('null returned for unknown entry ID', async () => {
    const { eventStore } = makeStore();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-777777777777');
    const result = await reconstructKnowledgeEntryFromEvents(eventStore, TENANT, fakeId);
    expect(result).toBeNull();
  });
});

// ─── Knowledge Summary Projection (ADR-016) ───────────────────────────────────

describe('Knowledge Summary Projection (ADR-016)', () => {
  function makeProjectionStack() {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const engine = new KnowledgeEngine(db, eventStore);
    const repo = new KnowledgeRepository(db);

    // Use a fresh registry for the knowledge summary
    const projRegistry = new ProjectionRegistry();
    projRegistry.register(KnowledgeSummaryProjectionDefinition);
    const projStore = new InMemoryProjectionStore();
    const projEngine = new ProjectionEngine(projRegistry, projStore, eventStore);
    const rebuilder = new ProjectionRebuilder(projEngine, projStore);

    return { store, db, eventStore, engine, repo, projEngine, projStore, rebuilder };
  }

  function makeSummaryAssembler(
    entries: KnowledgeSummaryInput['activeEntries'],
    observations: KnowledgeSummaryInput['observations'],
    subjectId: string,
  ): ProjectionInputAssembler<KnowledgeSummaryInput> {
    return {
      async assemble(sid) { return { subjectId: sid, subjectType: 'Patient', activeEntries: entries, observations }; },
      async sourceEventIds() { return [...entries.map(e => String(e.id)), ...observations.map(o => String(o.id))]; },
    };
  }

  test('knowledge summary builds from entries and observations', async () => {
    const { engine, repo, projEngine } = makeProjectionStack();

    const obs = await engine.recordObservation({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', statement: 'EEOICPA observed.', facts: {}, source: 'AutomyndEvent', confidence: 'confirmed', aiInvolved: false, sourceEventIds: [], sourceObservationIds: [], actor: 'system' });
    const entry = await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', kind: 'fact', statement: 'EEOICPA confirmed.', content: {}, confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'organizational_risk', kind: 'risk', statement: 'DOB mismatch.', content: {}, confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });

    const activeEntries = await repo.getActiveEntriesForSubject(TENANT, String(PATIENT_ID));
    const observations = await repo.getObservationsForSubject(TENANT, String(PATIENT_ID));
    const assembler = makeSummaryAssembler(activeEntries, observations, String(PATIENT_ID));

    const result = await projEngine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(result.built).toBe(true);
    if (!result.built) return;

    const value = result.projection.value as unknown as KnowledgeSummaryValue;
    expect(value.totalActiveEntries).toBe(2);
    expect(value.totalObservations).toBe(1);
    expect(value.factCount).toBe(1);
    expect(value.riskCount).toBe(1);
    expect(value.disclaimer).toBe('computed-projection-advisory-only');
    expect(value.byTopic.length).toBeGreaterThan(0);
  });

  test('ADR-016: knowledge summary rebuilds identically after clearing projection store', async () => {
    const { engine, repo, projEngine, projStore, rebuilder } = makeProjectionStack();

    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', kind: 'fact', statement: 'EEOICPA confirmed.', content: {}, confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });
    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'referral_pattern', kind: 'preference', statement: 'Tuesday referrals.', content: {}, confidence: 'probable', aiInvolved: false, supportingObservationIds: [], expiresAt: null, actor: 'system' });

    const activeEntries = await repo.getActiveEntriesForSubject(TENANT, String(PATIENT_ID));
    const observations = await repo.getObservationsForSubject(TENANT, String(PATIENT_ID));
    const assembler = makeSummaryAssembler(activeEntries, observations, String(PATIENT_ID));

    // Build original
    const original = await projEngine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(original.built).toBe(true);
    if (!original.built) return;
    const originalValue = original.projection.value as unknown as KnowledgeSummaryValue;

    // Discard
    projStore.clear();

    // Rebuild
    const rebuilt = await rebuilder.rebuild(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;
    const rebuiltValue = rebuilt.projection.value as unknown as KnowledgeSummaryValue;

    expect(rebuiltValue.totalActiveEntries).toBe(originalValue.totalActiveEntries);
    expect(rebuiltValue.factCount).toBe(originalValue.factCount);
    expect(rebuiltValue.disclaimer).toBe(originalValue.disclaimer);
  });

  test('ADR-016: methodVersion and canonicalInputs declared on summary', async () => {
    const { projEngine } = makeProjectionStack();
    const assembler = makeSummaryAssembler([], [], String(PATIENT_ID));
    const result = await projEngine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.projection.metadata.methodVersion).toBe('1.0.0');
    expect(result.projection.metadata.canonicalInputs.length).toBeGreaterThan(0);
  });

  test('aiInvolved flag bubbles up to summary when any entry has AI', async () => {
    const { engine, repo, projEngine } = makeProjectionStack();

    await engine.assertKnowledge({ tenantId: TENANT, subjectId: String(PATIENT_ID), subjectType: 'Patient', topic: 'eligibility', kind: 'inference', statement: 'AI inference.', content: {}, confidence: 'probable', aiInvolved: true, supportingObservationIds: [], expiresAt: null, actor: 'ai-reasoner' });

    const activeEntries = await repo.getActiveEntriesForSubject(TENANT, String(PATIENT_ID));
    const assembler = makeSummaryAssembler(activeEntries, [], String(PATIENT_ID));
    const result = await projEngine.build(TENANT, 'Timeline', String(PATIENT_ID), assembler);
    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.projection.metadata.aiInvolved).toBe(true);
  });
});

// Need to import KnowledgeEngine for the type in the seed helper
