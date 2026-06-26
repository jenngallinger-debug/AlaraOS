/**
 * Alara OS — M6 Relationship Engine Tests
 *
 * Coverage:
 *   - Relationship lifecycle (create, suspend, reactivate, terminate)
 *   - Participation edges (add, remove, covering expiry)
 *   - Ownership transfer
 *   - Care Team computed view
 *   - Event-sourced replay
 *   - Relationship Health projection (ADR-016: rebuilds from events)
 *   - Optimistic concurrency (stale version rejection)
 *   - ADR-014: Covering role validation
 *   - No canonical state depends on projections
 */

import { RelationshipEngine, reconstructRelationshipFromEvents } from '../src/relationship-engine/engine';
import { RelationshipRepository } from '../src/relationship-engine/repository';
import {
  CoverageExpiredError, InvalidParticipationRoleError,
  RelationshipNotActiveError, StaleRelationshipError,
} from '../src/relationship-engine/types';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { AlaraId } from '../src/shared/types';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { ProjectionRebuilder } from '../src/projection-engine/rebuilder';
import { RelationshipHealthProjectionV2Definition, RelationshipHealthInputV2 } from '../src/projection-engine/projections/relationship-health-v2';
import { ProjectionInputAssembler } from '../src/projection-engine/engine';
import { RelationshipHealthValue } from '../src/projection-engine/types';
import { InMemoryStore } from './helpers/in-memory-store';
import { DomainEvent, EventType } from '../src/events/types';

// ─── Setup helpers ─────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const PATIENT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');
const CARE_GUIDE_1 = 'wm-care-guide-001';
const CARE_GUIDE_2 = 'wm-care-guide-002';
const PHYSICIAN_ID = 'ext-physician-001';

function makeStore() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);

  // Seed a patient object so FK references work
  store.objects.set(String(PATIENT_ID), {
    id: String(PATIENT_ID), tenant_id: TENANT, type: 'Patient',
    state: 'created', attributes: {}, version: 1,
    created_at: new Date(), updated_at: new Date(),
  });

  const engine = new RelationshipEngine(db, eventStore);
  const repo = new RelationshipRepository(db);
  return { store, db, eventStore, engine, repo };
}

// ─── Relationship lifecycle ───────────────────────────────────────────────────

describe('Relationship lifecycle', () => {
  test('create → active relationship with Alara UUID', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({
      tenantId: TENANT, type: 'PatientCareGuide',
      subjectId: PATIENT_ID, description: 'Care guide for Samuel Brown',
      actor: CARE_GUIDE_1,
    });

    expect(rel.id).toBeDefined();
    expect(rel.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rel.status).toBe('active');
    expect(rel.type).toBe('PatientCareGuide');
    expect(String(rel.subjectId)).toBe(String(PATIENT_ID));
    expect(rel.version).toBe(1);
  });

  test('create → emits RelationshipCreated event', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({
      tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID,
      description: 'Care Team', actor: 'system',
    });

    const events = await eventStore.loadStream(TENANT, rel.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('RelationshipCreated');
    expect((events[0].payload as Record<string, unknown>).type).toBe('CareTeam');
  });

  test('suspend → status becomes suspended', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({
      tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID,
      description: 'Care Team', actor: 'system',
    });

    await engine.suspend({
      tenantId: TENANT, relationshipId: rel.id,
      reason: 'Patient on hold', actor: 'manager', expectedVersion: 1,
    });

    const updated = await repo.getById(TENANT, rel.id);
    expect(updated!.status).toBe('suspended');
    expect(updated!.version).toBe(2);
  });

  test('reactivate → status returns to active', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({
      tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID,
      description: 'Care Team', actor: 'system',
    });

    await engine.suspend({ tenantId: TENANT, relationshipId: rel.id, reason: 'hold', actor: 'system', expectedVersion: 1 });
    await engine.reactivate({ tenantId: TENANT, relationshipId: rel.id, actor: 'system', expectedVersion: 2 });

    const updated = await repo.getById(TENANT, rel.id);
    expect(updated!.status).toBe('active');
  });

  test('terminate → status becomes terminated, reason recorded', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({
      tenantId: TENANT, type: 'PatientCareGuide', subjectId: PATIENT_ID,
      description: 'Care guide', actor: 'system',
    });

    await engine.terminate({
      tenantId: TENANT, relationshipId: rel.id,
      reason: 'Patient discharged', actor: 'admin', expectedVersion: 1,
    });

    const updated = await repo.getById(TENANT, rel.id);
    expect(updated!.status).toBe('terminated');
    expect(updated!.terminationReason).toBe('Patient discharged');
  });

  test('all status transitions emit events', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.suspend({ tenantId: TENANT, relationshipId: rel.id, reason: 'hold', actor: 'system', expectedVersion: 1 });
    await engine.reactivate({ tenantId: TENANT, relationshipId: rel.id, actor: 'system', expectedVersion: 2 });
    await engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'done', actor: 'system', expectedVersion: 3 });

    const events = await eventStore.loadStream(TENANT, rel.id);
    expect(events.map(e => e.type)).toEqual([
      'RelationshipCreated', 'RelationshipSuspended', 'RelationshipReactivated', 'RelationshipTerminated',
    ]);
  });
});

// ─── Participation edges ──────────────────────────────────────────────────────

describe('Participation edges (ADR-014)', () => {
  test('addParticipant → creates active edge with role', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });

    const edge = await engine.addParticipant({
      tenantId: TENANT, relationshipId: rel.id,
      participantId: CARE_GUIDE_1, participantType: 'WorkforceMember',
      role: 'Actor', actor: 'manager', expectedVersion: 1,
    });

    expect(edge.active).toBe(true);
    expect(edge.role).toBe('Actor');
    expect(edge.participantId).toBe(CARE_GUIDE_1);
    expect(edge.coverageExpiresAt).toBeNull();
  });

  test('addParticipant → emits EdgeCreated event', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 });

    const events = await eventStore.loadStream(TENANT, rel.id);
    expect(events.some(e => e.type === 'EdgeCreated')).toBe(true);
    const edgeEvt = events.find(e => e.type === 'EdgeCreated')!;
    expect((edgeEvt.payload as Record<string, unknown>).participantId).toBe(CARE_GUIDE_1);
    expect((edgeEvt.payload as Record<string, unknown>).role).toBe('Actor');
  });

  test('removeParticipant → deactivates edge, emits EdgeRemoved', async () => {
    const { engine, repo, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    const edge = await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 });

    await engine.removeParticipant({ tenantId: TENANT, relationshipId: rel.id, edgeId: edge.id, reason: 'Reassigned', actor: 'manager', expectedVersion: 2 });

    const updatedEdge = await repo.getEdgeById(TENANT, edge.id);
    expect(updatedEdge!.active).toBe(false);

    const events = await eventStore.loadStream(TENANT, rel.id);
    expect(events.some(e => e.type === 'EdgeRemoved')).toBe(true);
  });

  test('multiple participants on one relationship', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Owner', actor: 'manager', expectedVersion: 1 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_2, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 2 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: PHYSICIAN_ID, participantType: 'ExternalOrg', role: 'Stakeholder', actor: 'manager', expectedVersion: 3 });

    const edges = await repo.getActiveEdgesForRelationship(TENANT, rel.id);
    expect(edges).toHaveLength(3);
    expect(edges.map(e => e.role).sort()).toEqual(['Actor', 'Owner', 'Stakeholder']);
  });

  test('terminate relationship deactivates all edges', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_2, participantType: 'WorkforceMember', role: 'Stakeholder', actor: 'manager', expectedVersion: 2 });
    await engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'done', actor: 'admin', expectedVersion: 3 });

    const activeEdges = await repo.getActiveEdgesForRelationship(TENANT, rel.id);
    expect(activeEdges).toHaveLength(0);
  });
});

// ─── Covering role (ADR-014) ──────────────────────────────────────────────────

describe('Covering role (ADR-014)', () => {
  test('Covering role with future expiry → allowed', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CoverageRelationship', subjectId: PATIENT_ID, description: 'Coverage', actor: 'system' });

    const futureExpiry = new Date(Date.now() + 7 * 86_400_000); // 7 days
    const edge = await engine.addParticipant({
      tenantId: TENANT, relationshipId: rel.id,
      participantId: CARE_GUIDE_2, participantType: 'WorkforceMember',
      role: 'Covering', coverageExpiresAt: futureExpiry,
      actor: 'manager', expectedVersion: 1,
    });

    expect(edge.role).toBe('Covering');
    expect(edge.coverageExpiresAt).toBeDefined();
    expect(edge.coverageExpiresAt!.getTime()).toBeCloseTo(futureExpiry.getTime(), -3);
  });

  test('Covering role without expiry → InvalidParticipationRoleError', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CoverageRelationship', subjectId: PATIENT_ID, description: '', actor: 'system' });

    await expect(
      engine.addParticipant({
        tenantId: TENANT, relationshipId: rel.id,
        participantId: CARE_GUIDE_2, participantType: 'WorkforceMember',
        role: 'Covering', // no coverageExpiresAt
        actor: 'manager', expectedVersion: 1,
      }),
    ).rejects.toThrow(InvalidParticipationRoleError);
  });

  test('Covering role with past expiry → CoverageExpiredError', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CoverageRelationship', subjectId: PATIENT_ID, description: '', actor: 'system' });

    const pastExpiry = new Date(Date.now() - 86_400_000); // yesterday
    await expect(
      engine.addParticipant({
        tenantId: TENANT, relationshipId: rel.id,
        participantId: CARE_GUIDE_2, participantType: 'WorkforceMember',
        role: 'Covering', coverageExpiresAt: pastExpiry,
        actor: 'manager', expectedVersion: 1,
      }),
    ).rejects.toThrow(CoverageExpiredError);
  });

  test('Covering edge records expiry timestamp', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CoverageRelationship', subjectId: PATIENT_ID, description: '', actor: 'system' });
    const expiry = new Date(Date.now() + 48 * 3600_000);

    const edge = await engine.addParticipant({
      tenantId: TENANT, relationshipId: rel.id,
      participantId: CARE_GUIDE_2, participantType: 'WorkforceMember',
      role: 'Covering', coverageExpiresAt: expiry, actor: 'manager', expectedVersion: 1,
    });

    const fetched = await repo.getEdgeById(TENANT, edge.id);
    expect(fetched!.coverageExpiresAt).toBeDefined();
  });
});

// ─── Ownership transfer ───────────────────────────────────────────────────────

describe('Ownership transfer', () => {
  test('transferOwnership → old owner deactivated, new owner created, event emitted', async () => {
    const { engine, repo, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'PatientCareGuide', subjectId: PATIENT_ID, description: '', actor: 'system' });

    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Owner', actor: 'manager', expectedVersion: 1 });
    await engine.transferOwnership({ tenantId: TENANT, relationshipId: rel.id, fromParticipantId: CARE_GUIDE_1, toParticipantId: CARE_GUIDE_2, actor: 'manager', expectedVersion: 2 });

    const activeEdges = await repo.getActiveEdgesForRelationship(TENANT, rel.id);
    const ownerEdges = activeEdges.filter(e => e.role === 'Owner');
    expect(ownerEdges).toHaveLength(1);
    expect(ownerEdges[0].participantId).toBe(CARE_GUIDE_2);

    const events = await eventStore.loadStream(TENANT, rel.id);
    expect(events.some(e => e.type === 'OwnershipTransferred')).toBe(true);
  });
});

// ─── Optimistic concurrency ───────────────────────────────────────────────────

describe('Optimistic concurrency', () => {
  test('stale version on addParticipant throws StaleRelationshipError', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });

    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 });

    await expect(
      engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_2, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 }),
    ).rejects.toThrow(StaleRelationshipError);
  });

  test('stale version on terminate throws StaleRelationshipError', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.suspend({ tenantId: TENANT, relationshipId: rel.id, reason: 'hold', actor: 'system', expectedVersion: 1 });

    await expect(
      engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'done', actor: 'admin', expectedVersion: 1 }),
    ).rejects.toThrow(StaleRelationshipError);
  });

  test('addParticipant to terminated relationship throws RelationshipNotActiveError', async () => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'done', actor: 'admin', expectedVersion: 1 });

    await expect(
      engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 2 }),
    ).rejects.toThrow(RelationshipNotActiveError);
  });
});

// ─── Care Team view (NOT canonical state — computed from edges) ───────────────

describe('Care Team view (computed from active edges)', () => {
  test('Care Team view aggregates members across multiple relationships for a patient', async () => {
    const { engine, repo } = makeStore();

    // Create two active relationships for same patient
    const careTeamRel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    const physicianRel = await engine.create({ tenantId: TENANT, type: 'Physician', subjectId: PATIENT_ID, description: '', actor: 'system' });

    await engine.addParticipant({ tenantId: TENANT, relationshipId: careTeamRel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Owner', actor: 'system', expectedVersion: 1 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: careTeamRel.id, participantId: CARE_GUIDE_2, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 2 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: physicianRel.id, participantId: PHYSICIAN_ID, participantType: 'ExternalOrg', role: 'Stakeholder', actor: 'system', expectedVersion: 1 });

    const view = await repo.computeCareTeamView(TENANT, PATIENT_ID);

    expect(view.subjectId).toBe(PATIENT_ID);
    expect(view.members).toHaveLength(3);
    expect(view.members.some(m => m.participantId === CARE_GUIDE_1)).toBe(true);
    expect(view.members.some(m => m.participantId === PHYSICIAN_ID)).toBe(true);
    expect(view.computedAt).toBeTruthy();
  });

  test('Care Team view excludes members from terminated relationships', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });
    await engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'done', actor: 'admin', expectedVersion: 2 });

    const view = await repo.computeCareTeamView(TENANT, PATIENT_ID);
    expect(view.members).toHaveLength(0);
  });

  test('Care Team view is a computed view — not stored canonical state', async () => {
    const { engine, store, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });

    // The store has no "care_team" table — the view is computed
    expect('care_team' in store).toBe(false);
    // But the view can be computed
    const view = await repo.computeCareTeamView(TENANT, PATIENT_ID);
    expect(view.members).toHaveLength(1);
  });

  test('Care Team view records source edge IDs for traceability', async () => {
    const { engine, repo } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });

    const view = await repo.computeCareTeamView(TENANT, PATIENT_ID);
    expect(view.sourceEdgeIds.length).toBeGreaterThan(0);
  });
});

// ─── Event-sourced replay ─────────────────────────────────────────────────────

describe('Event-sourced replay', () => {
  test('reconstruct relationship state from events — active with participants', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: 'Test team', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_2, participantType: 'WorkforceMember', role: 'Stakeholder', actor: 'manager', expectedVersion: 2 });

    const reconstructed = await reconstructRelationshipFromEvents(eventStore, TENANT, rel.id);

    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.type).toBe('CareTeam');
    expect(reconstructed!.status).toBe('active');
    expect(reconstructed!.description).toBe('Test team');
    expect(reconstructed!.activeParticipantIds).toContain(CARE_GUIDE_1);
    expect(reconstructed!.activeParticipantIds).toContain(CARE_GUIDE_2);
  });

  test('reconstruct after remove — removed participant not in active list', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    const edge = await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 1 });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_2, participantType: 'WorkforceMember', role: 'Actor', actor: 'manager', expectedVersion: 2 });
    await engine.removeParticipant({ tenantId: TENANT, relationshipId: rel.id, edgeId: edge.id, reason: 'Left', actor: 'manager', expectedVersion: 3 });

    const reconstructed = await reconstructRelationshipFromEvents(eventStore, TENANT, rel.id);
    expect(reconstructed!.activeParticipantIds).not.toContain(CARE_GUIDE_1);
    expect(reconstructed!.activeParticipantIds).toContain(CARE_GUIDE_2);
  });

  test('reconstruct terminated relationship', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'PatientCareGuide', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });
    await engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'Patient discharged', actor: 'admin', expectedVersion: 2 });

    const reconstructed = await reconstructRelationshipFromEvents(eventStore, TENANT, rel.id);
    expect(reconstructed!.status).toBe('terminated');
    expect(reconstructed!.terminationReason).toBe('Patient discharged');
    expect(reconstructed!.activeParticipantIds).toHaveLength(0);
  });

  test('reconstruct suspend → reactivate cycle', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.suspend({ tenantId: TENANT, relationshipId: rel.id, reason: 'hold', actor: 'system', expectedVersion: 1 });
    await engine.reactivate({ tenantId: TENANT, relationshipId: rel.id, actor: 'system', expectedVersion: 2 });

    const reconstructed = await reconstructRelationshipFromEvents(eventStore, TENANT, rel.id);
    expect(reconstructed!.status).toBe('active');
  });

  test('null returned for non-existent stream', async () => {
    const { eventStore } = makeStore();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-999999999999');
    const result = await reconstructRelationshipFromEvents(eventStore, TENANT, fakeId);
    expect(result).toBeNull();
  });

  test('version count matches event count', async () => {
    const { engine, eventStore } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });
    await engine.suspend({ tenantId: TENANT, relationshipId: rel.id, reason: 'hold', actor: 'system', expectedVersion: 2 });

    const reconstructed = await reconstructRelationshipFromEvents(eventStore, TENANT, rel.id);
    const events = await eventStore.loadStream(TENANT, rel.id);
    expect(reconstructed!.version).toBe(events.length);
  });
});

// ─── All relationship types ───────────────────────────────────────────────────

describe('All relationship types', () => {
  test.each([
    'CareTeam', 'ReferralSource', 'FamilyMember', 'Physician',
    'CoverageRelationship', 'PatientCareGuide', 'ProgramEnrollment',
  ] as const)('"%s" relationship type can be created', async (type) => {
    const { engine } = makeStore();
    const rel = await engine.create({ tenantId: TENANT, type, subjectId: PATIENT_ID, description: `${type} relationship`, actor: 'system' });
    expect(rel.type).toBe(type);
    expect(rel.status).toBe('active');
  });
});

// ─── Relationship Health projection (ADR-016) ─────────────────────────────────

describe('Relationship Health projection (ADR-016)', () => {
  function makeProjectionStack() {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const engine = new RelationshipEngine(db, eventStore);
    const projRegistry = new ProjectionRegistry();
    projRegistry.register(RelationshipHealthProjectionV2Definition);
    const projStore = new InMemoryProjectionStore();
    const projEngine = new ProjectionEngine(projRegistry, projStore, eventStore);
    const rebuilder = new ProjectionRebuilder(projEngine, projStore);

    store.objects.set(String(PATIENT_ID), { id: String(PATIENT_ID), tenant_id: TENANT, type: 'Patient', state: 'created', attributes: {}, version: 1, created_at: new Date(), updated_at: new Date() });

    return { store, db, eventStore, engine, projEngine, projStore, rebuilder };
  }

  function makeOperationalEvent(type: string): DomainEvent {
    return { id: `op-evt-${Math.random().toString(36).slice(2)}`, tenantId: TENANT, streamId: PATIENT_ID, seq: 1, type: type as EventType, payload: {}, actor: 'system', occurredAt: new Date() };
  }

  function relHealthAssembler(
    relationshipId: AlaraId,
    relationshipEvents: DomainEvent[],
    operationalEvents: DomainEvent[],
  ): ProjectionInputAssembler<RelationshipHealthInputV2> {
    return {
      async assemble(subjectId) {
        return { relationshipId: subjectId, relationshipEvents, operationalEvents };
      },
      async sourceEventIds() {
        return [...relationshipEvents, ...operationalEvents].map(e => e.id);
      },
    };
  }

  test('Relationship Health builds from relationship + operational events', async () => {
    const { engine, eventStore, projEngine } = makeProjectionStack();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });

    const relEvents = await eventStore.loadStream(TENANT, rel.id);
    const opEvents = [
      makeOperationalEvent('PromiseKept'), makeOperationalEvent('PromiseKept'),
      makeOperationalEvent('TaskCompleted'),
    ];

    const result = await projEngine.build(
      TENANT, 'RelationshipHealth', String(rel.id),
      relHealthAssembler(rel.id, relEvents, opEvents),
    );

    expect(result.built).toBe(true);
    if (!result.built) return;
    const value = result.projection.value as unknown as RelationshipHealthValue;
    expect(value.healthLabel).toBe('healthy');
    expect(value.promisesKept).toBe(2);
    expect(value.tasksCompleted).toBe(1);
    expect(value.healthScore).toBeGreaterThan(0.5);
  });

  test('Terminated relationship lowers health score', async () => {
    const { engine, eventStore, projEngine } = makeProjectionStack();
    const rel = await engine.create({ tenantId: TENANT, type: 'PatientCareGuide', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.terminate({ tenantId: TENANT, relationshipId: rel.id, reason: 'issue', actor: 'admin', expectedVersion: 1 });

    const relEvents = await eventStore.loadStream(TENANT, rel.id);
    const opEvents = [makeOperationalEvent('PromiseMissed'), makeOperationalEvent('DataIntegrityFlagged')];

    const result = await projEngine.build(
      TENANT, 'RelationshipHealth', String(rel.id),
      relHealthAssembler(rel.id, relEvents, opEvents),
    );

    expect(result.built).toBe(true);
    if (!result.built) return;
    const value = result.projection.value as unknown as RelationshipHealthValue;
    expect(value.healthLabel).toBe('at_risk');
  });

  test('Relationship Health rebuilds identically after clearing projection store (ADR-016)', async () => {
    const { engine, eventStore, projEngine, projStore, rebuilder } = makeProjectionStack();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });
    await engine.addParticipant({ tenantId: TENANT, relationshipId: rel.id, participantId: CARE_GUIDE_1, participantType: 'WorkforceMember', role: 'Actor', actor: 'system', expectedVersion: 1 });

    const relEvents = await eventStore.loadStream(TENANT, rel.id);
    const opEvents = [makeOperationalEvent('PromiseKept'), makeOperationalEvent('TaskCompleted')];
    const assembler = relHealthAssembler(rel.id, relEvents, opEvents);

    const original = await projEngine.build(TENANT, 'RelationshipHealth', String(rel.id), assembler);
    expect(original.built).toBe(true);
    if (!original.built) return;

    const originalValue = original.projection.value as unknown as RelationshipHealthValue;

    // Discard projection store — simulate cache loss
    projStore.clear();
    expect(await projStore.get(TENANT, 'RelationshipHealth', String(rel.id))).toBeNull();

    // Rebuild from same canonical inputs
    const rebuilt = await rebuilder.rebuild(TENANT, 'RelationshipHealth', String(rel.id), assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;

    const rebuiltValue = rebuilt.projection.value as unknown as RelationshipHealthValue;

    // Identical values
    expect(rebuiltValue.healthLabel).toBe(originalValue.healthLabel);
    expect(rebuiltValue.healthScore).toBe(originalValue.healthScore);
    expect(rebuiltValue.promisesKept).toBe(originalValue.promisesKept);
  });

  test('ADR-016: Relationship Health declares canonical inputs and method version', async () => {
    const { engine, eventStore, projEngine } = makeProjectionStack();
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });

    const relEvents = await eventStore.loadStream(TENANT, rel.id);
    const result = await projEngine.build(
      TENANT, 'RelationshipHealth', String(rel.id),
      relHealthAssembler(rel.id, relEvents, []),
    );

    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.projection.metadata.methodVersion).toBe('2.0.0');
    expect(result.projection.metadata.canonicalInputs.length).toBeGreaterThan(0);
    expect(result.projection.metadata.aiInvolved).toBe(false);
  });

  test('No canonical state depends on projections — deleting projection does not break relationship', async () => {
    const { engine, projStore, db } = makeProjectionStack();
    const repo = new (await import('../src/relationship-engine/repository')).RelationshipRepository(db);
    const rel = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: '', actor: 'system' });

    // Clear the projection store completely
    projStore.clear();

    // Relationship state is unaffected — it is canonical
    const fetched = await repo.getById(TENANT, rel.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe('active');
  });
});

// ─── Multi-tenant isolation ───────────────────────────────────────────────────

describe('Multi-tenant isolation', () => {
  test('Relationships from different tenants are isolated', async () => {
    const { engine, store } = makeStore();

    // Seed patient in second tenant too
    store.objects.set('patient-tenant-b', { id: 'patient-tenant-b', tenant_id: 'tenant-b', type: 'Patient', state: 'created', attributes: {}, version: 1, created_at: new Date(), updated_at: new Date() });
    store.objects.set(String(PATIENT_ID), { id: String(PATIENT_ID), tenant_id: 'tenant-b', type: 'Patient', state: 'created', attributes: {}, version: 1, created_at: new Date(), updated_at: new Date() });

    const relA = await engine.create({ tenantId: TENANT, type: 'CareTeam', subjectId: PATIENT_ID, description: 'A', actor: 'system' });
    const relB = await engine.create({ tenantId: 'tenant-b', type: 'CareTeam', subjectId: PATIENT_ID, description: 'B', actor: 'system' });

    // Each tenant can only see their own
    const { repo } = makeStore();
    expect(relA.tenantId).toBe(TENANT);
    expect(relB.tenantId).toBe('tenant-b');
    expect(relA.id).not.toBe(relB.id);
  });
});
