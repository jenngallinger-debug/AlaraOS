/**
 * Alara OS — Relationship Engine Types
 *
 * Constitutional alignment:
 *   ADR-014: "Identity is stable. Participation changes."
 *            Actor is a relationship-scoped participation role, not identity.
 *   Part XI Object Doctrine (BD-013): Care Team is a VIEW over active edges,
 *            not an object. Relationship is an object with independent identity.
 *   Identity Stability Principle: WorkforceMember identity is stable;
 *            their participation roles change per relationship context.
 *
 * KEY DESIGN DECISIONS:
 *   1. Relationship IS an object in the Unified Object Graph (has Alara UUID,
 *      version, state, event stream).
 *   2. Edges (participation edges) are the canonical fact linking two objects.
 *      They live in the `edges` table, not embedded in the Relationship object.
 *   3. Care Team is a COMPUTED VIEW — rebuilt entirely from active edges.
 *      It is never stored as canonical state.
 *   4. Relationship Health is a COMPUTED PROJECTION (ADR-016).
 *      It is never canonical state.
 *   5. Coverage relationships have expiry — the engine enforces this at
 *      edge creation time and the event stream records it.
 */

import { AlaraId } from '../shared/types';

// ─── Relationship types ───────────────────────────────────────────────────────

export type RelationshipType =
  | 'CareTeam'           // clinical/operational care team membership
  | 'ReferralSource'     // referral source → patient
  | 'FamilyMember'       // family/caregiver relationship
  | 'Physician'          // ordering/attending physician
  | 'CoverageRelationship' // coverage delegation between workforce members
  | 'PatientCareGuide'   // direct care guide assignment
  | 'ProgramEnrollment'; // patient enrolled in a program/benefit

export type RelationshipStatus =
  | 'active'
  | 'suspended'
  | 'terminated'
  | 'pending';

// ─── Relationship aggregate ───────────────────────────────────────────────────

export interface Relationship {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly type: RelationshipType;
  readonly status: RelationshipStatus;
  /** Subject of the relationship — typically a Patient Alara UUID */
  readonly subjectId: AlaraId;
  /** Description of this relationship */
  readonly description: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly terminatedAt: Date | null;
  readonly terminationReason: string | null;
}

// ─── Participation edge (ADR-014) ─────────────────────────────────────────────
//
// An edge connects a Participant (WorkforceMember, ExternalOrg, etc.)
// to a Relationship with a specific ParticipationRole.
// "Identity is stable. Participation changes."

export type ParticipationRole =
  | 'Actor'       // owns work, initiates actions in this relationship context
  | 'Owner'       // owns the relationship/workflow
  | 'Covering'    // covering for Owner; access expires at coverageExpiresAt
  | 'Stakeholder' // informed; may read but not act
  | 'Informed'    // receives output only
  | 'Observer';   // audit/oversight access

export interface ParticipationEdge {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly participantId: string;     // Alara UUID of WorkforceMember or ExternalOrg
  readonly participantType: 'WorkforceMember' | 'ExternalOrg' | 'Patient';
  readonly role: ParticipationRole;
  readonly active: boolean;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  /** For Covering role: when coverage expires (null = no expiry) */
  readonly coverageExpiresAt: Date | null;
  readonly version: number;
}

// ─── Care Team view (NOT canonical state — computed from active edges) ─────────

export interface CareTeamMember {
  readonly participantId: string;
  readonly participantType: ParticipationEdge['participantType'];
  readonly role: ParticipationRole;
  readonly relationshipId: AlaraId;
  readonly relationshipType: RelationshipType;
  readonly startedAt: Date;
  readonly coverageExpiresAt: Date | null;
}

export interface CareTeamView {
  /** Patient Alara UUID this Care Team serves */
  readonly subjectId: AlaraId;
  readonly tenantId: string;
  /** All active participants across all active relationships for this patient */
  readonly members: readonly CareTeamMember[];
  /** ISO datetime this view was computed */
  readonly computedAt: string;
  /** Source edge IDs used to compute this view */
  readonly sourceEdgeIds: readonly string[];
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface CreateRelationshipCommand {
  readonly tenantId: string;
  readonly type: RelationshipType;
  readonly subjectId: AlaraId;
  readonly description: string;
  readonly actor: string;
}

export interface AddParticipantCommand {
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly participantId: string;
  readonly participantType: ParticipationEdge['participantType'];
  readonly role: ParticipationRole;
  /** Required for Covering role */
  readonly coverageExpiresAt?: Date;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface RemoveParticipantCommand {
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly edgeId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface TransferOwnershipCommand {
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface TerminateRelationshipCommand {
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface SuspendRelationshipCommand {
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface ReactivateRelationshipCommand {
  readonly tenantId: string;
  readonly relationshipId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface RelationshipCreatedPayload {
  relationshipId: string;
  type: RelationshipType;
  subjectId: string;
  description: string;
}

export interface ParticipantAddedPayload {
  relationshipId: string;
  edgeId: string;
  participantId: string;
  participantType: string;
  role: ParticipationRole;
  coverageExpiresAt: string | null;
}

export interface ParticipantRemovedPayload {
  relationshipId: string;
  edgeId: string;
  participantId: string;
  role: ParticipationRole;
  reason: string;
}

export interface OwnershipTransferredPayload {
  relationshipId: string;
  fromParticipantId: string;
  toParticipantId: string;
}

export interface RelationshipTerminatedPayload {
  relationshipId: string;
  reason: string;
  previousVersion: number;
}

export interface RelationshipSuspendedPayload {
  relationshipId: string;
  reason: string;
  previousVersion: number;
}

export interface RelationshipReactivatedPayload {
  relationshipId: string;
  previousVersion: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StaleRelationshipError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale relationship version for ${id}: expected ${expected}, got ${actual}`);
    this.name = 'StaleRelationshipError';
  }
}

export class InvalidParticipationRoleError extends Error {
  constructor(role: string, reason: string) {
    super(`Invalid participation role "${role}": ${reason}`);
    this.name = 'InvalidParticipationRoleError';
  }
}

export class CoverageExpiredError extends Error {
  constructor(participantId: string, expiredAt: string) {
    super(`Coverage for participant "${participantId}" expired at ${expiredAt}`);
    this.name = 'CoverageExpiredError';
  }
}

export class RelationshipNotActiveError extends Error {
  constructor(id: AlaraId, status: string) {
    super(`Relationship ${id} is not active (status: ${status})`);
    this.name = 'RelationshipNotActiveError';
  }
}
