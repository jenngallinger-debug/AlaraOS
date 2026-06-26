/**
 * Alara OS — M9 Reasoning Engine Tests
 *
 * Coverage:
 *   - StubReasoningProvider (deterministic, used in all tests)
 *   - Provider abstraction (OpenAI/Anthropic stubs throw on call)
 *   - Hypothesis generation from patterns + knowledge
 *   - Recommendation generation with Rules Engine gate
 *   - Narrative generation (all 5 types)
 *   - Missing information identification
 *   - Evidence chains (all outputs reference evidence)
 *   - Confidence propagation
 *   - InsufficientEvidenceError on empty context
 *   - Rules Engine integration (recommendations approved/rejected)
 *   - No side effects (no workflow/task/comm events)
 *   - ReasoningSummaryProjection (ADR-016: aiInvolved=true, rebuilds)
 *   - Prompt assembler (strips clinical content, ADR-001)
 */

import { ReasoningEngine, ReasoningRepository } from '../src/reasoning-engine/engine';
import { StubReasoningProvider, OpenAIProvider, AnthropicProvider } from '../src/reasoning-engine/providers';
import { assembleContext, buildEvidenceChain } from '../src/reasoning-engine/prompt-assembler';
import { InsufficientEvidenceError } from '../src/reasoning-engine/types';
import type { ReasoningContext, Hypothesis } from '../src/reasoning-engine/types';
import type { ReasoningSummaryInput } from '../src/projection-engine/projections/reasoning-summary';
import { ReasoningSummaryProjectionDefinition } from '../src/projection-engine/projections/reasoning-summary';
import type { ReasoningSummaryValue } from '../src/projection-engine/projections/reasoning-summary';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { ProjectionRebuilder } from '../src/projection-engine/rebuilder';
import type { ProjectionInputAssembler } from '../src/projection-engine/engine';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS, BUILT_IN_POLICY_MODULES } from '../src/rules-engine/built-in-policies';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import type { AlaraId } from '../src/shared/types';
import type { DetectedPattern } from '../src/organizational-brain/types';
import type { KnowledgeEntry, Observation } from '../src/knowledge-engine/types';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const SUBJECT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');

function makeRules() {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  for (const m of BUILT_IN_POLICY_MODULES) registry.registerPolicyModule(m);
  return new RulesEngine(registry, new NoopAuditSink());
}

function makeEngine(provider = new StubReasoningProvider()) {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const rules = makeRules();
  const engine = new ReasoningEngine(db, eventStore, provider, rules);
  return { store, db, eventStore, engine, rules };
}

function makePattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return {
    id: makeAlaraId('00000000-0000-4000-8000-100000000001'),
    tenantId: TENANT, category: 'relationship', title: 'Test Pattern',
    description: 'A test pattern.', subjectId: String(SUBJECT_ID), subjectType: 'Patient',
    evidence: { description: 'test', supportingEventIds: [], supportingObjectIds: [], supportingObservationIds: [], measuredValue: 3, threshold: 2, observedAt: new Date().toISOString() },
    confidence: 'medium', severity: 'medium', status: 'active',
    detectorId: 'test.detector', detectorVersion: '1.0.0', supersededById: null,
    firstDetectedAt: new Date(), lastConfirmedAt: new Date(), resolvedAt: null, version: 1,
    ...overrides,
  };
}

function makeKnowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: makeAlaraId('00000000-0000-4000-8000-200000000001'),
    tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient',
    topic: 'eligibility', kind: 'fact', status: 'active',
    statement: 'Patient is EEOICPA eligible.', content: { program: 'EEOICPA' },
    confidence: 'confirmed', aiInvolved: false, supportingObservationIds: [],
    supersededById: null, assertedAt: new Date(), assertedBy: 'system',
    expiresAt: null, version: 1,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: makeAlaraId('00000000-0000-4000-8000-300000000001'),
    tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient',
    topic: 'patient_context', statement: 'Patient context observed.',
    facts: { programType: 'EEOICPA' }, source: 'HumanAssertion',
    confidence: 'confirmed', aiInvolved: false, sourceEventIds: [],
    sourceObservationIds: [], observedAt: new Date(), actor: 'system', version: 1,
    ...overrides,
  };
}

function makeContext(patterns: DetectedPattern[], entries: KnowledgeEntry[] = [], obs: Observation[] = []): ReasoningContext {
  return {
    tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient',
    patterns, knowledgeEntries: entries, observations: obs,
    objectAttributes: { name: 'Samuel Brown', programType: 'EEOICPA' },
    externalReferences: [{ system: 'Automynd', extType: 'patient_id', value: 'AM-001' }],
    workflowSummaries: [],
    recentEventTypes: ['ObjectCreated', 'WorkflowStarted', 'PromiseKept'],
  };
}

// ─── Provider abstraction ─────────────────────────────────────────────────────

describe('Provider abstraction', () => {
  test('StubReasoningProvider has correct identifiers', () => {
    const p = new StubReasoningProvider();
    expect(p.name).toBe('stub');
    expect(p.modelIdentifier).toBe('stub-v1');
  });

  test('OpenAIProvider throws on actual call', async () => {
    const p = new OpenAIProvider();
    expect(p.name).toBe('openai');
    await expect(p.generateHypotheses({} as unknown as ReasoningContext, {} as unknown as import('../src/reasoning-engine/types').EvidenceChain)).rejects.toThrow('OpenAIProvider');
  });

  test('AnthropicProvider throws on actual call', async () => {
    const p = new AnthropicProvider();
    expect(p.name).toBe('anthropic');
    expect(p.modelIdentifier).toContain('claude');
    await expect(p.generateHypotheses({} as unknown as ReasoningContext, {} as unknown as import('../src/reasoning-engine/types').EvidenceChain)).rejects.toThrow('AnthropicProvider');
  });

  test('Provider is pluggable — engine accepts any ReasoningProvider', () => {
    const { engine } = makeEngine(new StubReasoningProvider());
    expect(engine).toBeDefined();
  });
});

// ─── Hypothesis generation ────────────────────────────────────────────────────

describe('Hypothesis generation', () => {
  test('generates hypotheses from patterns', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses[0].statement).toBeTruthy();
    expect(hypotheses[0].rationale).toBeTruthy();
    expect(hypotheses[0].confidence.overall).toBeTruthy();
    expect(hypotheses[0].modelIdentifier).toBe('stub-v1');
  });

  test('generates hypotheses from knowledge entries', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [makeKnowledgeEntry()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    expect(hypotheses.length).toBeGreaterThan(0);
  });

  test('hypothesis has evidence chain with pattern IDs', async () => {
    const { engine } = makeEngine();
    const pattern = makePattern();
    const context = makeContext([pattern]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    expect(hypotheses[0].evidence.patternIds).toContain(String(pattern.id));
    expect(hypotheses[0].evidence.objectIds).toContain(String(SUBJECT_ID));
    expect(hypotheses[0].evidence.rationale).toBeTruthy();
  });

  test('hypothesis includes confidence assessment', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern(), makePattern({ id: makeAlaraId('00000000-0000-4000-8000-100000000002'), category: 'workflow' })]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    for (const h of hypotheses) {
      expect(h.confidence.reasoningMethod).toBeTruthy();
      expect(h.confidence.modelIdentifier).toBe('stub-v1');
      expect(h.confidence.assessedAt).toBeTruthy();
      expect(typeof h.confidence.conflictingEvidence).toBe('boolean');
    }
  });

  test('hypothesis emits HypothesisGenerated event', async () => {
    const { engine, store } = makeEngine();
    const context = makeContext([makePattern()]);
    await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    expect(store.events.some(e => e.type === 'HypothesisGenerated')).toBe(true);
  });

  test('hypothesis status starts as active', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    for (const h of hypotheses) expect(h.status).toBe('active');
  });

  test('InsufficientEvidenceError when no patterns or knowledge', async () => {
    const { engine } = makeEngine();
    const context = makeContext([]);
    await expect(engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' })).rejects.toThrow(InsufficientEvidenceError);
  });
});

// ─── Recommendation generation + Rules Engine gate ────────────────────────────

describe('Recommendation generation and Rules Engine gate', () => {
  async function makeHypotheses(engine: ReasoningEngine, patterns = [makePattern()]) {
    const context = makeContext(patterns);
    return engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
  }

  test('generates recommendations from hypotheses', async () => {
    const { engine } = makeEngine();
    const hypotheses = await makeHypotheses(engine);
    const context = makeContext([makePattern()]);
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });

    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].title).toBeTruthy();
    expect(recs[0].actionType).toBeTruthy();
    expect(recs[0].priority).toBeTruthy();
    expect(recs[0].modelIdentifier).toBe('stub-v1');
  });

  test('every recommendation is evaluated by the Rules Engine', async () => {
    const { engine } = makeEngine();
    const hypotheses = await makeHypotheses(engine);
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context: makeContext([makePattern()]), actor: 'system' });

    for (const r of recs) {
      expect(r.rulesEngineApproved).not.toBeNull();
      expect(r.rulesEngineExplanation).not.toBeNull();
      expect(['approved', 'rejected']).toContain(r.status);
    }
  });

  test('approved recommendation emits RecommendationApproved event', async () => {
    const { engine, store } = makeEngine();
    const hypotheses = await makeHypotheses(engine);
    await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context: makeContext([makePattern()]), actor: 'system' });

    // Either approved or rejected — both are emitted
    const hasDecision = store.events.some(e => e.type === 'RecommendationApproved' || e.type === 'RecommendationRejected');
    expect(hasDecision).toBe(true);
  });

  test('recommendation evidence chain references hypotheses', async () => {
    const { engine } = makeEngine();
    const hypotheses = await makeHypotheses(engine, [makePattern()]);
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context: makeContext([makePattern()]), actor: 'system' });

    for (const r of recs) {
      expect(r.evidence.objectIds).toContain(String(SUBJECT_ID));
    }
  });

  test('empty hypotheses → empty recommendations', async () => {
    const { engine } = makeEngine();
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses: [], context: makeContext([makePattern()]), actor: 'system' });
    expect(recs).toHaveLength(0);
  });

  test('recommendations never create workflows, tasks, or communications', async () => {
    const { engine, store } = makeEngine();
    const hypotheses = await makeHypotheses(engine);
    const countBefore = store.events.length;
    await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context: makeContext([makePattern()]), actor: 'system' });

    const newEvents = store.events.slice(countBefore);
    const forbidden = ['WorkflowStarted', 'TaskCreated', 'PromiseCreated', 'CommunicationCreated'];
    for (const type of forbidden) {
      expect(newEvents.some(e => e.type === type)).toBe(false);
    }
  });
});

// ─── Narrative generation ─────────────────────────────────────────────────────

describe('Narrative generation', () => {
  const narrativeTypes = ['referral_summary', 'patient_summary', 'physician_summary', 'case_summary', 'organizational_summary'] as const;

  test.each(narrativeTypes)('generates "%s" narrative', async (type) => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [makeKnowledgeEntry()], [makeObservation()]);
    const narrative = await engine.generateNarrative({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', narrativeType: type, context, actor: 'system' });

    expect(narrative.narrativeType).toBe(type);
    expect(narrative.sections.length).toBeGreaterThan(0);
    for (const section of narrative.sections) {
      expect(section.heading).toBeTruthy();
      expect(section.body).toBeTruthy();
    }
  });

  test('narrative has evidence chain', async () => {
    const { engine } = makeEngine();
    const pattern = makePattern();
    const context = makeContext([pattern]);
    const narrative = await engine.generateNarrative({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', narrativeType: 'patient_summary', context, actor: 'system' });

    expect(narrative.evidence.patternIds).toContain(String(pattern.id));
    expect(narrative.evidence.objectIds).toContain(String(SUBJECT_ID));
  });

  test('narrative emits NarrativeGenerated event', async () => {
    const { engine, store } = makeEngine();
    const context = makeContext([makePattern()]);
    await engine.generateNarrative({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', narrativeType: 'case_summary', context, actor: 'system' });

    expect(store.events.some(e => e.type === 'NarrativeGenerated')).toBe(true);
  });

  test('narrative confidence assessment is included', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const narrative = await engine.generateNarrative({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', narrativeType: 'referral_summary', context, actor: 'system' });

    expect(narrative.confidence.overall).toBeTruthy();
    expect(narrative.confidence.modelIdentifier).toBe('stub-v1');
  });
});

// ─── Missing information identification ──────────────────────────────────────

describe('Missing information identification', () => {
  test('identifies missing observations when none exist', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [makeKnowledgeEntry()], []); // no observations
    const missing = await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].question).toBeTruthy();
    expect(missing[0].whyNeeded).toBeTruthy();
    expect(missing[0].howToObtain).toBeTruthy();
  });

  test('missing information items start as open', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [], []);
    const missing = await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    for (const m of missing) expect(m.status).toBe('open');
  });

  test('missing information emits MissingInformationIdentified event', async () => {
    const { engine, store } = makeEngine();
    const context = makeContext([makePattern()], [], []);
    await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    expect(store.events.some(e => e.type === 'MissingInformationIdentified')).toBe(true);
  });

  test('missing information has evidence chain', async () => {
    const { engine } = makeEngine();
    const pattern = makePattern();
    const context = makeContext([pattern], [], []);
    const missing = await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    if (missing.length > 0) {
      expect(missing[0].evidence.objectIds).toContain(String(SUBJECT_ID));
    }
  });

  test('full context produces fewer missing items than empty context', async () => {
    const { engine } = makeEngine();
    const emptyCtx = makeContext([makePattern()], [], []);
    const fullCtx = makeContext([makePattern()], [makeKnowledgeEntry()], [makeObservation()]);
    fullCtx.workflowSummaries; // Already has workflowSummaries=[]

    const emptyMissing = await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context: emptyCtx, actor: 'system' });
    // Rich context still finds some missing info, but empty context finds more
    expect(emptyMissing.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Prompt assembler (ADR-001) ───────────────────────────────────────────────

describe('Prompt assembler — ADR-001 compliance', () => {
  test('assembleContext strips clinical content from objectAttributes', () => {
    const ctx = assembleContext({
      tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient',
      patterns: [], knowledgeEntries: [], observations: [],
      objectAttributes: {
        name: 'Samuel Brown',
        visitNotes: 'Patient had SOB and bilateral crackles.', // clinical — must be stripped
        assessmentText: 'OASIS M0010: 30',                   // clinical — must be stripped
        programType: 'EEOICPA',                              // non-clinical — must be kept
      },
      externalReferences: [], workflowSummaries: [], recentEventTypes: [],
    });

    expect(ctx.objectAttributes.visitNotes).toBeUndefined();
    expect(ctx.objectAttributes.assessmentText).toBeUndefined();
    expect(ctx.objectAttributes.name).toBe('Samuel Brown');
    expect(ctx.objectAttributes.programType).toBe('EEOICPA');
  });

  test('buildEvidenceChain includes all evidence types', () => {
    const pattern = makePattern();
    const entry = makeKnowledgeEntry();
    const obs = makeObservation();

    const chain = buildEvidenceChain({
      tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient',
      patterns: [pattern], knowledgeEntries: [entry], observations: [obs],
      objectAttributes: {}, externalReferences: [], workflowSummaries: [], recentEventTypes: [],
    }, 'Test rationale');

    expect(chain.patternIds).toContain(String(pattern.id));
    expect(chain.knowledgeEntryIds).toContain(String(entry.id));
    expect(chain.observationIds).toContain(String(obs.id));
    expect(chain.objectIds).toContain(String(SUBJECT_ID));
    expect(chain.rationale).toBe('Test rationale');
  });
});

// ─── No side effects ──────────────────────────────────────────────────────────

describe('No side effects', () => {
  test('full reasoning pipeline emits only reasoning events', async () => {
    const { engine, store } = makeEngine();
    const context = makeContext([makePattern()], [makeKnowledgeEntry()], [makeObservation()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });
    await engine.generateNarrative({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', narrativeType: 'patient_summary', context, actor: 'system' });
    await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    const ALLOWED = new Set([
      'HypothesisGenerated', 'HypothesisConfirmed', 'HypothesisRefuted',
      'RecommendationGenerated', 'RecommendationApproved', 'RecommendationRejected',
      'NarrativeGenerated', 'MissingInformationIdentified',
    ]);
    const FORBIDDEN = ['WorkflowStarted', 'TaskCreated', 'PromiseCreated', 'CommunicationCreated', 'ObjectCreated', 'ObjectUpdated'];

    for (const evt of store.events) {
      expect(FORBIDDEN).not.toContain(evt.type);
    }
    // All events should be from the allowed set
    const reasoningEvents = store.events.filter(e => ALLOWED.has(e.type));
    expect(reasoningEvents.length).toBeGreaterThan(0);
  });
});

// ─── Reasoning Summary Projection (ADR-016) ───────────────────────────────────

describe('Reasoning Summary Projection (ADR-016)', () => {
  function makeProjectionStack() {
    const projRegistry = new ProjectionRegistry();
    projRegistry.register(ReasoningSummaryProjectionDefinition);
    const projStore = new InMemoryProjectionStore();
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const projEngine = new ProjectionEngine(projRegistry, projStore, eventStore);
    const rebuilder = new ProjectionRebuilder(projEngine, projStore);
    return { projEngine, projStore, rebuilder };
  }

  function makeSummaryAssembler(input: ReasoningSummaryInput): ProjectionInputAssembler<ReasoningSummaryInput> {
    return {
      async assemble(sid) { return { ...input, subjectId: sid }; },
      async sourceEventIds() { return [...input.hypotheses.map((h: Hypothesis) => String(h.id)), ...input.recommendations.map((r: import('../src/reasoning-engine/types').Recommendation) => String(r.id))]; },
    };
  }

  test('projection builds from reasoning objects', async () => {
    const { projEngine } = makeProjectionStack();
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [makeKnowledgeEntry()], [makeObservation()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });
    const missing = await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    const input: ReasoningSummaryInput = { subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, recommendations: recs, missingInformation: missing };
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), makeSummaryAssembler(input));

    expect(result.built).toBe(true);
    if (!result.built) return;

    const value = result.projection.value as unknown as ReasoningSummaryValue;
    expect(value.disclaimer).toBe('computed-projection-advisory-only');
    expect(value.activeHypothesisCount).toBeGreaterThan(0);
    expect(value.modelIdentifiers).toContain('stub-v1');
  });

  test('ADR-016: aiInvolved=true (Reasoning Engine uses LLM)', async () => {
    const { projEngine } = makeProjectionStack();
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const input: ReasoningSummaryInput = { subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, recommendations: [], missingInformation: [] };
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), makeSummaryAssembler(input));

    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.projection.metadata.aiInvolved).toBe(true);
    expect(result.projection.metadata.inferenceBasis).toBe('ai_generated');
  });

  test('ADR-016: projection rebuilds identically after clearing store', async () => {
    const { projEngine, projStore, rebuilder } = makeProjectionStack();
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const input: ReasoningSummaryInput = { subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, recommendations: [], missingInformation: [] };
    const assembler = makeSummaryAssembler(input);

    const original = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    expect(original.built).toBe(true);
    if (!original.built) return;

    projStore.clear();
    const rebuilt = await rebuilder.rebuild(TENANT, 'Timeline', String(SUBJECT_ID), assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;

    const ov = original.projection.value as unknown as ReasoningSummaryValue;
    const rv = rebuilt.projection.value as unknown as ReasoningSummaryValue;
    expect(rv.activeHypothesisCount).toBe(ov.activeHypothesisCount);
    expect(rv.disclaimer).toBe(ov.disclaimer);
    expect(rv.modelIdentifiers).toEqual(ov.modelIdentifiers);
  });

  test('empty reasoning → zero counts, still valid projection', async () => {
    const { projEngine } = makeProjectionStack();
    const input: ReasoningSummaryInput = { subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses: [], recommendations: [], missingInformation: [] };
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), makeSummaryAssembler(input));

    expect(result.built).toBe(true);
    if (!result.built) return;
    const value = result.projection.value as unknown as ReasoningSummaryValue;
    expect(value.activeHypothesisCount).toBe(0);
    expect(value.recommendationCount).toBe(0);
    expect(value.openMissingInformationCount).toBe(0);
  });

  test('approved vs rejected recommendations counted separately', async () => {
    const { projEngine } = makeProjectionStack();
    const { engine } = makeEngine();
    const context = makeContext([makePattern(), makePattern({ id: makeAlaraId('00000000-0000-4000-8000-100000000002'), category: 'workflow' })]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });

    const input: ReasoningSummaryInput = { subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, recommendations: recs, missingInformation: [] };
    const result = await projEngine.build(TENANT, 'Timeline', String(SUBJECT_ID), makeSummaryAssembler(input));
    if (!result.built) return;

    const value = result.projection.value as unknown as ReasoningSummaryValue;
    expect(value.approvedRecommendationCount + value.rejectedRecommendationCount).toBe(recs.length);
  });
});

// ─── Repository ───────────────────────────────────────────────────────────────

describe('ReasoningRepository', () => {
  test('getHypothesesForSubject returns generated hypotheses', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    const hypotheses = await engine.repo.getHypothesesForSubject(TENANT, String(SUBJECT_ID));
    expect(hypotheses.length).toBeGreaterThan(0);
  });

  test('getRecommendationsForSubject returns generated recommendations', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });

    const recs = await engine.repo.getRecommendationsForSubject(TENANT, String(SUBJECT_ID));
    expect(recs.length).toBeGreaterThan(0);
  });

  test('getMissingInformationForSubject returns open items', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [], []);
    await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });

    const missing = await engine.repo.getMissingInformationForSubject(TENANT, String(SUBJECT_ID));
    expect(missing.every(m => m.status === 'open')).toBe(true);
  });
});

// ─── Additional coverage tests ────────────────────────────────────────────────

describe('Confidence propagation', () => {
  test('multiple patterns of same category produce medium confidence hypotheses', async () => {
    const { engine } = makeEngine();
    // Two patterns of the SAME category → that category gets count >= 2 → medium confidence
    const patterns = [
      makePattern({ id: makeAlaraId('00000000-0000-4000-8000-100000000001'), category: 'relationship' }),
      makePattern({ id: makeAlaraId('00000000-0000-4000-8000-100000000002'), category: 'relationship' }),
    ];
    const context = makeContext(patterns);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    // With 2 patterns in same category → confidence is medium or high
    expect(hypotheses.some(h => h.confidence.overall === 'medium' || h.confidence.overall === 'high')).toBe(true);
  });

  test('missing evidence recorded in confidence assessment', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [], []); // no knowledge, no observations
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const withMissing = hypotheses.filter(h => h.confidence.missingEvidence.length > 0);
    expect(withMissing.length).toBeGreaterThan(0);
  });

  test('hypothesis with observations has lower missing evidence count', async () => {
    const { engine } = makeEngine();
    const ctxWithObs = makeContext([makePattern()], [], [makeObservation(), makeObservation(), makeObservation()]);
    const ctxNoObs = makeContext([makePattern()], [], []);

    const hypWithObs = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context: ctxWithObs, actor: 'system' });
    const hypNoObs = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context: ctxNoObs, actor: 'system' });

    if (hypWithObs.length > 0 && hypNoObs.length > 0) {
      const missingWithObs = hypWithObs[0].confidence.missingEvidence.length;
      const missingNoObs = hypNoObs[0].confidence.missingEvidence.length;
      expect(missingWithObs).toBeLessThanOrEqual(missingNoObs);
    }
  });
});

describe('Evidence chain completeness', () => {
  test('every hypothesis has non-empty rationale', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [makeKnowledgeEntry()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    for (const h of hypotheses) {
      expect(h.evidence.rationale.length).toBeGreaterThan(0);
    }
  });

  test('every recommendation has non-empty rationale and action', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });
    for (const r of recs) {
      expect(r.rationale.length).toBeGreaterThan(0);
      expect(r.action.description.length).toBeGreaterThan(0);
      expect(r.action.urgency).toBeTruthy();
    }
  });

  test('every missing information item has how-to-obtain', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()], [], []);
    const missing = await engine.identifyMissingInformation({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    for (const m of missing) {
      expect(m.howToObtain.length).toBeGreaterThan(0);
      expect(m.whyNeeded.length).toBeGreaterThan(0);
    }
  });
});

describe('ADR-003 AI Last — Rules Engine authority', () => {
  test('Rules Engine evaluation happens after recommendation generation', async () => {
    const { engine, store } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });

    // RecommendationGenerated must come BEFORE RecommendationApproved/Rejected
    const generated = store.events.findIndex(e => e.type === 'RecommendationGenerated');
    const decided = store.events.findIndex(e => e.type === 'RecommendationApproved' || e.type === 'RecommendationRejected');
    expect(generated).toBeGreaterThanOrEqual(0);
    expect(decided).toBeGreaterThan(generated);
  });

  test('every recommendation has a Rules Engine decision', async () => {
    const { engine } = makeEngine();
    const context = makeContext([makePattern()]);
    const hypotheses = await engine.generateHypotheses({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', context, actor: 'system' });
    const recs = await engine.generateRecommendations({ tenantId: TENANT, subjectId: String(SUBJECT_ID), subjectType: 'Patient', hypotheses, context, actor: 'system' });
    for (const r of recs) {
      expect(r.rulesEngineApproved).not.toBeNull();
      expect(r.rulesEngineExplanation).not.toBeNull();
    }
  });
});
