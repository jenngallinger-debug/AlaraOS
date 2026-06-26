/**
 * Alara OS — Workforce Intelligence & Coordination Engine Types (M10)
 *
 * Constitutional alignment:
 *   "Technology exists to carry organizational burden so people can carry
 *    human responsibility." (Part XI — Platform Design Philosophy)
 *
 * M10 answers one question: Who should do the work?
 *
 * The engine:
 *   DOES: recommend, route, balance, escalate, track, coordinate
 *   DOES NOT: auto-assign without Rules approval, perform work, override humans
 *
 * Every assignment recommendation flows through the Rules Engine before acceptance.
 * Every output is traceable to evidence and explainable.
 *
 * ADR-014 (Participation): WorkforceMember is an operating identity object.
 *   HR/payroll/credentialing are external sources of truth.
 *   AlaraOS owns: permissions, assignment, coverage, competency signals,
 *   action attribution, and operating history.
 *
 * ADR-016: WorkforceHealthProjection is a Computed Projection.
 *   Disposable. Rebuildable. Not canonical state.
 */

import { AlaraId } from '../shared/types';

// ─── WorkforceMember ──────────────────────────────────────────────────────────

export type WorkforceMemberStatus = 'active' | 'inactive' | 'on_leave' | 'unavailable';

export type WorkforceRole =
  | 'care_guide'
  | 'clinical_coordinator'
  | 'intake_specialist'
  | 'scheduler'
  | 'quality_reviewer'
  | 'supervisor'
  | 'administrator';

export interface WorkforceMember {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly displayName: string;
  readonly role: WorkforceRole;
  readonly status: WorkforceMemberStatus;
  readonly teamId: AlaraId | null;
  readonly supervisorId: AlaraId | null;
  /** External HR/payroll ID — AlaraOS does not own HR data */
  readonly externalHrId: string | null;
  readonly skillProfile: SkillProfile;
  readonly coverageArea: CoverageArea;
  readonly escalationPathId: AlaraId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

// ─── Team ─────────────────────────────────────────────────────────────────────

export interface Team {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly leadId: AlaraId | null;
  readonly memberIds: readonly AlaraId[];
  readonly specializations: readonly string[];
  readonly createdAt: Date;
  readonly version: number;
}

// ─── SkillProfile ─────────────────────────────────────────────────────────────

export type SkillLevel = 'novice' | 'competent' | 'proficient' | 'expert';

export interface SkillEntry {
  readonly skill: string;
  readonly level: SkillLevel;
  readonly verifiedAt: string | null; // ISO date
}

export interface SkillProfile {
  readonly skills: readonly SkillEntry[];
  readonly programs: readonly string[]; // e.g. 'EEOICPA', 'VA', 'OWCP', 'Medicare'
  readonly languages: readonly string[];
  readonly certifications: readonly string[];
  readonly lastUpdated: string; // ISO date
}

// ─── CoverageArea ─────────────────────────────────────────────────────────────

export interface CoverageArea {
  readonly regionCodes: readonly string[];   // geographic regions
  readonly programCodes: readonly string[];  // program types covered
  readonly serviceLines: readonly string[];  // service types
}

// ─── Availability ─────────────────────────────────────────────────────────────

export type AvailabilityStatus =
  | 'available'
  | 'busy'
  | 'at_capacity'
  | 'on_leave'
  | 'offline';

export interface Availability {
  readonly memberId: AlaraId;
  readonly tenantId: string;
  readonly status: AvailabilityStatus;
  readonly currentLoad: number;   // active assignments
  readonly maxLoad: number;       // configured capacity
  readonly nextAvailableAt: string | null; // ISO datetime
  readonly unavailableUntil: string | null;
  readonly snapshotAt: string; // ISO datetime
}

// ─── CapacitySnapshot ─────────────────────────────────────────────────────────

export interface CapacitySnapshot {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly memberId: AlaraId;
  readonly currentLoad: number;
  readonly maxLoad: number;
  readonly utilizationRate: number; // 0.0–1.0
  readonly activeAssignmentIds: readonly string[];
  readonly snapshotAt: Date;
  readonly version: number;
}

// ─── EscalationPath ───────────────────────────────────────────────────────────

export interface EscalationPath {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly name: string;
  readonly levels: readonly EscalationLevel[];
  readonly version: number;
}

export interface EscalationLevel {
  readonly order: number;
  readonly targetRole: WorkforceRole;
  readonly targetMemberId: AlaraId | null; // null = any member with role
  readonly triggerCondition: EscalationTrigger;
  readonly timeoutMinutes: number;
}

export type EscalationTrigger =
  | 'no_assignment'         // no one available to accept
  | 'no_acceptance'         // assigned but not acknowledged
  | 'sla_breach'            // promise missed
  | 'critical_severity'     // pattern severity is critical
  | 'manual';               // explicitly triggered

// ─── Assignment ───────────────────────────────────────────────────────────────

export type AssignmentStatus =
  | 'recommended'   // generated, awaiting Rules approval
  | 'approved'      // Rules Engine approved, pending acceptance
  | 'accepted'      // workforce member accepted
  | 'declined'      // workforce member declined
  | 'transferred'   // reassigned to someone else
  | 'completed'     // work done
  | 'escalated';    // escalated per path

export type AssignmentPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Assignment {
  readonly id: AlaraId;
  readonly tenantId: string;
  /** What is being assigned — workflow, task, promise, patient, etc. */
  readonly subjectId: string;
  readonly subjectType: string;
  readonly assigneeId: AlaraId;
  readonly assigneeName: string;
  readonly priority: AssignmentPriority;
  readonly status: AssignmentStatus;
  readonly reason: string;
  /** Evidence supporting this assignment recommendation */
  readonly evidence: AssignmentEvidence;
  readonly confidence: AssignmentConfidence;
  /** If transferred, who transferred from */
  readonly transferredFromId: AlaraId | null;
  readonly rulesEngineApproved: boolean | null;
  readonly rulesEngineExplanation: string | null;
  readonly dueAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface AssignmentEvidence {
  readonly reasons: readonly string[];
  readonly skillMatchScore: number; // 0.0–1.0
  readonly availabilityScore: number;
  readonly continuityScore: number; // preferred if has prior relationship
  readonly loadScore: number; // inverse of current load
  readonly programMatchScore: number;
  readonly supportingMemberIds: readonly string[];
  readonly alternativeMemberIds: readonly string[];
}

export type AssignmentConfidence = 'high' | 'medium' | 'low';

// ─── AssignmentRecommendation ─────────────────────────────────────────────────

export interface AssignmentRecommendation {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly primaryRecommendation: CandidateScore;
  readonly alternativeRecommendations: readonly CandidateScore[];
  readonly reasoning: string;
  readonly confidence: AssignmentConfidence;
  readonly generatedAt: Date;
}

export interface CandidateScore {
  readonly memberId: AlaraId;
  readonly memberName: string;
  readonly totalScore: number; // 0.0–1.0 composite
  readonly skillScore: number;
  readonly availabilityScore: number;
  readonly continuityScore: number;
  readonly loadScore: number;
  readonly programScore: number;
  readonly disqualified: boolean;
  readonly disqualificationReason: string | null;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface RegisterWorkforceMemberCommand {
  readonly tenantId: string;
  readonly displayName: string;
  readonly role: WorkforceRole;
  readonly teamId: AlaraId | null;
  readonly supervisorId: AlaraId | null;
  readonly externalHrId: string | null;
  readonly skillProfile: SkillProfile;
  readonly coverageArea: CoverageArea;
  readonly escalationPathId: AlaraId | null;
  readonly actor: string;
}

export interface UpdateAvailabilityCommand {
  readonly tenantId: string;
  readonly memberId: AlaraId;
  readonly status: AvailabilityStatus;
  readonly unavailableUntil: string | null;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface RecommendAssignmentCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly requiredSkills: readonly string[];
  readonly requiredPrograms: readonly string[];
  readonly requiredRole: WorkforceRole | null;
  readonly priority: AssignmentPriority;
  readonly preferContinuity: boolean;
  readonly priorAssigneeId: AlaraId | null;
  readonly dueAt: Date | null;
  readonly actor: string;
}

export interface AcceptAssignmentCommand {
  readonly tenantId: string;
  readonly assignmentId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface DeclineAssignmentCommand {
  readonly tenantId: string;
  readonly assignmentId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface TransferAssignmentCommand {
  readonly tenantId: string;
  readonly assignmentId: AlaraId;
  readonly newAssigneeId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface CompleteAssignmentCommand {
  readonly tenantId: string;
  readonly assignmentId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface TriggerEscalationCommand {
  readonly tenantId: string;
  readonly assignmentId: AlaraId;
  readonly trigger: EscalationTrigger;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface WorkforceMemberRegisteredPayload {
  memberId: string;
  displayName: string;
  role: WorkforceRole;
  tenantId: string;
}

export interface AssignmentRecommendedPayload {
  assignmentId: string;
  subjectId: string;
  subjectType: string;
  recommendedMemberId: string;
  recommendedMemberName: string;
  confidence: AssignmentConfidence;
  priority: AssignmentPriority;
}

export interface AssignmentApprovedPayload {
  assignmentId: string;
  assigneeId: string;
  rulesEngineDecision: string;
}

export interface AssignmentAcceptedPayload {
  assignmentId: string;
  assigneeId: string;
  acceptedAt: string;
}

export interface AssignmentDeclinedPayload {
  assignmentId: string;
  assigneeId: string;
  reason: string;
}

export interface AssignmentTransferredPayload {
  assignmentId: string;
  fromMemberId: string;
  toMemberId: string;
  reason: string;
}

export interface AssignmentCompletedPayload {
  assignmentId: string;
  assigneeId: string;
  completedAt: string;
}

export interface CapacityChangedPayload {
  memberId: string;
  previousLoad: number;
  newLoad: number;
  utilizationRate: number;
}

export interface EscalationTriggeredPayload {
  assignmentId: string;
  trigger: EscalationTrigger;
  escalatedToRole: WorkforceRole;
  escalatedToMemberId: string | null;
}

export interface AvailabilityChangedPayload {
  memberId: string;
  previousStatus: AvailabilityStatus;
  newStatus: AvailabilityStatus;
  unavailableUntil: string | null;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class WorkforceMemberNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Workforce member ${id} not found`);
    this.name = 'WorkforceMemberNotFoundError';
  }
}

export class AssignmentNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Assignment ${id} not found`);
    this.name = 'AssignmentNotFoundError';
  }
}

export class StaleAssignmentError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale assignment ${id}: expected v${expected}, got v${actual}`);
    this.name = 'StaleAssignmentError';
  }
}

export class NoEligibleAssigneeError extends Error {
  constructor(subjectId: string, reason: string) {
    super(`No eligible assignee for ${subjectId}: ${reason}`);
    this.name = 'NoEligibleAssigneeError';
  }
}
