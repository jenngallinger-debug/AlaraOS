/**
 * Alara OS — Shared Domain Types
 *
 * These types are the canonical vocabulary for the platform.
 * Derived from:
 *   - Part XI Object Model (Object Doctrine)
 *   - BD-013 (Objecthood Principle)
 *   - ExternalReference Rule (Universal Object Rule)
 *   - ADR-001 (EMR Boundary)
 *
 * RULE: Identity is an Alara UUID. External IDs are reference attributes.
 * RULE: An object type is valid only if it passes the Objecthood Principle.
 */

// ─── Branded type for Alara object identity ──────────────────────────────────
// Prevents accidental use of external IDs as object identity.
declare const __AlaraId: unique symbol;
export type AlaraId = string & { readonly [__AlaraId]: 'AlaraId' };

export function makeAlaraId(raw: string): AlaraId {
  return raw as AlaraId;
}

// ─── Canonical primary object types (Part XI) ────────────────────────────────
// Only entities that pass BD-013 Objecthood: independent identity across time.
// Growth concepts (Community, Campaign, Moment, etc.) are NOT object types.
export const OBJECT_TYPES = [
  'Patient',
  'Relationship',
  'Event',
  'Observation',
  'Trigger',
  'Workflow',
  'Journey',
  'Goal',
  'Benefit',
  'CommunityResource',
  'Communication',
  'Promise',
  'Opportunity',
  'Stakeholder',
  'AIAgent',
  'KnowledgeObject',
  'Timeline',
  'Consent',          // BD-014 (staged, implementing post-ratification)
  'WorkforceMember',  // ADR-014 (staged, implementing post-ratification)
] as const;

export type ObjectType = typeof OBJECT_TYPES[number];

export function isValidObjectType(t: string): t is ObjectType {
  return (OBJECT_TYPES as readonly string[]).includes(t);
}

// ─── External reference (Universal Object Rule, Part XI + BD-013-B) ──────────
// External IDs are reference attributes, not identity.
// system: the external system name (e.g. 'Automynd', 'VA', 'OWCP')
// extType: the kind of ID in that system (e.g. 'patient_id', 'authorization_id')
// value:  the actual external identifier
export interface ExternalReference {
  readonly system: string;
  readonly extType: string;
  readonly value: string;
}

// ─── Versioned snapshot of an object's state ─────────────────────────────────
export interface AlaraObject {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly type: ObjectType;
  readonly state: string;                   // lifecycle state (created, active, archived…)
  readonly attributes: Record<string, unknown>;
  readonly version: number;                 // optimistic concurrency
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Lifecycle states shared across all objects ───────────────────────────────
export const OBJECT_STATES = [
  'created',
  'enriched',
  'active',
  'updated',
  'verified',
  'archived',
] as const;

export type ObjectState = typeof OBJECT_STATES[number];
