/**
 * Alara OS — Policy Context Types
 *
 * These are the typed "facts" that the pipeline coordinator assembles
 * and passes into RuleContext.objects before calling the Rules Engine.
 *
 * Each policy module declares which facts it needs. If a required fact
 * is missing, the module returns DENY with a clear explanation.
 *
 * Constitutional alignment:
 *   BD-014  Consent     → ConsentFact
 *   ADR-014 Participation → ParticipationFact
 *   ADR-015 AI Act      → AIActionFact
 *   ADR-001 EMR Boundary → EMRBoundaryFact / DataIntegrityFact
 */

// ─── Consent (BD-014) ─────────────────────────────────────────────────────────

export type ConsentPermissionType =
  | 'read'
  | 'update'
  | 'disclose_external'   // sharing PHI outside Alara
  | 'ai_process'          // AI may reason over this subject's data
  | 'communicate'         // send communications on behalf of
  | 'enroll';             // enroll in a program / benefit

export type ConsentStatus = 'active' | 'revoked' | 'expired' | 'pending';

export interface ConsentFact {
  readonly consentId: string;
  readonly subjectId: string;          // Alara UUID of the Patient/subject
  readonly grantorId: string;          // who granted consent
  readonly recipientId: string;        // who may act — actor making the request
  readonly permissionTypes: readonly ConsentPermissionType[];
  readonly effectiveDate: string;      // ISO date
  readonly expirationDate?: string;    // ISO date; absent = no expiry
  readonly revokedAt?: string;         // ISO date; present = revoked
  readonly version: number;
  readonly status: ConsentStatus;
}

// ─── Participation (ADR-014) ──────────────────────────────────────────────────

export type ParticipationRole =
  | 'Actor'       // owns work, initiates actions
  | 'Stakeholder' // informed, may not act
  | 'Informed'    // receives output only
  | 'Owner'       // owns the object / workflow
  | 'Covering'    // covering for Owner; access may expire
  | 'None';       // no role — access denied

export interface ParticipationFact {
  readonly workforceMemberId: string;
  readonly objectId: string;           // Alara UUID of the object being accessed
  readonly role: ParticipationRole;
  /** For Covering role: when coverage expires. Absent = no expiry. */
  readonly coverageExpiresAt?: string; // ISO datetime
  /** The context (journey, workflow) in which this role is scoped */
  readonly contextId?: string;
}

// ─── AI Act constraints (ADR-015) ─────────────────────────────────────────────

export type AIActionClass =
  | 'draft'              // AI may draft content for human review
  | 'recommend'          // AI may surface a recommendation
  | 'summarize'          // AI may summarize existing data
  | 'classify'           // AI may classify an object
  | 'flag'               // AI may flag for attention
  | 'clinical_escalate'  // AI may NOT autonomously escalate clinical
  | 'external_disclose'  // AI may NOT autonomously disclose PHI externally
  | 'consent_change'     // AI may NOT change consent
  | 'order_interpret'    // AI may NOT interpret orders as actions
  | 'benefit_auth'       // AI may NOT authorize benefits
  | 'communicate_external'; // AI may NOT send external comms autonomously

export interface AIActionFact {
  /** The action class the AI agent is attempting */
  readonly actionClass: AIActionClass;
  /** Whether this is an autonomous attempt (vs. AI assisting human) */
  readonly isAutonomous: boolean;
  /** Confidence the AI reports for this action (0.0–1.0) */
  readonly confidence: number;
  /** Which AI agent is acting */
  readonly agentId: string;
}

// ─── EMR Boundary (ADR-001) ───────────────────────────────────────────────────

export interface EMRBoundaryFact {
  /** The external system being referenced (e.g. 'Automynd') */
  readonly externalSystem: string;
  /** The type of data being handled */
  readonly dataCategory:
    | 'patient_identity'
    | 'clinical_documentation'
    | 'visit_record'
    | 'order'
    | 'plan_of_care'
    | 'assessment'
    | 'operational_reference'; // safe: just a reference, not clinical content
  /** Whether this operation would write to the external system */
  readonly wouldWriteToExternalSystem: boolean;
  /** Whether this operation would duplicate clinical content into Alara */
  readonly wouldDuplicateClinicalContent: boolean;
}

// ─── Data Integrity (ADR-001 subset) ──────────────────────────────────────────

export interface DataIntegrityFact {
  readonly conflictType: 'DOB_MISMATCH' | 'ID_COLLISION' | 'STATUS_CONFLICT' | 'FIELD_DIVERGENCE';
  readonly externalSystem: string;
  readonly objectId: string;
  readonly field: string;
  readonly externalValue: unknown;
  readonly alaraValue: unknown;
}

// ─── Identity Resolution review (identity-resolution-spec §5.1) ────────────────
// A DISTINCT fact from DataIntegrityFact: identity conflicts are between candidate
// PERSONS (a candidate set + evidence), not a single object's external-vs-Alara
// field divergence. This shape is read by the IdentityReviewPolicyModule on the
// `ruleset.identity.review` rule set to decide ALLOW vs REQUIRE_HUMAN.

export interface IdentityConflictEvidence {
  readonly candidateId: string;
  readonly field: string;
  /** Machine-readable conflict kind (e.g. DOB_MISMATCH, ID_COLLISION). */
  readonly code: string;
}

export interface IdentityConflictFact {
  /** The engine's pre-review classification. */
  readonly proposedClassification:
    | 'MATCH'
    | 'NO_MATCH'
    | 'POSSIBLE_MATCH_REVIEW_REQUIRED'
    | 'INSUFFICIENT_EVIDENCE';
  /** The normalized candidate input under resolution. */
  readonly subjectInput: Record<string, unknown>;
  /** Candidate Person (Patient) ids considered. */
  readonly candidateIds: readonly string[];
  /** Specific conflicting evidence (empty when none). */
  readonly conflictingEvidence: readonly IdentityConflictEvidence[];
  /** Machine-readable why-codes carried from the matcher. */
  readonly reasonCodes: readonly string[];
  /** Confidence in the proposed classification (0..1). */
  readonly confidence: number;
  /** Indicator that the action would combine/expose protected health information. */
  readonly phiRisk: boolean;
}
