/**
 * Alara OS — M11 Retrieval & Query Engine Tests
 *
 * Coverage (success criteria from docs/M11-retrieval-spec.md):
 *   - Cross-boundary query spanning object + edge + event + projection
 *   - Permission leakage: same query, different actor → different scoped results
 *   - Consent/participation-style scoping changes results
 *   - Provenance present on every result
 *   - Read-only: no writes performed, NO domain events emitted
 *   - ADR-016 boundary: no ProjectionType added; retrieval reads, never computes
 */

import { RetrievalEngine, RetrievalSources } from '../src/retrieval-engine/engine';
import {
  RetrievalPermissionGate,
  RETRIEVAL_READ_RULESET,
  RETRIEVAL_READ_EVENT,
} from '../src/retrieval-engine/permission-gate';
import { RetrievalQuery } from '../src/retrieval-engine/types';

import { ObjectGraphRepository } from '../src/object-graph/repository';
import { RelationshipRepository } from '../src/relationship-engine/repository';
import { EventStore } from '../src/events/store';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { StoredProjection } from '../src/projection-engine/types';

import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { PolicyModule, RuleContext, PolicyEvaluation, RuleSet } from '../src/rules-engine/types';

import { InMemoryStore } from './helpers/in-memory-store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { AlaraId } from '../src/shared/types';

// ─── Constants ──────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const ACTOR_ALLOWED = 'wm-care-guide-allowed';
const ACTOR_DENIED = 'wm-external-denied';

// Visibility policy: ACTOR_ALLOWED sees everything; ACTOR_DENIED is denied any
// record marked restricted. Stands in for consent/participation scoping and
// proves the gate filters INSIDE the query boundary.
const VisibilityPolicy: PolicyModule = {
  id: 'test.retrieval.visibility',
  name: 'Test Retrieval Visibility Policy',
  version: '1.0.0',
  priority: 1,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = (context.objects.record ?? {}) as Record<string, unknown>;
    const denied = isRestricted(record) && context.actor === ACTOR_DENIED;
    return {
      moduleId: 'test.retrieval.visibility',
      outcome: denied ? 'DENY' : 'ALLOW',
      appliedRules: [],
      skippedRules: [],
      actions: [],
      reasoning: denied ? 'restricted record not visible to actor' : 'visible',
    };
  },
};

function isRestricted(record: Record<string, unknown>): boolean {
  if (record.restricted === true) return true;
  for (const v of Object.values(record)) {
    if (v && typeof v === 'object' && (v as Record<string, unknown>).restricted === true) return true;
  }
  return false;
}

const READ_RULESET: RuleSet = {
  id: RETRIEVAL_READ_RULESET,
  name: 'Retrieval Read Gate',
  description: 'Visibility gate for retrieval reads',
  version: '1.0.0',
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

interface Harness {
  store: InMemoryStore;
  projStore: InMemoryProjectionStore;
  engine: RetrievalEngine;
  sources: RetrievalSources;
}

function makeHarness(): Harness {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const objects = new ObjectGraphRepository(db);
  const events = new EventStore(db);
  const relationships = new RelationshipRepository(db);
  const projStore = new InMemoryProjectionStore();
  const projections = new ProjectionEngine(new ProjectionRegistry(), projStore, events);

  const registry = new RulesRegistry();
  registry.registerRuleSet(READ_RULESET);
  registry.registerPolicyModule(VisibilityPolicy);
  const rules = new RulesEngine(registry, new NoopAuditSink());
  const gate = new RetrievalPermissionGate(rules);

  const sources: RetrievalSources = { objects, events, relationships, projections };
  const engine = new RetrievalEngine(sources, gate);
  return { store, projStore, engine, sources };
}

async function makePatient(
  h: Harness,
  attributes: Record<string, unknown>,
): Promise<AlaraId> {
  const obj = await h.sources.objects.create({
    tenantId: TENANT,
    type: 'Patient',
    state: 'active',
    attributes,
    actor: 'system',
  });
  return obj.id;
}

function seedTimeline(h: Harness, subjectId: AlaraId): void {
  const projection: StoredProjection = {
    id: makeAlaraId('00000000-0000-4000-8000-0000000000d1'),
    metadata: {
      projectionType: 'Timeline',
      subjectId,
      tenantId: TENANT,
      canonicalInputs: [],
      methodName: 'timeline',
      methodVersion: '1',
      freshUntil: null,
      sourceEventIds: [],
      confidence: 'high',
      inferenceBasis: 'fact',
      aiInvolved: false,
      lastBuiltAt: new Date().toISOString(),
      buildNumber: 1,
    },
    value: { entries: [] },
  };
  void h.projStore.save(projection);
}

function seedEdge(h: Harness, subjectId: AlaraId, participant: string): void {
  const relId = makeAlaraId('00000000-0000-4000-8000-0000000000b1');
  h.store.relationships.set(relId, {
    id: relId, tenant_id: TENANT, type: 'CareTeam', status: 'active',
    subject_id: subjectId, description: '', version: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    terminated_at: null, termination_reason: null,
  });
  const edgeId = makeAlaraId('00000000-0000-4000-8000-0000000000c1');
  h.store.edges.set(edgeId, {
    id: edgeId, tenant_id: TENANT, relationship_id: relId,
    participant_id: participant, participant_type: 'WorkforceMember', role: 'Owner',
    active: true, started_at: new Date().toISOString(), ended_at: null,
    coverage_expires_at: null, version: 1,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('M11 Retrieval & Query Engine', () => {
  test('reads an object by id with provenance', async () => {
    const h = makeHarness();
    const id = await makePatient(h, { dob: '1950-02-02' });

    const result = await h.engine.query({
      tenantId: TENANT,
      actor: ACTOR_ALLOWED,
      sources: [{ source: 'object', subjectId: id }],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('object');
    expect(result.results[0].provenance.source).toBe('object');
    expect(result.results[0].provenance.recordId).toBe(id);
  });

  test('cross-boundary query spans object + event + edge + projection', async () => {
    const h = makeHarness();
    const id = await makePatient(h, { dob: '1950-03-03' });

    await h.sources.events.append({
      tenantId: TENANT,
      streamId: id,
      type: 'ObjectCreated',
      payload: { note: 'intake' },
      actor: 'system',
    });
    seedEdge(h, id, ACTOR_ALLOWED);
    seedTimeline(h, id);

    const result = await h.engine.query({
      tenantId: TENANT,
      actor: ACTOR_ALLOWED,
      sources: [
        { source: 'object', subjectId: id },
        { source: 'event', streamId: id },
        { source: 'edge', subjectId: id },
        { source: 'projection', projectionType: 'Timeline', subjectId: id },
      ],
    });

    const sources = result.results.map((r) => r.source).sort();
    expect(sources).toEqual(['edge', 'event', 'object', 'projection']);
    for (const r of result.results) {
      expect(r.provenance).toBeDefined();
      expect(r.provenance.recordId).toBeTruthy();
    }
  });

  test('permission leakage: same query, different actor → different results', async () => {
    const h = makeHarness();
    const id = await makePatient(h, { dob: '1950-04-04', restricted: true });

    const q = (actor: string): RetrievalQuery => ({
      tenantId: TENANT, actor, sources: [{ source: 'object', subjectId: id }],
    });

    const allowed = await h.engine.query(q(ACTOR_ALLOWED));
    const denied = await h.engine.query(q(ACTOR_DENIED));

    expect(allowed.results).toHaveLength(1);
    expect(denied.results).toHaveLength(0);
    expect(denied.deniedCount).toBe(1);
  });

  test('scoping change (restricted flag) changes results for the same actor', async () => {
    const h = makeHarness();
    const open = await makePatient(h, { dob: '1950-05-05' });
    const closed = await makePatient(h, { dob: '1950-06-06', restricted: true });

    const result = await h.engine.query({
      tenantId: TENANT,
      actor: ACTOR_DENIED,
      sources: [
        { source: 'object', subjectId: open },
        { source: 'object', subjectId: closed },
      ],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].provenance.recordId).toBe(open);
    expect(result.deniedCount).toBe(1);
  });

  test('READ-ONLY: a query emits no domain events and writes nothing', async () => {
    const h = makeHarness();
    const id = await makePatient(h, {});
    seedEdge(h, id, ACTOR_ALLOWED);

    const eventsBefore = h.store.events.length;
    const objectsBefore = h.store.objects.size;
    const projBefore = h.projStore.size();

    await h.engine.query({
      tenantId: TENANT,
      actor: ACTOR_ALLOWED,
      sources: [
        { source: 'object', subjectId: id },
        { source: 'event', streamId: id },
        { source: 'edge', subjectId: id },
      ],
    });

    expect(h.store.events.length).toBe(eventsBefore);
    expect(h.store.objects.size).toBe(objectsBefore);
    expect(h.projStore.size()).toBe(projBefore);
  });

  test('ADR-016 boundary: filters select but do not compute; missing projection mints nothing', async () => {
    const h = makeHarness();
    const id = await makePatient(h, { dob: '1950-07-07' });

    const match = await h.engine.query({
      tenantId: TENANT, actor: ACTOR_ALLOWED,
      sources: [{ source: 'object', subjectId: id, filters: [{ field: 'type', operator: 'eq', value: 'Patient' }] }],
    });
    expect(match.results).toHaveLength(1);

    const noMatch = await h.engine.query({
      tenantId: TENANT, actor: ACTOR_ALLOWED,
      sources: [{ source: 'object', subjectId: id, filters: [{ field: 'type', operator: 'eq', value: 'Workflow' }] }],
    });
    expect(noMatch.results).toHaveLength(0);

    // Reading a projection type with nothing stored yields nothing — retrieval
    // never creates/mints a projection or a ProjectionType.
    const noProj = await h.engine.query({
      tenantId: TENANT, actor: ACTOR_ALLOWED,
      sources: [{ source: 'projection', projectionType: 'Timeline', subjectId: id }],
    });
    expect(noProj.results).toHaveLength(0);
  });

  test('the read gate contract is stable', () => {
    expect(RETRIEVAL_READ_EVENT).toBe('RetrievalRead');
    expect(RETRIEVAL_READ_RULESET).toBe('retrieval-read');
  });
});

// ─── Read-gate fail-closed (P0: no read policy registered → suppress) ──────────

describe('RetrievalPermissionGate — fail closed without a read policy', () => {
  test('no read policy registered → record is NOT visible (engine fails closed)', async () => {
    // Registry knows the rule set but has NO policy module for it.
    const registry = new RulesRegistry();
    registry.registerRuleSet(READ_RULESET);
    const gate = new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));

    const visible = await gate.isVisible({
      tenantId: TENANT, actor: ACTOR_ALLOWED, source: 'object',
      record: { id: 'r1', restricted: false },
    });
    expect(visible).toBe(false); // unconfigured read authz must suppress, not admit
  });

  test('with a read policy registered, an allowed record IS visible', async () => {
    const registry = new RulesRegistry();
    registry.registerRuleSet(READ_RULESET);
    registry.registerPolicyModule(VisibilityPolicy);
    const gate = new RetrievalPermissionGate(new RulesEngine(registry, new NoopAuditSink()));

    const visible = await gate.isVisible({
      tenantId: TENANT, actor: ACTOR_ALLOWED, source: 'object',
      record: { id: 'r1', restricted: false },
    });
    expect(visible).toBe(true);
  });
});
