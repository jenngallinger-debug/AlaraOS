/**
 * Alara OS — Stakeholder Engine Types (M11)
 *
 * Constitutional alignment:
 *   "Technology exists to carry organizational burden so people can carry
 *    human responsibility." (Part XI — Platform Design Philosophy)
 *
 * Stakeholder is a first-class Object (BD-013 ratified, Architect seat).
 *
 * Stakeholder OWNS:
 *   - Stakeholder type / classification
 *   - Display identity and contact identity needed for coordination
 *   - Durable consent state (ConsentPolicyModule reads this as ConsentFact)
 *   - Consent scope / category permissions
 *   - Communication preferences
 *   - Promise profile (standing relational contract — distinct from Promise Engine)
 *   - Active / inactive status
 *   - Stakeholder lifecycle events
 *
 * Stakeholder REFERENCES (never owns):
 *   Patient / Person · Organization · WorkforceMember
 *   Journey · Referral · Communication logs · Tasks
 *
 * Internal vs external:
 *   is_internal is owned classification on Stakeholder.
 *   Internal stakeholders (care_guide, auth_specialist, don) receive tasks.
 *   External stakeholders (physician, family, attorney, …) receive communications.
 *   Classification does NOT by itself grant permissions — authorization
 *   still comes from role / policy via the Rules Engine.
 *
 * Consent convergence (Architect ratified):
 *   Stakeholder owns the durable consent record.
 *   ConsentPolicyModule reads Stakeholder consent and transforms it into
 *   ConsentFact for rules evaluation. This is the canonical consent source.
 *
 * Promise profile:
 *   Owned configuration on Stakeholder. Represents the standing relational
 *   contract (job-to-be-done, responsibility transferred, success definition,
 *   anxiety risk, communication promise, update triggers).
 *   Distinct from Promise Engine's individual commitments.
 *
 * M11 does NOT include: communication dispatch rules, message templates,
 *   real transport, or M12 work.
 */

import { AlaraId } from '../shared/types';

// ─── Stakeholder type ─────────────────────────────────────────────────────────

export type StakeholderType =
  // External — receive communications
  | 'patient'
  | 'family'
  | 'physician'
  | 'case_manager'
  | 'discharge_planner'
  | 'dol_resource_center'
  | 'attorney'
  | 'authorized_rep'
  | 'owcp_nurse_cm'
  | 'employer_feca'
  // Internal — receive tasks (care team roles)
  | 'care_guide'
  | 'auth_specialist'
  | 'don';

export const INTERNAL_STAKEHOLDER_TYPES: readonly StakeholderType[] = [
  'care_guide', 'auth_specialist', 'don',
];

export const EXTERNAL_STAKEHOLDER_TYPES: readonly StakeholderType[] = [
  'patient', 'family', 'physician', 'case_manager', 'discharge_planner',
  'dol_resource_center', 'attorney', 'authorized_rep', 'owcp_nurse_cm', 'employer_feca',
];

export function isInternalStakeholder(type: StakeholderType): boolean {
  return (INTERNAL_STAKEHOLDER_TYPES as readonly string[]).includes(type);
}

// ─── Consent state ────────────────────────────────────────────────────────────

export type StakeholderConsentStatus = 'unknown' | 'granted' | 'restricted' | 'revoked';

/**
 * Durable consent state owned by Stakeholder.
 * ConsentPolicyModule reads this to produce a ConsentFact for rules evaluation.
 * scope encodes category-level permissions for restricted consent:
 *   'all' or 'full' → unrestricted within consent
 *   'status'        → status updates only
 *   'benefits'      → benefits updates only
 *   'scheduling'    → scheduling updates only
 *   'clinical'      → clinical updates (restricted use)
 */
export interface StakeholderConsent {
  readonly status: StakeholderConsentStatus;
  readonly scope: string;           // free-text category permissions (see above)
  readonly grantedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly grantedBy: string | null;  // actor who recorded consent
}

// ─── Communication preferences ────────────────────────────────────────────────

export type CommunicationChannel =
  | 'email' | 'sms' | 'phone' | 'fax' | 'portal' | 'inapp' | 'none';

export type CommunicationCadence =
  | 'realtime' | 'daily_digest' | 'weekly' | 'on_milestone' | 'none';

export type CommunicationCategory =
  | 'all' | 'clinical' | 'benefits' | 'status' | 'scheduling';

export interface CommunicationPreference {
  readonly category: CommunicationCategory;
  readonly channel: CommunicationChannel;
  readonly cadence: CommunicationCadence;
  readonly optIn: boolean;
}

// ─── Promise profile ──────────────────────────────────────────────────────────

/**
 * The standing relational promise between Alara and this stakeholder type.
 * Owned state on Stakeholder. NOT an individual Promise Engine commitment.
 * Describes the organizational contract: what we take on, what they can
 * expect, what would trigger a communication.
 */
export interface StakeholderPromiseProfile {
  readonly jobToBeDone: string | null;
  readonly responsibilityTransferred: string | null;
  readonly successDefinition: string | null;
  readonly anxietyRisk: string | null;
  readonly communicationPromise: string | null;
  readonly updateTriggers: readonly string[];
}

// ─── Stakeholder Object ───────────────────────────────────────────────────────

/**
 * The Stakeholder Object.
 *
 * Owns exactly what the Architect ratified. All cross-object associations
 * live in StakeholderReference (patient, journey, workforce member, etc.).
 */
export interface Stakeholder {
  readonly id: AlaraId;
  readonly tenantId: string;

  // OWNED: type / classification
  readonly type: StakeholderType;
  readonly isInternal: boolean;         // derived from type; stored for query efficiency

  // OWNED: display identity + contact identity for coordination
  readonly displayName: string | null;
  readonly organizationName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly fax: string | null;

  // OWNED: durable consent state
  readonly consent: StakeholderConsent;

  // OWNED: communication preferences (one per category; 'all' is the default)
  readonly preferences: readonly CommunicationPreference[];

  // OWNED: promise profile (standing relational contract)
  readonly promiseProfile: StakeholderPromiseProfile;

  // OWNED: active / inactive status
  readonly active: boolean;

  // Reference to a WorkforceMember when this is an internal stakeholder
  // Stored as a reference attribute, not owned identity.
  readonly workforceMemberRef: AlaraId | null;

  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface CreateStakeholderCommand {
  readonly tenantId: string;
  readonly patientId: AlaraId;          // reference — Stakeholder does not own Patient
  readonly type: StakeholderType;
  readonly displayName?: string;
  readonly organizationName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly fax?: string;
  readonly preferredChannel?: CommunicationChannel;
  readonly preferredCadence?: CommunicationCadence;
  readonly consentStatus?: StakeholderConsentStatus;
  readonly consentScope?: string;
  readonly workforceMemberRef?: AlaraId;
  readonly actor: string;
}

export interface UpdateConsentCommand {
  readonly tenantId: string;
  readonly stakeholderId: AlaraId;
  readonly status: StakeholderConsentStatus;
  readonly scope?: string;
  readonly expiresAt?: Date;
  readonly actor: string;
}

export interface UpdatePreferencesCommand {
  readonly tenantId: string;
  readonly stakeholderId: AlaraId;
  readonly preferences: readonly CommunicationPreference[];
  readonly actor: string;
}

export interface DeactivateStakeholderCommand {
  readonly tenantId: string;
  readonly stakeholderId: AlaraId;
  readonly actor: string;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface CreateStakeholderResult {
  readonly stakeholder: Stakeholder;
  readonly patientId: AlaraId;
}

// ─── Consent fact projection ──────────────────────────────────────────────────

/**
 * Transform a Stakeholder's durable consent into a ConsentFact for the
 * Rules Engine's ConsentPolicyModule.
 *
 * This is the convergence point ratified by the Architect: Stakeholder
 * owns durable consent; ConsentPolicyModule reads this projection.
 */
export interface StakeholderConsentFact {
  readonly stakeholderId: string;
  readonly patientId: string;
  readonly consentStatus: StakeholderConsentStatus;
  readonly consentScope: string;
  readonly grantedAt: string | null;    // ISO datetime
  readonly revokedAt: string | null;    // ISO datetime
  readonly expiresAt: string | null;    // ISO datetime
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StakeholderNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Stakeholder not found: ${id}`);
    this.name = 'StakeholderNotFoundError';
  }
}

export class InvalidStakeholderTypeError extends Error {
  constructor(type: string) {
    super(`Invalid stakeholder type: '${type}'`);
    this.name = 'InvalidStakeholderTypeError';
  }
}

export class ConsentViolationError extends Error {
  constructor(reason: string) {
    super(`Consent violation: ${reason}`);
    this.name = 'ConsentViolationError';
  }
}
