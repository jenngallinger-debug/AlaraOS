/**
 * Alara OS — Workforce Intelligence & Coordination Engine (M10)
 *
 * The engine that answers: "Who should do the work?"
 *
 * Core operations:
 *   registerMember     — adds a workforce member to the OS
 *   updateAvailability — records current availability/capacity status
 *   recommendAssignment — deterministic scoring → Rules Engine gate → Assignment
 *   acceptAssignment   — member acknowledges work
 *   declineAssignment  — member declines, triggers re-recommendation
 *   transferAssignment — ownership handoff
 *   completeAssignment — work done, capacity freed
 *   triggerEscalation  — escalate per configured path
 *
 * Rules Engine gate: every assignment recommendation is evaluated before
 * being marked 'approved'. Nothing is auto-assigned.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { RulesEngine } from '../rules-engine/engine';
import { RuleContext } from '../rules-engine/types';
import { rankCandidates, scoreMember } from './recommender';
import { WorkforceRepository } from './repository';
import {
  AcceptAssignmentCommand,
  Assignment,
  AssignmentAcceptedPayload,
  AssignmentApprovedPayload,
  AssignmentConfidence,
  AssignmentDeclinedPayload,
  AssignmentEvidence,
  AssignmentNotFoundError,
  AssignmentRecommendation,
  AssignmentRecommendedPayload,
  AssignmentTransferredPayload,
  AssignmentCompletedPayload,
  Availability,
  AvailabilityChangedPayload,
  AvailabilityStatus,
  CapacityChangedPayload,
  CapacitySnapshot,
  CompleteAssignmentCommand,
  DeclineAssignmentCommand,
  EscalationTriggeredPayload,
  NoEligibleAssigneeError,
  RecommendAssignmentCommand,
  RegisterWorkforceMemberCommand,
  StaleAssignmentError,
  TransferAssignmentCommand,
  TriggerEscalationCommand,
  UpdateAvailabilityCommand,
  WorkforceMember,
  WorkforceMemberNotFoundError,
  WorkforceMemberRegisteredPayload,
  CandidateScore,
} from './types';

// ─── Engine result types ──────────────────────────────────────────────────────

export interface RegisterMemberResult { member: WorkforceMember; eventId: string }
export interface RecommendAssignmentResult { assignment: Assignment; recommendation: AssignmentRecommendation; eventId: string }
export interface AssignmentActionResult { assignment: Assignment; eventId: string }

// ─── Engine ───────────────────────────────────────────────────────────────────

export class WorkforceEngine {
  readonly repo: WorkforceRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
    private readonly rules: RulesEngine,
  ) {
    this.repo = new WorkforceRepository(db);
  }

  // ── Register workforce member ──────────────────────────────────────────────

  async registerMember(cmd: RegisterWorkforceMemberCommand): Promise<RegisterMemberResult> {
    return this.db.transaction(async (client) => {
      const id = newAlaraId();
      const now = new Date().toISOString();

      await client.query(
        `INSERT INTO workforce_members
           (id, tenant_id, display_name, role, status, team_id, supervisor_id,
            external_hr_id, skill_profile, coverage_area, escalation_path_id, version)
         VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,1)`,
        [
          id, cmd.tenantId, cmd.displayName, cmd.role,
          cmd.teamId ?? null, cmd.supervisorId ?? null, cmd.externalHrId ?? null,
          JSON.stringify(cmd.skillProfile), JSON.stringify(cmd.coverageArea),
          cmd.escalationPathId ?? null,
        ],
      );

      // Seed initial availability
      await client.query(
        `INSERT INTO workforce_availability
           (member_id, tenant_id, status, current_load, max_load, snapshot_at)
         VALUES ($1,$2,'available',0,10,$3)
         ON CONFLICT (member_id, tenant_id) DO NOTHING`,
        [id, cmd.tenantId, now],
      );

      const payload: WorkforceMemberRegisteredPayload = {
        memberId: String(id), displayName: cmd.displayName,
        role: cmd.role, tenantId: cmd.tenantId,
      };
      const evt = await this.eventStore.append({
        tenantId: cmd.tenantId, streamId: id,
        type: 'WorkforceMemberRegistered' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
      });

      const member = (await this.repo.getMemberById(cmd.tenantId, id))!;
      return { member, eventId: evt.id };
    });
  }

  // ── Update availability ────────────────────────────────────────────────────

  async updateAvailability(cmd: UpdateAvailabilityCommand): Promise<void> {
    const member = await this.repo.getMemberById(cmd.tenantId, cmd.memberId);
    if (!member) throw new WorkforceMemberNotFoundError(cmd.memberId);

    const current = await this.repo.getAvailability(cmd.tenantId, cmd.memberId);
    const previousStatus = current?.status ?? 'available';

    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO workforce_availability
           (member_id, tenant_id, status, current_load, max_load, unavailable_until, snapshot_at)
         VALUES ($1,$2,$3,COALESCE((SELECT current_load FROM workforce_availability WHERE member_id=$1 AND tenant_id=$2),0),
                 COALESCE((SELECT max_load FROM workforce_availability WHERE member_id=$1 AND tenant_id=$2),10),
                 $4, NOW())
         ON CONFLICT (member_id, tenant_id) DO UPDATE
           SET status = EXCLUDED.status,
               unavailable_until = EXCLUDED.unavailable_until,
               snapshot_at = NOW()`,
        [cmd.memberId, cmd.tenantId, cmd.status, cmd.unavailableUntil ?? null],
      );
    });

    const payload: AvailabilityChangedPayload = {
      memberId: String(cmd.memberId),
      previousStatus,
      newStatus: cmd.status,
      unavailableUntil: cmd.unavailableUntil ?? null,
    };
    await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: cmd.memberId,
      type: 'AvailabilityChanged' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });
  }

  // ── Recommend assignment ───────────────────────────────────────────────────

  async recommendAssignment(cmd: RecommendAssignmentCommand): Promise<RecommendAssignmentResult> {
    // 1. Load all active members
    const members = await this.repo.getActiveMembersForTenant(cmd.tenantId, cmd.requiredRole ?? undefined);
    if (members.length === 0) {
      throw new NoEligibleAssigneeError(cmd.subjectId, 'No active workforce members found.');
    }

    // 2. Load availability for all members
    const availMap = await this.repo.getAvailabilityForMembers(
      cmd.tenantId,
      members.map(m => m.id),
    );

    // 3. Score each member
    const scores = members.map(member => {
      const availability = availMap.get(String(member.id)) ?? defaultAvailability(member.id, cmd.tenantId);
      return scoreMember({
        member, availability,
        requiredSkills: cmd.requiredSkills,
        requiredPrograms: cmd.requiredPrograms,
        requiredRole: cmd.requiredRole,
        priorAssigneeId: cmd.preferContinuity ? cmd.priorAssigneeId : null,
      });
    });

    // 4. Rank and select
    const { primary, alternatives } = rankCandidates(scores);
    if (!primary) {
      throw new NoEligibleAssigneeError(
        cmd.subjectId,
        'All workforce members are disqualified (capacity, leave, or role mismatch).',
      );
    }

    // 5. Build recommendation
    const recommendation: AssignmentRecommendation = {
      id: newAlaraId(),
      tenantId: cmd.tenantId,
      subjectId: cmd.subjectId,
      subjectType: cmd.subjectType,
      primaryRecommendation: primary,
      alternativeRecommendations: alternatives,
      reasoning: buildReasoning(primary, cmd),
      confidence: primary.totalScore >= 0.7 ? 'high' : primary.totalScore >= 0.4 ? 'medium' : 'low',
      generatedAt: new Date(),
    };

    const evidence: AssignmentEvidence = {
      reasons: [recommendation.reasoning],
      skillMatchScore: primary.skillScore,
      availabilityScore: primary.availabilityScore,
      continuityScore: primary.continuityScore,
      loadScore: primary.loadScore,
      programMatchScore: primary.programScore,
      supportingMemberIds: [String(primary.memberId)],
      alternativeMemberIds: alternatives.map(a => String(a.memberId)),
    };

    // 6. Persist assignment in 'recommended' state
    const assignmentId = newAlaraId();
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO assignments
           (id, tenant_id, subject_id, subject_type, assignee_id, assignee_name,
            priority, status, reason, evidence, confidence, due_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'recommended',$8,$9,$10,$11,1)`,
        [
          assignmentId, cmd.tenantId, cmd.subjectId, cmd.subjectType,
          primary.memberId, primary.memberName, cmd.priority,
          recommendation.reasoning, JSON.stringify(evidence),
          recommendation.confidence,
          cmd.dueAt?.toISOString() ?? null,
        ],
      );
    });

    const recommendedPayload: AssignmentRecommendedPayload = {
      assignmentId: String(assignmentId),
      subjectId: cmd.subjectId, subjectType: cmd.subjectType,
      recommendedMemberId: String(primary.memberId),
      recommendedMemberName: primary.memberName,
      confidence: recommendation.confidence,
      priority: cmd.priority,
    };
    const evt = await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: assignmentId,
      type: 'AssignmentRecommended' as EventType,
      payload: recommendedPayload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    // 7. Rules Engine gate
    const ruleContext: RuleContext = {
      tenantId: cmd.tenantId, actor: cmd.actor,
      eventType: 'WorkforceAssignmentRequested',
      eventPayload: {
        objectType: cmd.subjectType,
        assignmentId: String(assignmentId),
        priority: cmd.priority,
        confidence: recommendation.confidence,
      },
      ruleSetId: 'ruleset.intake',
      objects: {},
      metadata: { accessType: 'write' },
    };
    const decision = await this.rules.evaluate(ruleContext);
    const approved = decision.outcome !== 'DENY';

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE assignments SET rules_engine_approved = $1, rules_engine_explanation = $2,
           status = $3, version = version + 1
         WHERE id = $4 AND tenant_id = $5`,
        [
          approved, decision.explanation.summary,
          approved ? 'approved' : 'recommended',
          assignmentId, cmd.tenantId,
        ],
      );
    });

    if (approved) {
      const approvedPayload: AssignmentApprovedPayload = {
        assignmentId: String(assignmentId),
        assigneeId: String(primary.memberId),
        rulesEngineDecision: decision.explanation.summary,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId, streamId: assignmentId,
        type: 'AssignmentApproved' as EventType,
        payload: approvedPayload as unknown as Record<string, unknown>,
        actor: cmd.actor,
      });
    }

    const assignment = (await this.repo.getAssignmentById(cmd.tenantId, assignmentId))!;
    return { assignment, recommendation, eventId: evt.id };
  }

  // ── Accept assignment ──────────────────────────────────────────────────────

  async acceptAssignment(cmd: AcceptAssignmentCommand): Promise<AssignmentActionResult> {
    const assignment = await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId);
    if (!assignment) throw new AssignmentNotFoundError(cmd.assignmentId);
    if (assignment.version !== cmd.expectedVersion) throw new StaleAssignmentError(cmd.assignmentId, cmd.expectedVersion, assignment.version);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE assignments SET status = 'accepted', accepted_at = NOW(), version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.assignmentId, cmd.tenantId, cmd.expectedVersion],
      );
      // Increment member load
      await client.query(
        `UPDATE workforce_availability SET current_load = current_load + 1
         WHERE member_id = $1 AND tenant_id = $2`,
        [assignment.assigneeId, cmd.tenantId],
      );
    });

    const payload: AssignmentAcceptedPayload = {
      assignmentId: String(cmd.assignmentId),
      assigneeId: String(assignment.assigneeId),
      acceptedAt: new Date().toISOString(),
    };
    const evt = await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: cmd.assignmentId,
      type: 'AssignmentAccepted' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    await this.emitCapacityChanged(cmd.tenantId, assignment.assigneeId, cmd.actor);
    const updated = (await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId))!;
    return { assignment: updated, eventId: evt.id };
  }

  // ── Decline assignment ─────────────────────────────────────────────────────

  async declineAssignment(cmd: DeclineAssignmentCommand): Promise<AssignmentActionResult> {
    const assignment = await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId);
    if (!assignment) throw new AssignmentNotFoundError(cmd.assignmentId);
    if (assignment.version !== cmd.expectedVersion) throw new StaleAssignmentError(cmd.assignmentId, cmd.expectedVersion, assignment.version);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE assignments SET status = 'declined', version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.assignmentId, cmd.tenantId, cmd.expectedVersion],
      );
    });

    const payload: AssignmentDeclinedPayload = {
      assignmentId: String(cmd.assignmentId),
      assigneeId: String(assignment.assigneeId),
      reason: cmd.reason,
    };
    const evt = await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: cmd.assignmentId,
      type: 'AssignmentDeclined' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    const updated = (await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId))!;
    return { assignment: updated, eventId: evt.id };
  }

  // ── Transfer assignment ────────────────────────────────────────────────────

  async transferAssignment(cmd: TransferAssignmentCommand): Promise<AssignmentActionResult> {
    const assignment = await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId);
    if (!assignment) throw new AssignmentNotFoundError(cmd.assignmentId);
    if (assignment.version !== cmd.expectedVersion) throw new StaleAssignmentError(cmd.assignmentId, cmd.expectedVersion, assignment.version);

    const newAssignee = await this.repo.getMemberById(cmd.tenantId, cmd.newAssigneeId);
    if (!newAssignee) throw new WorkforceMemberNotFoundError(cmd.newAssigneeId);

    const fromId = assignment.assigneeId;

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE assignments SET assignee_id = $1, assignee_name = $2,
           status = 'approved', transferred_from_id = $3, version = version + 1
         WHERE id = $4 AND tenant_id = $5 AND version = $6`,
        [
          cmd.newAssigneeId, newAssignee.displayName,
          fromId, cmd.assignmentId, cmd.tenantId, cmd.expectedVersion,
        ],
      );
      // Decrement old owner load if was accepted
      if (assignment.status === 'accepted') {
        await client.query(
          `UPDATE workforce_availability SET current_load = GREATEST(0, current_load - 1)
           WHERE member_id = $1 AND tenant_id = $2`,
          [fromId, cmd.tenantId],
        );
      }
    });

    const payload: AssignmentTransferredPayload = {
      assignmentId: String(cmd.assignmentId),
      fromMemberId: String(fromId),
      toMemberId: String(cmd.newAssigneeId),
      reason: cmd.reason,
    };
    const evt = await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: cmd.assignmentId,
      type: 'AssignmentTransferred' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    await this.emitCapacityChanged(cmd.tenantId, fromId, cmd.actor);
    const updated = (await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId))!;
    return { assignment: updated, eventId: evt.id };
  }

  // ── Complete assignment ────────────────────────────────────────────────────

  async completeAssignment(cmd: CompleteAssignmentCommand): Promise<AssignmentActionResult> {
    const assignment = await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId);
    if (!assignment) throw new AssignmentNotFoundError(cmd.assignmentId);
    if (assignment.version !== cmd.expectedVersion) throw new StaleAssignmentError(cmd.assignmentId, cmd.expectedVersion, assignment.version);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE assignments SET status = 'completed', completed_at = NOW(), version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.assignmentId, cmd.tenantId, cmd.expectedVersion],
      );
      if (assignment.status === 'accepted') {
        await client.query(
          `UPDATE workforce_availability SET current_load = GREATEST(0, current_load - 1)
           WHERE member_id = $1 AND tenant_id = $2`,
          [assignment.assigneeId, cmd.tenantId],
        );
      }
    });

    const payload: AssignmentCompletedPayload = {
      assignmentId: String(cmd.assignmentId),
      assigneeId: String(assignment.assigneeId),
      completedAt: new Date().toISOString(),
    };
    const evt = await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: cmd.assignmentId,
      type: 'AssignmentCompleted' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    await this.emitCapacityChanged(cmd.tenantId, assignment.assigneeId, cmd.actor);
    const updated = (await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId))!;
    return { assignment: updated, eventId: evt.id };
  }

  // ── Trigger escalation ─────────────────────────────────────────────────────

  async triggerEscalation(cmd: TriggerEscalationCommand): Promise<AssignmentActionResult> {
    const assignment = await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId);
    if (!assignment) throw new AssignmentNotFoundError(cmd.assignmentId);
    if (assignment.version !== cmd.expectedVersion) throw new StaleAssignmentError(cmd.assignmentId, cmd.expectedVersion, assignment.version);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE assignments SET status = 'escalated', version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.assignmentId, cmd.tenantId, cmd.expectedVersion],
      );
    });

    const payload: EscalationTriggeredPayload = {
      assignmentId: String(cmd.assignmentId),
      trigger: cmd.trigger,
      escalatedToRole: 'supervisor',
      escalatedToMemberId: null,
    };
    const evt = await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: cmd.assignmentId,
      type: 'EscalationTriggered' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    const updated = (await this.repo.getAssignmentById(cmd.tenantId, cmd.assignmentId))!;
    return { assignment: updated, eventId: evt.id };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async emitCapacityChanged(tenantId: string, memberId: AlaraId, actor: string): Promise<void> {
    const avail = await this.repo.getAvailability(tenantId, memberId);
    if (!avail) return;

    const utilization = avail.maxLoad > 0 ? avail.currentLoad / avail.maxLoad : 0;
    const payload: CapacityChangedPayload = {
      memberId: String(memberId),
      previousLoad: avail.currentLoad,
      newLoad: avail.currentLoad,
      utilizationRate: Math.round(utilization * 100) / 100,
    };
    await this.eventStore.append({
      tenantId, streamId: memberId,
      type: 'CapacityChanged' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultAvailability(memberId: AlaraId, tenantId: string): Availability {
  return {
    memberId, tenantId, status: 'available',
    currentLoad: 0, maxLoad: 10,
    nextAvailableAt: null, unavailableUntil: null,
    snapshotAt: new Date().toISOString(),
  };
}

function buildReasoning(primary: CandidateScore, cmd: RecommendAssignmentCommand): string {
  const parts: string[] = [`Recommended ${primary.memberName} (score: ${primary.totalScore.toFixed(2)})`];
  if (cmd.preferContinuity && cmd.priorAssigneeId && String(cmd.priorAssigneeId) === String(primary.memberId)) {
    parts.push('continuity preference honored');
  }
  if (cmd.requiredSkills.length > 0) parts.push(`skills: ${cmd.requiredSkills.join(', ')}`);
  if (cmd.requiredPrograms.length > 0) parts.push(`programs: ${cmd.requiredPrograms.join(', ')}`);
  return parts.join(' · ');
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedAssignment {
  id: AlaraId;
  status: string;
  assigneeId: string;
  version: number;
  transferredFromId: string | null;
}

export async function reconstructAssignmentFromEvents(
  eventStore: EventStore,
  tenantId: string,
  assignmentId: AlaraId,
): Promise<ReconstructedAssignment | null> {
  const events = await eventStore.loadStream(tenantId, assignmentId);
  if (!events.length) return null;

  let status = 'recommended';
  let assigneeId = '';
  let version = 0;
  let transferredFromId: string | null = null;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'AssignmentRecommended':
        assigneeId = p.recommendedMemberId as string;
        break;
      case 'AssignmentApproved':  status = 'approved'; break;
      case 'AssignmentAccepted':  status = 'accepted'; break;
      case 'AssignmentDeclined':  status = 'declined'; break;
      case 'AssignmentTransferred':
        status = 'approved';
        transferredFromId = p.fromMemberId as string;
        assigneeId = p.toMemberId as string;
        break;
      case 'AssignmentCompleted': status = 'completed'; break;
      case 'EscalationTriggered': status = 'escalated'; break;
    }
  }

  return { id: assignmentId, status, assigneeId, version, transferredFromId };
}
