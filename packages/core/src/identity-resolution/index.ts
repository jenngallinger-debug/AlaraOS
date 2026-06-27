/**
 * Alara OS — Identity Resolution (barrel)
 *
 * See docs/architecture/identity-resolution-spec.md. Built in phases; v1 is
 * external-reference-first, Patient-only, read-only candidate lookup.
 */

export { IdentityResolutionRepository } from './repository';
export type { ExternalReferenceQuery } from './repository';
export { IdentityResolutionEngine } from './engine';
export type {
  IdentityResolutionOutcome,
  IdentityCandidateInput,
  IdentityResolutionResult,
  IdentityConflict,
} from './types';
export {
  IdentityReviewGate,
  buildIdentityConflictFact,
  createIdentityReviewRulesEngine,
  registerIdentityReviewPolicies,
} from './review-gate';
export type { IdentityReviewDecision, IdentityReviewOptions } from './review-gate';
