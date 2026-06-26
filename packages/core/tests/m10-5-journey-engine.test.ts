/**
 * Alara OS — M10.5 Journey Engine Tests
 *
 * Coverage:
 *   - Lifecycle state machine (all transitions, invalid transitions)
 *   - Event ordering & append-only stream
 *   - Projection updates (projection_type = 'journey_state')
 *   - Reference behavior (exhaustive kinds, idempotency)
 *   - Anonymous Journey path (OD-1: identity never fabricated)
 *   - Identity resolution (links existing Person, never creates)
 *   - Workforce handoff (ADR-014: references WM, never absorbs)
 *   - Episode linkage (BD-013: Journey upstream, never becomes Episode)
 *   - Merge (provenance preserved, secondary archived, idempotent refs)
 *   - Split (child created, causal events linked)
 *   - Capability tokens (scoped, revocable)
 *   - Journey Invariant structural enforcement
 *   - Architectural doctrine verification
 */

import { JourneyEngine } from '../src/journey-engine/engine';
import {
  canTransition,
  InvalidLifecycleTransitionError,
  JOURNEY_REFERENCE_KINDS,
  JourneyLifecycle,
  JourneyNotFoundError,
  LIFECYCLE_TRANSITIONS,
} from '../src/journey-engine/types';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'test-tenant';

function makeEngine() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  return { store, engine: new JourneyEngine(db) };
}

// ─── 1. Lifecycle state machine ───────────────────────────────────────────────

describe('Lifecycle state machine', () => {
  test('arrival → orientation is valid', () => {
    expect(canTransition('arrival', 'orientation')).toBe(true);
  });

  test('arrival → dormant is valid', () => {
    expect(canTransition('arrival', 'dormant')).toBe(true);
  });

  test('arrival → completed is invalid', () => {
    expect(canTransition('arrival', 'completed')).toBe(false);
  });

  test('arrival → archived is invalid', () => {
    expect(canTransition('arrival', 'archived')).toBe(false);
  });

  test('archived is terminal (no valid targets)', () => {
    const targets = LIFECYCLE_TRANSITIONS.get('archived');
    expect(targets?.size).toBe(0);
  });

  test('completed → dormant is valid', () => {
    expect(canTransition('completed', 'dormant')).toBe(true);
  });

  test('completed → working is invalid', () => {
    expect(canTransition('completed', 'working')).toBe(false);
  });

  test('dormant → reactivated is valid', () => {
    expect(canTransition('dormant', 'reactivated')).toBe(true);
  });

  test('dormant → archived is valid', () => {
    expect(canTransition('dormant', 'archived')).toBe(true);
  });

  test('all lifecycle states are covered in the transition map', () => {
    const states: JourneyLifecycle[] = [
      'arrival', 'orientation', 'working', 'identity_resolution',
      'care_coordination', 'completed', 'dormant', 'reactivated', 'archived',
    ];
    for (const s of states) {
      expect(LIFECYCLE_TRANSITIONS.has(s)).toBe(true);
    }
  });

  test('anonymous-forever path: arrival → dormant → archived', () => {
    const path: JourneyLifecycle[] = ['arrival', 'orientation', 'working', 'dormant', 'archived'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });
});

// ─── 2. Journey creation ──────────────────────────────────────────────────────

describe('Journey creation', () => {
  test('start creates a Journey at arrival', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    expect(journey.lifecycle).toBe('arrival');
    expect(journey.identityResolved).toBe(false);
    expect(journey.intent).toBeNull();
    expect(journey.mergedFrom).toHaveLength(0);
    expect(journey.splitFrom).toBeNull();
  });

  test('start returns a capability token', async () => {
    const { engine } = makeEngine();
    const { token } = await engine.start(TENANT);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  test('token resolves to the correct journey', async () => {
    const { engine } = makeEngine();
    const { journey, token } = await engine.start(TENANT);
    const resolved = await engine.validateToken(token, TENANT);
    expect(resolved).toBe(journey.id);
  });

  test('invalid token returns null', async () => {
    const { engine } = makeEngine();
    expect(await engine.validateToken('bogus', TENANT)).toBeNull();
  });

  test('each token is scoped to its own journey', async () => {
    const { engine } = makeEngine();
    const { journey: j1, token: t1 } = await engine.start(TENANT);
    const { journey: j2, token: t2 } = await engine.start(TENANT);
    expect(await engine.validateToken(t1, TENANT)).toBe(j1.id);
    expect(await engine.validateToken(t2, TENANT)).toBe(j2.id);
    expect(t1).not.toBe(t2);
  });

  test('revoked token returns null', async () => {
    const { engine } = makeEngine();
    const { token } = await engine.start(TENANT);
    await engine.revokeToken(token, TENANT);
    expect(await engine.validateToken(token, TENANT)).toBeNull();
  });

  test('start emits JourneyStarted event', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const events = await engine.getEvents(journey.id, TENANT);
    expect(events.some(e => e.eventType === 'JourneyStarted')).toBe(true);
  });

  test('projection created at arrival with journey_state type', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const proj = await engine.getProjection(journey.id, TENANT);
    expect(proj).not.toBeNull();
    expect(proj!.PROJECTION_TYPE).toBe('journey_state');
    expect(proj!.lifecycle).toBe('arrival');
  });
});

// ─── 3. Lifecycle transitions ─────────────────────────────────────────────────

describe('Lifecycle transitions', () => {
  test('orient advances to orientation', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    const proj = await engine.getProjection(journey.id, TENANT);
    expect(proj!.lifecycle).toBe('orientation');
  });

  test('orient emits JourneyOriented event', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    const events = await engine.getEvents(journey.id, TENANT);
    expect(events.some(e => e.eventType === 'JourneyOriented')).toBe(true);
  });

  test('beginWork advances to working', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    const proj = await engine.getProjection(journey.id, TENANT);
    expect(proj!.lifecycle).toBe('working');
  });

  test('goDormant from working', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.goDormant(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('dormant');
  });

  test('reactivate from dormant', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.goDormant(journey.id, TENANT);
    await engine.reactivate(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('reactivated');
  });

  test('complete from working', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.complete(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('completed');
  });

  test('archive from dormant', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.goDormant(journey.id, TENANT);
    await engine.archive(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('archived');
  });

  test('invalid transition throws InvalidLifecycleTransitionError', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await expect(engine.complete(journey.id, TENANT)).rejects.toThrow(InvalidLifecycleTransitionError);
  });

  test('suspend does not change lifecycle', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.suspend(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('working');
  });

  test('suspend emits JourneySuspended', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.suspend(journey.id, TENANT);
    const events = await engine.getEvents(journey.id, TENANT);
    expect(events.some(e => e.eventType === 'JourneySuspended')).toBe(true);
  });

  test('resume emits JourneyResumed', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.suspend(journey.id, TENANT);
    await engine.resume(journey.id, TENANT);
    const events = await engine.getEvents(journey.id, TENANT);
    expect(events.some(e => e.eventType === 'JourneyResumed')).toBe(true);
  });

  test('JourneyNotFoundError on unknown journey', async () => {
    const { engine } = makeEngine();
    await expect(engine.orient(makeAlaraId('no-such'), TENANT)).rejects.toThrow(JourneyNotFoundError);
  });
});

// ─── 4. Event ordering & append-only stream ───────────────────────────────────

describe('Event stream', () => {
  test('events are ordered by occurred_at', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    const events = await engine.getEvents(journey.id, TENANT);
    const times = events.map(e => e.occurredAt.getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  test('event stream is append-only (no deletions)', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const before = new Set((await engine.getEvents(journey.id, TENANT)).map(e => e.id));
    await engine.orient(journey.id, TENANT);
    const after = new Set((await engine.getEvents(journey.id, TENANT)).map(e => e.id));
    for (const id of before) expect(after.has(id)).toBe(true);
  });

  test('event count grows monotonically', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const c1 = (await engine.getEvents(journey.id, TENANT)).length;
    await engine.orient(journey.id, TENANT);
    const c2 = (await engine.getEvents(journey.id, TENANT)).length;
    await engine.beginWork(journey.id, TENANT);
    const c3 = (await engine.getEvents(journey.id, TENANT)).length;
    expect(c2).toBeGreaterThan(c1);
    expect(c3).toBeGreaterThan(c2);
  });

  test('merge event has causedBy linking to archived event', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    await engine.merge(j1.id, j2.id, TENANT);
    const primaryEvents = await engine.getEvents(j1.id, TENANT);
    const mergedEvt = primaryEvents.find(e => e.eventType === 'JourneyMerged')!;
    expect(mergedEvt.causedBy).not.toBeNull();
  });
});

// ─── 5. Projection ────────────────────────────────────────────────────────────

describe('Projection', () => {
  test('projection reflects latest lifecycle', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('orientation');
    await engine.beginWork(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('working');
  });

  test('projection is null for unknown journey', async () => {
    const { engine } = makeEngine();
    expect(await engine.getProjection(makeAlaraId('none'), TENANT)).toBeNull();
  });

  test('projection reflects inferred intent', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.inferIntent(journey.id, TENANT, 'get mom home safely');
    expect((await engine.getProjection(journey.id, TENANT))!.intent).toBe('get mom home safely');
  });

  test('projection reflects obstacle', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.surfaceObstacle(journey.id, TENANT, 'Medicare coverage uncertainty');
    expect((await engine.getProjection(journey.id, TENANT))!.obstacle).toBe('Medicare coverage uncertainty');
  });

  test('projection reflects actor', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.setActor(journey.id, TENANT, 'adult_child');
    expect((await engine.getProjection(journey.id, TENANT))!.actor).toBe('adult_child');
  });

  test('projection reflects nextStep', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.setNextStep(journey.id, TENANT, { label: 'Call within 24h', owner: 'Maria', honestWindow: '24 hours' });
    const proj = await engine.getProjection(journey.id, TENANT);
    expect(proj!.nextStep?.owner).toBe('Maria');
    expect(proj!.nextStep?.honestWindow).toBe('24 hours');
  });

  test('projection has last_event_id after events', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    const proj = await engine.getProjection(journey.id, TENANT);
    expect(proj!.lastEventId).not.toBeNull();
  });
});

// ─── 6. Anonymous Journey path (OD-1) ────────────────────────────────────────

describe('Anonymous Journey (OD-1)', () => {
  test('journey starts without a Person reference', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const refs = await engine.getReferences(journey.id, TENANT, 'person');
    expect(refs).toHaveLength(0);
  });

  test('identityResolved starts false', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    expect(journey.identityResolved).toBe(false);
  });

  test('anonymous journey can complete without resolving identity', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.complete(journey.id, TENANT, 'informational_goal_satisfied');
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('completed');
  });

  test('anonymous journey can archive without resolving identity', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.goDormant(journey.id, TENANT);
    await engine.archive(journey.id, TENANT);
    expect((await engine.getProjection(journey.id, TENANT))!.lifecycle).toBe('archived');
  });
});

// ─── 7. Identity resolution ───────────────────────────────────────────────────

describe('Identity resolution', () => {
  test('links an existing Person as a reference (never creates)', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    const personId = makeAlaraId('person-001');
    await engine.resolveIdentity(journey.id, TENANT, personId);
    const refs = await engine.getReferences(journey.id, TENANT, 'person');
    expect(refs.some(r => r.refId === personId)).toBe(true);
  });

  test('emits JourneyIdentityResolved and PersonLinkedToJourney', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.orient(journey.id, TENANT);
    await engine.beginWork(journey.id, TENANT);
    await engine.resolveIdentity(journey.id, TENANT, makeAlaraId('p1'));
    const events = await engine.getEvents(journey.id, TENANT);
    const types = events.map(e => e.eventType);
    expect(types).toContain('JourneyIdentityResolved');
    expect(types).toContain('PersonLinkedToJourney');
  });

  test('engine has no createPerson method (OD-1)', () => {
    const { engine } = makeEngine();
    expect(typeof (engine as unknown as Record<string, unknown>)['createPerson']).toBe('undefined');
  });

  test('0..N persons can be linked (caregiver + patient)', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const patientId = makeAlaraId('patient-1');
    const caregiverId = makeAlaraId('caregiver-1');
    await engine.resolveIdentity(journey.id, TENANT, patientId, 'patient');
    await engine.resolveIdentity(journey.id, TENANT, caregiverId, 'caregiver');
    const refs = await engine.getReferences(journey.id, TENANT, 'person');
    const refIds = refs.map(r => r.refId);
    expect(refIds).toContain(patientId);
    expect(refIds).toContain(caregiverId);
  });
});

// ─── 8. Workforce handoff ─────────────────────────────────────────────────────

describe('Workforce handoff', () => {
  test('creates a workforce_member reference edge', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const wmId = makeAlaraId('wm-001');
    await engine.initiateHandoff(journey.id, TENANT, wmId, {
      name: 'Maria Reyes', role: 'Care coordinator', contextTransferred: true,
    });
    const refs = await engine.getReferences(journey.id, TENANT, 'workforce_member');
    expect(refs.some(r => r.refId === wmId)).toBe(true);
  });

  test('emits JourneyHandoffInitiated and WorkforceMemberLinkedToJourney', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.initiateHandoff(journey.id, TENANT, makeAlaraId('wm-1'), {
      name: 'A', role: 'B', contextTransferred: false,
    });
    const types = (await engine.getEvents(journey.id, TENANT)).map(e => e.eventType);
    expect(types).toContain('JourneyHandoffInitiated');
    expect(types).toContain('WorkforceMemberLinkedToJourney');
  });

  test('handoff is reflected in projection', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.initiateHandoff(journey.id, TENANT, makeAlaraId('wm-2'), {
      name: 'Maria Reyes', role: 'Care coordinator', contextTransferred: true,
    });
    const proj = await engine.getProjection(journey.id, TENANT);
    expect(proj!.humanHandoff?.name).toBe('Maria Reyes');
    expect(proj!.humanHandoff?.contextTransferred).toBe(true);
  });

  test('engine has no createWorkforceMember method (ADR-014)', () => {
    const { engine } = makeEngine();
    expect(typeof (engine as unknown as Record<string, unknown>)['createWorkforceMember']).toBe('undefined');
  });
});

// ─── 9. Episode linkage ───────────────────────────────────────────────────────

describe('Episode linkage', () => {
  test('creates an episode reference edge', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const epId = makeAlaraId('episode-001');
    await engine.linkEpisode(journey.id, TENANT, epId);
    const refs = await engine.getReferences(journey.id, TENANT, 'episode');
    expect(refs.some(r => r.refId === epId)).toBe(true);
  });

  test('emits EpisodeLinkedToJourney', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    await engine.linkEpisode(journey.id, TENANT, makeAlaraId('ep-1'));
    const types = (await engine.getEvents(journey.id, TENANT)).map(e => e.eventType);
    expect(types).toContain('EpisodeLinkedToJourney');
  });

  test('engine has no createEpisode method (BD-013)', () => {
    const { engine } = makeEngine();
    expect(typeof (engine as unknown as Record<string, unknown>)['createEpisode']).toBe('undefined');
  });

  test('0..N episodes can be linked', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const ep1 = makeAlaraId('ep-a');
    const ep2 = makeAlaraId('ep-b');
    await engine.linkEpisode(journey.id, TENANT, ep1);
    await engine.linkEpisode(journey.id, TENANT, ep2);
    const refs = await engine.getReferences(journey.id, TENANT, 'episode');
    expect(refs.map(r => r.refId)).toContain(ep1);
    expect(refs.map(r => r.refId)).toContain(ep2);
  });
});

// ─── 10. Merge ────────────────────────────────────────────────────────────────

describe('Merge', () => {
  test('transfers references from secondary to primary', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    const personId = makeAlaraId('p-merge');
    await engine.resolveIdentity(j2.id, TENANT, personId);
    await engine.merge(j1.id, j2.id, TENANT);
    const refs = await engine.getReferences(j1.id, TENANT, 'person');
    expect(refs.some(r => r.refId === personId)).toBe(true);
  });

  test('secondary is archived after merge', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    await engine.merge(j1.id, j2.id, TENANT);
    expect((await engine.getProjection(j2.id, TENANT))!.lifecycle).toBe('archived');
  });

  test('primary emits JourneyMerged event', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    await engine.merge(j1.id, j2.id, TENANT);
    const types = (await engine.getEvents(j1.id, TENANT)).map(e => e.eventType);
    expect(types).toContain('JourneyMerged');
  });

  test('secondary event history preserved after merge', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    await engine.orient(j2.id, TENANT);
    const countBefore = (await engine.getEvents(j2.id, TENANT)).length;
    await engine.merge(j1.id, j2.id, TENANT);
    const countAfter = (await engine.getEvents(j2.id, TENANT)).length;
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
  });

  test('idempotent reference transfer (no duplicates)', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    const pid = makeAlaraId('shared-person');
    await engine.resolveIdentity(j1.id, TENANT, pid);
    await engine.resolveIdentity(j2.id, TENANT, pid);
    await engine.merge(j1.id, j2.id, TENANT);
    const refs = await engine.getReferences(j1.id, TENANT, 'person');
    expect(refs.filter(r => r.refId === pid).length).toBe(1);
  });
});

// ─── 11. Split ────────────────────────────────────────────────────────────────

describe('Split', () => {
  test('creates a child journey with correct intent and splitFrom', async () => {
    const { engine } = makeEngine();
    const { journey: parent } = await engine.start(TENANT);
    await engine.orient(parent.id, TENANT);
    await engine.beginWork(parent.id, TENANT);
    const child = await engine.split(parent.id, TENANT, 'separate patient B', []);
    expect(child.intent).toBe('separate patient B');
    expect(child.splitFrom).toBe(parent.id);
  });

  test('parent emits JourneySplit event', async () => {
    const { engine } = makeEngine();
    const { journey: parent } = await engine.start(TENANT);
    await engine.orient(parent.id, TENANT);
    await engine.beginWork(parent.id, TENANT);
    await engine.split(parent.id, TENANT, 'child', []);
    const types = (await engine.getEvents(parent.id, TENANT)).map(e => e.eventType);
    expect(types).toContain('JourneySplit');
  });

  test('child has a JourneyStarted event', async () => {
    const { engine } = makeEngine();
    const { journey: parent } = await engine.start(TENANT);
    await engine.orient(parent.id, TENANT);
    await engine.beginWork(parent.id, TENANT);
    const child = await engine.split(parent.id, TENANT, 'child', []);
    const types = (await engine.getEvents(child.id, TENANT)).map(e => e.eventType);
    expect(types).toContain('JourneyStarted');
  });

  test('split transfers specified refs to child', async () => {
    const { engine } = makeEngine();
    const { journey: parent } = await engine.start(TENANT);
    await engine.orient(parent.id, TENANT);
    await engine.beginWork(parent.id, TENANT);
    const pid = makeAlaraId('p-split');
    const child = await engine.split(parent.id, TENANT, 'child', [
      { kind: 'person', refId: pid, role: 'patient' },
    ]);
    const refs = await engine.getReferences(child.id, TENANT, 'person');
    expect(refs.some(r => r.refId === pid)).toBe(true);
  });

  test('split child lifecycle starts at working', async () => {
    const { engine } = makeEngine();
    const { journey: parent } = await engine.start(TENANT);
    await engine.orient(parent.id, TENANT);
    await engine.beginWork(parent.id, TENANT);
    const child = await engine.split(parent.id, TENANT, 'child', []);
    expect(child.lifecycle).toBe('working');
  });
});

// ─── 12. Reference idempotency ────────────────────────────────────────────────

describe('Reference idempotency', () => {
  test('adding the same reference twice yields exactly one edge', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const pid = makeAlaraId('person-dup');
    await engine.resolveIdentity(journey.id, TENANT, pid);
    await engine.resolveIdentity(journey.id, TENANT, pid);
    const refs = await engine.getReferences(journey.id, TENANT, 'person');
    expect(refs.filter(r => r.refId === pid).length).toBe(1);
  });

  test('findJourneysFor returns all journeys referencing an object', async () => {
    const { engine } = makeEngine();
    const { journey: j1 } = await engine.start(TENANT);
    const { journey: j2 } = await engine.start(TENANT);
    const pid = makeAlaraId('shared');
    await engine.resolveIdentity(j1.id, TENANT, pid);
    await engine.resolveIdentity(j2.id, TENANT, pid);
    const found = await engine.findJourneysFor('person', pid, TENANT);
    expect(found).toContain(j1.id);
    expect(found).toContain(j2.id);
  });
});

// ─── 13. Journey Invariant structural enforcement ─────────────────────────────

describe('Journey Invariant', () => {
  test('reference kinds are the exhaustive ADR-015 list', () => {
    const expected = new Set([
      'person', 'episode', 'relationship', 'workforce_member',
      'stakeholder',  // M11: Stakeholder is a first-class Object (Architect ratified)
      'promise', 'task', 'communication', 'knowledge_entry', 'observation', 'reasoning',
    ]);
    const actual = new Set(JOURNEY_REFERENCE_KINDS);
    expect(actual).toEqual(expected);
  });

  test('all cross-object links go through reference edges', async () => {
    const { engine } = makeEngine();
    const { journey } = await engine.start(TENANT);
    const pid = makeAlaraId('p1');
    const wmId = makeAlaraId('wm1');
    const epId = makeAlaraId('ep1');
    const keId = makeAlaraId('ke1');
    await engine.resolveIdentity(journey.id, TENANT, pid);
    await engine.initiateHandoff(journey.id, TENANT, wmId, { name: 'A', role: 'B', contextTransferred: true });
    await engine.linkEpisode(journey.id, TENANT, epId);
    await engine.recordQuestionAnswered(journey.id, TENANT, keId);
    const allRefs = await engine.getReferences(journey.id, TENANT);
    const refIds = allRefs.map(r => r.refId);
    expect(refIds).toContain(pid);
    expect(refIds).toContain(wmId);
    expect(refIds).toContain(epId);
    expect(refIds).toContain(keId);
  });

  test('engine has no createPerson, createEpisode, createWorkforceMember methods', () => {
    const { engine } = makeEngine();
    const e = engine as unknown as Record<string, unknown>;
    expect(e['createPerson']).toBeUndefined();
    expect(e['createEpisode']).toBeUndefined();
    expect(e['createWorkforceMember']).toBeUndefined();
  });

  test('engine has no createReferral or createAdmission (those are Events, not Journey)', () => {
    const { engine } = makeEngine();
    const e = engine as unknown as Record<string, unknown>;
    expect(e['createReferral']).toBeUndefined();
    expect(e['createAdmission']).toBeUndefined();
  });
});
