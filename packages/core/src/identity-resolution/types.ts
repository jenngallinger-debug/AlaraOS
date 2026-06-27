/**
 * Alara OS — Identity Resolution types (classification model)
 *
 * See docs/architecture/identity-resolution-spec.md §4 (matching model) and §4.1
 * (v1 external-reference-first scope). v1 is deterministic and rules-based — no ML,
 * no demographic auto-match.
 */

import { ExternalReferenceQuery } from './repository';

/** The four classification outcomes (spec §4). */
export type IdentityResolutionOutcome =
  | 'MATCH'
  | 'NO_MATCH'
  | 'POSSIBLE_MATCH_REVIEW_REQUIRED'
  | 'INSUFFICIENT_EVIDENCE';

/**
 * A person-bearing input under resolution (spec §3, narrowed to v1).
 * Demographics are collected as EVIDENCE; in v1 they never drive a positive match —
 * they only flag conflicts on an external-reference match.
 */
export interface IdentityCandidateInput {
  tenantId: string;
  /** 0..n exact external references — the only positive match signal in v1. */
  externalReferences?: ExternalReferenceQuery[];
  /** Demographic evidence (collected, not used for positive matching in v1). */
  name?: string;
  dob?: string;
}

/** A single piece of conflicting evidence found against a candidate (spec §5.1). */
export interface IdentityConflict {
  candidateId: string;
  field: string;
  inputValue: unknown;
  candidateValue: unknown;
  /** Machine-readable conflict kind (aligns with spec §5 / data-integrity vocabulary). */
  code: 'DOB_MISMATCH' | 'ID_COLLISION';
}

/** The result of classifying one input (spec §7 records this set). */
export interface IdentityResolutionResult {
  outcome: IdentityResolutionOutcome;
  /** Set only for MATCH — the canonical Patient id the input resolves to. */
  matchedPatientId?: string;
  /** All candidate Patient ids considered, in deterministic order. */
  candidateIds: string[];
  /** Machine-readable why-codes for the outcome. */
  reasonCodes: string[];
  /** Conflicting evidence driving a review outcome (empty otherwise). */
  conflicts: IdentityConflict[];
}
