/**
 * Alara OS — Identity Resolution (barrel)
 *
 * See docs/architecture/identity-resolution-spec.md. Built in phases; v1 is
 * external-reference-first, Patient-only, read-only candidate lookup.
 */

export { IdentityResolutionRepository } from './repository';
export type { ExternalReferenceQuery } from './repository';
