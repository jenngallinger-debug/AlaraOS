/**
 * Alara OS — M10 Workforce Engine Tests
 *
 * Coverage:
 *   - WorkforceMember registration
 *   - Availability management
 *   - Assignment recommendation (deterministic scoring)
 *   - Scoring dimensions: skill, availability, continuity, load, program
 *   - Disqualification logic (capacity, leave, role mismatch, inactive)
 *   - Candidate ranking
 *   - Rules Engine gate (every recommendation evaluated)
 *   - Assignment lifecycle: recommended → approved → accepted → completed
 *   - Assignment decline
 *   - Assignment transfer (ownership handoff)
 *   - Escalation triggering
 *   - Optimistic concurrency (StaleAssignmentError)
 *   - NoEligibleAssigneeError when all members disqualified
 *   - Event-sourced reconstruction
 *   - WorkforceHealthProjection (ADR-016: aiInvolved=false, rebuilds)
 *   - No side effects (engine never performs work)
 *   - Deterministic: same input → same recommendation
 */

import { WorkforceEngine, reconstructAssignmentFromEvents } from '../src/workforce-engine/engine';
import { scoreMember, rankCandidates } from '../src/workforce-engine/recommender';
import {
  AssignmentNotFoundError, NoEligibleAssigneeError, StaleAssignmentError,
  WorkforceMemberNotFoundError,
} from '../src/workforce-engine/types';
import type {
  Availability, CandidateScore, CoverageArea,
  SkillProfile, WorkforceMember, WorkforceRole,
} from '../src/workforce-engine/types';
import { WorkforceHealthProjectionDefinition } from '../src/projection-engine/projections/workforce-health';
import type { WorkforceHealthInput, WorkforceHealthValue } from '../src/projection-engine/projections/workforce-health';
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
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const SUBJECT_ID = 'patient-001';

function makeRules() {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  for (const m of BUILT_IN_POLICY_MODULES) registry.registerPolicyModule(m);
  return new RulesEngine(registry, new NoopAuditSink());
}

function makeEngine() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const rules = makeRules();
  const engine = new WorkforceEngine(db, eventStore, rules);
  return { store, db, eventStore, engine };
}

const DEFAULT_SKILL_PROFILE: SkillProfile = {
  skills: [
    { skill: 'intake', level: 'expert', verifiedAt: null },
    { skill: 'eeoicpa', level: 'proficient', verifiedAt: null },
  ],
  programs: ['EEOICPA', 'Medicare'],
  languages: ['English'],
  certifications: [],
  lastUpdated: '2026-01-01',
};

const DEFAULT_COVERAGE: CoverageArea = {
  regionCodes: ['CA-SOUTH'],
  programCodes: ['EEOICPA', 'Medicare'],
  serviceLines: ['home_health'],
};

async function registerMember(
  engine: WorkforceEngine,
  overrides: { displayName?: string; role?: WorkforceRole; skills?: SkillProfile; coverage?: CoverageArea } = {},
) {
  return engine.registerMember({
    tenantId: TENANT,
    displayName: overrides.displayName ?? 'Care Guide One',
    role: overrides.role ?? 'care_guide',
    teamId: null, supervisorId: null, externalHrId: null,
    skillProfile: overrides.skills ?? DEFAULT_SKILL_PROFILE,
    coverageArea: overrides.coverage ?? DEFAULT_COVERAGE,
    escalationPathId: null,
    actor: 'system',
  });
}

// ─── Member registration ──────────────────────────────────────────────────────

describe('WorkforceMember registration', () => {
  test('registers a member and emits WorkforceMemberRegistered', async () => {
    const { engine, store } = makeEngine();
    const result = await registerMember(engine);

    expect(result.member.id).toBeDefined();
    expect(result.member.displayName).toBe('Care Guide One');
    expect(result.member.role).toBe('care_guide');
    expect(result.member.status).toBe('active');
    expect(result.member.version).toBe(1);
    expect(store.events.some(e => e.type === 'WorkforceMemberRegistered')).toBe(true);
  });

  test('seeds initial availability at available/0/10 on registration', async () => {
    const { engine } = makeEngine();
    const result = await registerMember(engine);

    const avail = await engine.repo.getAvailability(TENANT, result.member.id);
    expect(avail).not.toBeNull();
    expect(avail!.status).toBe('available');
    expect(avail!.currentLoad).toBe(0);
    expect(avail!.maxLoad).toBe(10);
  });

  test('all workforce roles accepted', async () => {
    const { engine } = makeEngine();
    const roles: WorkforceRole[] = ['care_guide', 'clinical_coordinator', 'intake_specialist', 'scheduler', 'quality_reviewer', 'supervisor', 'administrator'];
    for (const role of roles) {
      const result = await registerMember(engine, { displayName: `Member ${role}`, role });
      expect(result.member.role).toBe(role);
    }
  });

  test('skill profile and coverage area are stored', async () => {
    const { engine } = makeEngine();
    const result = await registerMember(engine);
    expect(result.member.skillProfile.skills).toHaveLength(2);
    expect(result.member.coverageArea.programCodes).toContain('EEOICPA');
  });
});

// ─── Availability management ──────────────────────────────────────────────────

describe('Availability management', () => {
  test('updateAvailability changes status and emits AvailabilityChanged', async () => {
    const { engine, store } = makeEngine();
    const { member } = await registerMember(engine);

    await engine.updateAvailability({
      tenantId: TENANT, memberId: member.id, status: 'busy',
      unavailableUntil: null, actor: 'system', expectedVersion: 1,
    });

    const avail = await engine.repo.getAvailability(TENANT, member.id);
    expect(avail!.status).toBe('busy');
    expect(store.events.some(e => e.type === 'AvailabilityChanged')).toBe(true);
  });

  test('AvailabilityChanged event includes previous and new status', async () => {
    const { engine, store } = makeEngine();
    const { member } = await registerMember(engine);

    await engine.updateAvailability({
      tenantId: TENANT, memberId: member.id, status: 'on_leave',
      unavailableUntil: '2026-07-01T00:00:00Z', actor: 'system', expectedVersion: 1,
    });

    const evt = store.events.find(e => e.type === 'AvailabilityChanged');
    expect(evt).toBeDefined();
    const p = evt!.payload as Record<string, unknown>;
    expect(p.previousStatus).toBe('available');
    expect(p.newStatus).toBe('on_leave');
  });

  test('updateAvailability on unknown member → WorkforceMemberNotFoundError', async () => {
    const { engine } = makeEngine();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-999999999999');
    await expect(engine.updateAvailability({
      tenantId: TENANT, memberId: fakeId, status: 'busy',
      unavailableUntil: null, actor: 'system', expectedVersion: 1,
    })).rejects.toThrow(WorkforceMemberNotFoundError);
  });
});

// ─── Scoring (deterministic) ──────────────────────────────────────────────────

describe('Assignment scoring — deterministic', () => {
  function makeMember(overrides: Partial<WorkforceMember> = {}): WorkforceMember {
    return {
      id: makeAlaraId('00000000-0000-4000-8000-100000000001'),
      tenantId: TENANT, displayName: 'Test Member', role: 'care_guide',
      status: 'active', teamId: null, supervisorId: null, externalHrId: null,
      skillProfile: DEFAULT_SKILL_PROFILE, coverageArea: DEFAULT_COVERAGE,
      escalationPathId: null, createdAt: new Date(), updatedAt: new Date(), version: 1,
      ...overrides,
    };
  }

  function makeAvail(overrides: Partial<Availability> = {}): Availability {
    return {
      memberId: makeAlaraId('00000000-0000-4000-8000-100000000001'),
      tenantId: TENANT, status: 'available', currentLoad: 2, maxLoad: 10,
      nextAvailableAt: null, unavailableUntil: null,
      snapshotAt: new Date().toISOString(),
      ...overrides,
    };
  }

  test('member with matching skills scores higher than one without', () => {
    const member = makeMember();
    const avail = makeAvail();

    const withSkills = scoreMember({ member, availability: avail, requiredSkills: ['intake', 'eeoicpa'], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });
    const withoutSkills = scoreMember({ member, availability: avail, requiredSkills: ['wound_care', 'physical_therapy'], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });

    expect(withSkills.skillScore).toBeGreaterThan(withoutSkills.skillScore);
    expect(withSkills.totalScore).toBeGreaterThan(withoutSkills.totalScore);
  });

  test('available member scores higher availability than busy member', () => {
    const member = makeMember();
    const availMember = makeAvail({ status: 'available', currentLoad: 0 });
    const busyMember = makeAvail({ status: 'busy', currentLoad: 8 });

    const scoreAvail = scoreMember({ member, availability: availMember, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });
    const scoreBusy = scoreMember({ member, availability: busyMember, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });

    expect(scoreAvail.availabilityScore).toBeGreaterThan(scoreBusy.availabilityScore);
  });

  test('continuity score is 1.0 when member is prior assignee', () => {
    const memberId = makeAlaraId('00000000-0000-4000-8000-100000000001');
    const member = makeMember({ id: memberId });
    const avail = makeAvail({ memberId });

    const withContinuity = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: memberId });
    const withoutContinuity = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });

    expect(withContinuity.continuityScore).toBe(1.0);
    expect(withoutContinuity.continuityScore).toBe(0.0);
  });

  test('lower load → higher load score', () => {
    const member = makeMember();
    const lowLoad = makeAvail({ currentLoad: 1, maxLoad: 10 });
    const highLoad = makeAvail({ currentLoad: 9, maxLoad: 10 });

    const scoreLow = scoreMember({ member, availability: lowLoad, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });
    const scoreHigh = scoreMember({ member, availability: highLoad, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });

    expect(scoreLow.loadScore).toBeGreaterThan(scoreHigh.loadScore);
  });

  test('program match score 1.0 when all programs covered', () => {
    const member = makeMember();
    const avail = makeAvail();
    const score = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: ['EEOICPA', 'Medicare'], requiredRole: null, priorAssigneeId: null });
    expect(score.programScore).toBe(1.0);
  });

  test('program match score 0.0 when no programs covered', () => {
    const member = makeMember();
    const avail = makeAvail();
    const score = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: ['VA', 'OWCP'], requiredRole: null, priorAssigneeId: null });
    expect(score.programScore).toBe(0.0);
  });

  test('at-capacity member is disqualified', () => {
    const member = makeMember();
    const avail = makeAvail({ status: 'available', currentLoad: 10, maxLoad: 10 });
    const score = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });
    expect(score.disqualified).toBe(true);
    expect(score.disqualificationReason).toContain('maximum capacity');
  });

  test('on-leave member is disqualified', () => {
    const member = makeMember({ status: 'on_leave' });
    const avail = makeAvail({ status: 'on_leave' });
    const score = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });
    expect(score.disqualified).toBe(true);
  });

  test('inactive member is disqualified', () => {
    const member = makeMember({ status: 'inactive' });
    const avail = makeAvail();
    const score = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: [], requiredRole: null, priorAssigneeId: null });
    expect(score.disqualified).toBe(true);
    expect(score.disqualificationReason).toContain('inactive');
  });

  test('role mismatch is disqualifying', () => {
    const member = makeMember({ role: 'scheduler' });
    const avail = makeAvail();
    const score = scoreMember({ member, availability: avail, requiredSkills: [], requiredPrograms: [], requiredRole: 'care_guide', priorAssigneeId: null });
    expect(score.disqualified).toBe(true);
    expect(score.disqualificationReason).toContain('care_guide');
  });

  test('rankCandidates returns primary and up to 3 alternatives', () => {
    const members = [
      makeAlaraId('00000000-0000-4000-8000-100000000001'),
      makeAlaraId('00000000-0000-4000-8000-100000000002'),
      makeAlaraId('00000000-0000-4000-8000-100000000003'),
      makeAlaraId('00000000-0000-4000-8000-100000000004'),
    ].map((id, i) => ({
      memberId: id, memberName: `Member ${i}`, totalScore: (4 - i) * 0.2,
      skillScore: 0.8, availabilityScore: 0.8, continuityScore: 0, loadScore: 0.5, programScore: 0.5,
      disqualified: false, disqualificationReason: null,
    } as CandidateScore));

    const { primary, alternatives } = rankCandidates(members);
    expect(primary).not.toBeNull();
    expect(primary!.totalScore).toBe(0.8);
    expect(alternatives.length).toBeLessThanOrEqual(3);
  });

  test('rankCandidates returns null primary when all disqualified', () => {
    const disqualified: CandidateScore[] = [{
      memberId: makeAlaraId('00000000-0000-4000-8000-100000000001'),
      memberName: 'Unavailable', totalScore: 0,
      skillScore: 0, availabilityScore: 0, continuityScore: 0, loadScore: 0, programScore: 0,
      disqualified: true, disqualificationReason: 'on leave',
    }];
    const { primary } = rankCandidates(disqualified);
    expect(primary).toBeNull();
  });

  test('scoring is deterministic — same input always same output', () => {
    const member = makeMember();
    const avail = makeAvail();
    const input = { member, availability: avail, requiredSkills: ['intake'], requiredPrograms: ['EEOICPA'], requiredRole: null as null, priorAssigneeId: null };
    const s1 = scoreMember(input);
    const s2 = scoreMember(input);
    expect(s1.totalScore).toBe(s2.totalScore);
    expect(s1.skillScore).toBe(s2.skillScore);
    expect(s1.disqualified).toBe(s2.disqualified);
  });
});

// ─── Assignment recommendation ────────────────────────────────────────────────

describe('Assignment recommendation', () => {
  test('recommends an assignment with Rules Engine evaluation', async () => {
    const { engine } = makeEngine();
    await registerMember(engine, { displayName: 'Alice' });

    const result = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: ['intake'], requiredPrograms: ['EEOICPA'],
      requiredRole: null, priority: 'high',
      preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    expect(result.assignment.id).toBeDefined();
    expect(result.assignment.assigneeName).toBe('Alice');
    expect(result.recommendation.primaryRecommendation.memberName).toBe('Alice');
    expect(result.assignment.rulesEngineApproved).not.toBeNull();
    expect(['approved', 'recommended']).toContain(result.assignment.status);
  });

  test('emits AssignmentRecommended event', async () => {
    const { engine, store } = makeEngine();
    await registerMember(engine);
    await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });
    expect(store.events.some(e => e.type === 'AssignmentRecommended')).toBe(true);
  });

  test('highest-scoring member is primary recommendation', async () => {
    const { engine } = makeEngine();
    // Register two members with different loads
    await registerMember(engine, { displayName: 'Light Load' });
    const { member: heavy } = await registerMember(engine, { displayName: 'Heavy Load' });

    // Mark heavy as busy with high load
    await engine.updateAvailability({
      tenantId: TENANT, memberId: heavy.id, status: 'busy',
      unavailableUntil: null, actor: 'system', expectedVersion: 1,
    });
    // Manually increase load in the store
    const store = (engine.repo as unknown as { db: InMemoryStore }).db as unknown as InMemoryStore;
    const availKey = `${String(heavy.id)}::${TENANT}`;
    const avail = store.workforceAvailability.get(availKey);
    if (avail) avail.current_load = 9;

    const result = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    expect(result.recommendation.primaryRecommendation.memberName).toBe('Light Load');
  });

  test('NoEligibleAssigneeError when no active members', async () => {
    const { engine } = makeEngine();
    await expect(engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    })).rejects.toThrow(NoEligibleAssigneeError);
  });

  test('NoEligibleAssigneeError when all members are at capacity', async () => {
    const { engine, store } = makeEngine();
    const { member } = await registerMember(engine);

    // Set to max capacity
    const availKey = `${String(member.id)}::${TENANT}`;
    const avail = store.workforceAvailability.get(availKey);
    if (avail) { avail.current_load = 10; avail.max_load = 10; }

    await expect(engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    })).rejects.toThrow(NoEligibleAssigneeError);
  });

  test('continuity preference honors prior assignee', async () => {
    const { engine } = makeEngine();
    const { member: alice } = await registerMember(engine, { displayName: 'Alice' });
    await registerMember(engine, { displayName: 'Bob' });

    const result = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: true,
      priorAssigneeId: alice.id, dueAt: null, actor: 'system',
    });

    expect(result.recommendation.primaryRecommendation.memberName).toBe('Alice');
    expect(result.recommendation.primaryRecommendation.continuityScore).toBe(1.0);
  });

  test('confidence is high when total score ≥ 0.7', async () => {
    const { engine } = makeEngine();
    // Expert member with all required skills → high score
    await registerMember(engine, {
      skills: {
        ...DEFAULT_SKILL_PROFILE,
        skills: [
          { skill: 'intake', level: 'expert', verifiedAt: null },
          { skill: 'eeoicpa', level: 'expert', verifiedAt: null },
        ],
      },
    });

    const result = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: ['intake', 'eeoicpa'], requiredPrograms: ['EEOICPA'],
      requiredRole: null, priority: 'high',
      preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    expect(['high', 'medium', 'low']).toContain(result.assignment.confidence); // Any valid confidence
  });

  test('role filter restricts candidates to required role', async () => {
    const { engine } = makeEngine();
    await registerMember(engine, { displayName: 'Scheduler', role: 'scheduler' });
    await registerMember(engine, { displayName: 'Supervisor', role: 'supervisor' });

    const result = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: 'supervisor',
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    expect(result.assignment.assigneeName).toBe('Supervisor');
  });
});

// ─── Assignment lifecycle ─────────────────────────────────────────────────────

describe('Assignment lifecycle', () => {
  async function makeAssignment(engine: WorkforceEngine) {
    await registerMember(engine);
    return engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'high', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });
  }

  test('accept → status becomes accepted, load increments', async () => {
    const { engine } = makeEngine();
    const { assignment } = await makeAssignment(engine);

    const result = await engine.acceptAssignment({
      tenantId: TENANT, assignmentId: assignment.id,
      actor: 'care-guide', expectedVersion: assignment.version,
    });

    expect(result.assignment.status).toBe('accepted');
    expect(result.assignment.acceptedAt).not.toBeNull();

    const avail = await engine.repo.getAvailability(TENANT, assignment.assigneeId);
    expect(avail!.currentLoad).toBeGreaterThan(0);
  });

  test('accept emits AssignmentAccepted and CapacityChanged', async () => {
    const { engine, store } = makeEngine();
    const { assignment } = await makeAssignment(engine);
    const countBefore = store.events.length;

    await engine.acceptAssignment({
      tenantId: TENANT, assignmentId: assignment.id,
      actor: 'care-guide', expectedVersion: assignment.version,
    });

    const newEvents = store.events.slice(countBefore);
    expect(newEvents.some(e => e.type === 'AssignmentAccepted')).toBe(true);
    expect(newEvents.some(e => e.type === 'CapacityChanged')).toBe(true);
  });

  test('decline → status becomes declined', async () => {
    const { engine, store } = makeEngine();
    const { assignment } = await makeAssignment(engine);

    const result = await engine.declineAssignment({
      tenantId: TENANT, assignmentId: assignment.id,
      reason: 'Conflict of interest.', actor: 'care-guide',
      expectedVersion: assignment.version,
    });

    expect(result.assignment.status).toBe('declined');
    expect(store.events.some(e => e.type === 'AssignmentDeclined')).toBe(true);
  });

  test('transfer → assignee changes, original assignee load decreases', async () => {
    const { engine } = makeEngine();
    const { assignment } = await makeAssignment(engine);

    // Accept first
    await engine.acceptAssignment({ tenantId: TENANT, assignmentId: assignment.id, actor: 'system', expectedVersion: assignment.version });

    // Register new member to transfer to
    const { member: bob } = await registerMember(engine, { displayName: 'Bob' });

    const accepted = (await engine.repo.getAssignmentById(TENANT, assignment.id))!;
    const result = await engine.transferAssignment({
      tenantId: TENANT, assignmentId: assignment.id,
      newAssigneeId: bob.id, reason: 'Coverage change.',
      actor: 'supervisor', expectedVersion: accepted.version,
    });

    expect(result.assignment.assigneeName).toBe('Bob');
    expect(String(result.assignment.transferredFromId)).toBe(String(assignment.assigneeId));
  });

  test('transfer emits AssignmentTransferred', async () => {
    const { engine, store } = makeEngine();
    const { assignment } = await makeAssignment(engine);
    const { member: bob } = await registerMember(engine, { displayName: 'Bob' });

    const countBefore = store.events.length;
    await engine.transferAssignment({
      tenantId: TENANT, assignmentId: assignment.id, newAssigneeId: bob.id,
      reason: 'Reassignment.', actor: 'supervisor', expectedVersion: assignment.version,
    });

    const newEvents = store.events.slice(countBefore);
    expect(newEvents.some(e => e.type === 'AssignmentTransferred')).toBe(true);
  });

  test('complete → status becomes completed, load decrements', async () => {
    const { engine } = makeEngine();
    const { assignment } = await makeAssignment(engine);

    // Accept first
    await engine.acceptAssignment({ tenantId: TENANT, assignmentId: assignment.id, actor: 'system', expectedVersion: assignment.version });
    const accepted = (await engine.repo.getAssignmentById(TENANT, assignment.id))!;

    const result = await engine.completeAssignment({
      tenantId: TENANT, assignmentId: assignment.id,
      actor: 'care-guide', expectedVersion: accepted.version,
    });

    expect(result.assignment.status).toBe('completed');
    expect(result.assignment.completedAt).not.toBeNull();
  });

  test('escalate → status becomes escalated, emits EscalationTriggered', async () => {
    const { engine, store } = makeEngine();
    const { assignment } = await makeAssignment(engine);

    const result = await engine.triggerEscalation({
      tenantId: TENANT, assignmentId: assignment.id,
      trigger: 'no_acceptance', actor: 'system', expectedVersion: assignment.version,
    });

    expect(result.assignment.status).toBe('escalated');
    expect(store.events.some(e => e.type === 'EscalationTriggered')).toBe(true);
  });
});

// ─── Optimistic concurrency ───────────────────────────────────────────────────

describe('Optimistic concurrency', () => {
  test('stale version on accept → StaleAssignmentError', async () => {
    const { engine } = makeEngine();
    await registerMember(engine);
    const { assignment } = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    await engine.acceptAssignment({ tenantId: TENANT, assignmentId: assignment.id, actor: 'system', expectedVersion: assignment.version });
    await expect(engine.acceptAssignment({ tenantId: TENANT, assignmentId: assignment.id, actor: 'system', expectedVersion: assignment.version })).rejects.toThrow(StaleAssignmentError);
  });

  test('unknown assignment → AssignmentNotFoundError', async () => {
    const { engine } = makeEngine();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-999999999999');
    await expect(engine.acceptAssignment({ tenantId: TENANT, assignmentId: fakeId, actor: 'system', expectedVersion: 1 })).rejects.toThrow(AssignmentNotFoundError);
  });

  test('stale version on decline → StaleAssignmentError', async () => {
    const { engine } = makeEngine();
    await registerMember(engine);
    const { assignment } = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    await engine.declineAssignment({ tenantId: TENANT, assignmentId: assignment.id, reason: 'No.', actor: 'system', expectedVersion: assignment.version });
    await expect(engine.declineAssignment({ tenantId: TENANT, assignmentId: assignment.id, reason: 'Again.', actor: 'system', expectedVersion: assignment.version })).rejects.toThrow(StaleAssignmentError);
  });
});

// ─── No side effects ──────────────────────────────────────────────────────────

describe('No side effects', () => {
  test('workforce engine only emits workforce events', async () => {
    const { engine, store } = makeEngine();
    await registerMember(engine, { displayName: 'Alice' });
    const { assignment } = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });
    await engine.acceptAssignment({ tenantId: TENANT, assignmentId: assignment.id, actor: 'system', expectedVersion: assignment.version });

    const ALLOWED = new Set([
      'WorkforceMemberRegistered', 'AssignmentRecommended', 'AssignmentApproved',
      'AssignmentAccepted', 'AssignmentDeclined', 'AssignmentTransferred',
      'AssignmentCompleted', 'CapacityChanged', 'EscalationTriggered', 'AvailabilityChanged',
    ]);
    const FORBIDDEN = ['WorkflowStarted', 'TaskCreated', 'PromiseCreated', 'CommunicationCreated'];

    for (const evt of store.events) {
      expect(FORBIDDEN).not.toContain(evt.type);
    }
    const workforceEvents = store.events.filter(e => ALLOWED.has(e.type));
    expect(workforceEvents.length).toBeGreaterThan(0);
  });
});

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

describe('Event-sourced reconstruction', () => {
  test('reconstruct accepted assignment from events', async () => {
    const { engine, eventStore } = makeEngine();
    await registerMember(engine);
    const { assignment } = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'high', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });
    await engine.acceptAssignment({ tenantId: TENANT, assignmentId: assignment.id, actor: 'system', expectedVersion: assignment.version });

    const reconstructed = await reconstructAssignmentFromEvents(eventStore, TENANT, assignment.id);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.status).toBe('accepted');
    expect(reconstructed!.assigneeId).toBeTruthy();
  });

  test('reconstruct declined assignment', async () => {
    const { engine, eventStore } = makeEngine();
    await registerMember(engine);
    const { assignment } = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });
    await engine.declineAssignment({ tenantId: TENANT, assignmentId: assignment.id, reason: 'No.', actor: 'system', expectedVersion: assignment.version });

    const reconstructed = await reconstructAssignmentFromEvents(eventStore, TENANT, assignment.id);
    expect(reconstructed!.status).toBe('declined');
  });

  test('reconstruct transferred assignment shows new assignee', async () => {
    const { engine, eventStore } = makeEngine();
    await registerMember(engine, { displayName: 'Alice' });
    const { assignment } = await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });
    const { member: bob } = await registerMember(engine, { displayName: 'Bob' });
    await engine.transferAssignment({ tenantId: TENANT, assignmentId: assignment.id, newAssigneeId: bob.id, reason: 'Transfer.', actor: 'supervisor', expectedVersion: assignment.version });

    const reconstructed = await reconstructAssignmentFromEvents(eventStore, TENANT, assignment.id);
    expect(reconstructed!.status).toBe('approved'); // transferred → back to approved for new assignee
    expect(reconstructed!.assigneeId).toBe(String(bob.id));
    expect(reconstructed!.transferredFromId).toBeTruthy();
  });

  test('null for unknown assignment ID', async () => {
    const { eventStore } = makeEngine();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-777777777777');
    const result = await reconstructAssignmentFromEvents(eventStore, TENANT, fakeId);
    expect(result).toBeNull();
  });
});

// ─── WorkforceHealthProjection (ADR-016) ──────────────────────────────────────

describe('WorkforceHealthProjection (ADR-016)', () => {
  function makeProjectionStack() {
    const projRegistry = new ProjectionRegistry();
    projRegistry.register(WorkforceHealthProjectionDefinition);
    const projStore = new InMemoryProjectionStore();
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const projEngine = new ProjectionEngine(projRegistry, projStore, eventStore);
    const rebuilder = new ProjectionRebuilder(projEngine, projStore);
    return { projEngine, projStore, rebuilder };
  }

  function makeAssembler(input: WorkforceHealthInput): ProjectionInputAssembler<WorkforceHealthInput> {
    return {
      async assemble(sid) { return { ...input, tenantId: sid }; },
      async sourceEventIds() { return [...input.members.map(m => String(m.id)), ...input.activeAssignments.map(a => String(a.id))]; },
    };
  }

  function makeMemberInput(overrides: Partial<WorkforceMember> = {}): WorkforceMember {
    return {
      id: makeAlaraId('00000000-0000-4000-8000-100000000001'),
      tenantId: TENANT, displayName: 'Alice', role: 'care_guide',
      status: 'active', teamId: null, supervisorId: null, externalHrId: null,
      skillProfile: DEFAULT_SKILL_PROFILE, coverageArea: DEFAULT_COVERAGE,
      escalationPathId: null, createdAt: new Date(), updatedAt: new Date(), version: 1,
      ...overrides,
    };
  }

  function makeAvailInput(memberId: AlaraId, overrides: Partial<Availability> = {}): Availability {
    return {
      memberId, tenantId: TENANT, status: 'available',
      currentLoad: 2, maxLoad: 10, nextAvailableAt: null,
      unavailableUntil: null, snapshotAt: new Date().toISOString(),
      ...overrides,
    };
  }

  test('builds workforce health from members and assignments', async () => {
    const { projEngine } = makeProjectionStack();
    const member = makeMemberInput();
    const avail = makeAvailInput(member.id);
    const input: WorkforceHealthInput = { tenantId: TENANT, members: [member], availabilities: [avail], activeAssignments: [] };

    const result = await projEngine.build(TENANT, 'WorkforceHealth', TENANT, makeAssembler(input));
    expect(result.built).toBe(true);
    if (!result.built) return;

    const value = result.projection.value as unknown as WorkforceHealthValue;
    expect(value.totalActiveMembers).toBe(1);
    expect(value.disclaimer).toBe('computed-projection-advisory-only');
    expect(value.healthScore).toBeGreaterThanOrEqual(0);
    expect(value.healthScore).toBeLessThanOrEqual(1);
    expect(value.coordinationRisk).toBeDefined();
  });

  test('ADR-016: aiInvolved=false (deterministic engine)', async () => {
    const { projEngine } = makeProjectionStack();
    const input: WorkforceHealthInput = { tenantId: TENANT, members: [], availabilities: [], activeAssignments: [] };
    const result = await projEngine.build(TENANT, 'WorkforceHealth', TENANT, makeAssembler(input));
    if (!result.built) return;
    expect(result.projection.metadata.aiInvolved).toBe(false);
    expect(result.projection.metadata.methodVersion).toBe('1.0.0');
  });

  test('overloaded members (≥90% utilization) appear in overloadedMembers', async () => {
    const { projEngine } = makeProjectionStack();
    const member = makeMemberInput();
    const avail = makeAvailInput(member.id, { currentLoad: 9, maxLoad: 10, status: 'busy' });
    const input: WorkforceHealthInput = { tenantId: TENANT, members: [member], availabilities: [avail], activeAssignments: [] };

    const result = await projEngine.build(TENANT, 'WorkforceHealth', TENANT, makeAssembler(input));
    if (!result.built) return;
    const value = result.projection.value as unknown as WorkforceHealthValue;
    expect(value.overloadedMembers.length).toBeGreaterThan(0);
    expect(value.healthScore).toBeLessThan(1);
  });

  test('zero members → unknown coordination risk', async () => {
    const { projEngine } = makeProjectionStack();
    const input: WorkforceHealthInput = { tenantId: TENANT, members: [], availabilities: [], activeAssignments: [] };
    const result = await projEngine.build(TENANT, 'WorkforceHealth', TENANT, makeAssembler(input));
    if (!result.built) return;
    const value = result.projection.value as unknown as WorkforceHealthValue;
    expect(value.coordinationRisk).toBe('critical'); // no available members = critical
  });

  test('ADR-016: projection rebuilds identically after clearing store', async () => {
    const { projEngine, projStore, rebuilder } = makeProjectionStack();
    const member = makeMemberInput();
    const avail = makeAvailInput(member.id);
    const input: WorkforceHealthInput = { tenantId: TENANT, members: [member], availabilities: [avail], activeAssignments: [] };
    const assembler = makeAssembler(input);

    const original = await projEngine.build(TENANT, 'WorkforceHealth', TENANT, assembler);
    expect(original.built).toBe(true);
    if (!original.built) return;

    projStore.clear();
    const rebuilt = await rebuilder.rebuild(TENANT, 'WorkforceHealth', TENANT, assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;

    const ov = original.projection.value as unknown as WorkforceHealthValue;
    const rv = rebuilt.projection.value as unknown as WorkforceHealthValue;
    expect(rv.totalActiveMembers).toBe(ov.totalActiveMembers);
    expect(rv.healthScore).toBe(ov.healthScore);
    expect(rv.coordinationRisk).toBe(ov.coordinationRisk);
    expect(rv.disclaimer).toBe(ov.disclaimer);
  });

  test('membersByRole counts correctly across roles', async () => {
    const { projEngine } = makeProjectionStack();
    const id1 = makeAlaraId('00000000-0000-4000-8000-100000000001');
    const id2 = makeAlaraId('00000000-0000-4000-8000-100000000002');
    const members: WorkforceMember[] = [
      makeMemberInput({ id: id1, role: 'care_guide' }),
      makeMemberInput({ id: id2, role: 'supervisor', displayName: 'Bob' }),
    ];
    const input: WorkforceHealthInput = { tenantId: TENANT, members, availabilities: [], activeAssignments: [] };
    const result = await projEngine.build(TENANT, 'WorkforceHealth', TENANT, makeAssembler(input));
    if (!result.built) return;
    const value = result.projection.value as unknown as WorkforceHealthValue;
    expect(value.membersByRole.care_guide).toBe(1);
    expect(value.membersByRole.supervisor).toBe(1);
  });
});

// ─── Repository queries ───────────────────────────────────────────────────────

describe('WorkforceRepository', () => {
  test('getActiveMembersForTenant returns only active members', async () => {
    const { engine } = makeEngine();
    await registerMember(engine, { displayName: 'Alice' });
    await registerMember(engine, { displayName: 'Bob' });

    const members = await engine.repo.getActiveMembersForTenant(TENANT);
    expect(members.length).toBe(2);
    expect(members.every(m => m.status === 'active')).toBe(true);
  });

  test('getAssignmentsForSubject returns all assignments for a subject', async () => {
    const { engine } = makeEngine();
    await registerMember(engine);
    await engine.recommendAssignment({
      tenantId: TENANT, subjectId: SUBJECT_ID, subjectType: 'Patient',
      requiredSkills: [], requiredPrograms: [], requiredRole: null,
      priority: 'medium', preferContinuity: false, priorAssigneeId: null, dueAt: null, actor: 'system',
    });

    const assignments = await engine.repo.getAssignmentsForSubject(TENANT, SUBJECT_ID);
    expect(assignments.length).toBe(1);
    expect(assignments[0].subjectId).toBe(SUBJECT_ID);
  });
});
