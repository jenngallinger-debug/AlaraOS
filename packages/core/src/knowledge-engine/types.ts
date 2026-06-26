/**
 * Alara OS — Knowledge Engine Types
 *
 * Constitutional alignment:
 *   "Every interaction should leave the organization slightly more capable
 *    than before." (Part XI — Learn behavior)
 *
 * The Knowledge Engine is the organizational memory layer.
 * It is NOT an AI system.
 * It is the structured accumulation of what the organization has
 * observed, inferred, confirmed, and learned — made queryable.
 *
 * Three core concepts:
 *
 * 1. Observation — a fact perceived from the environment (event-derived).
 *    Observations are append-only. They describe what was seen, not conclusions.
 *    Source: Automynd events, workflow outcomes, communication outcomes, etc.
 *
 * 2. KnowledgeEntry — a structured, versioned piece of organizational knowledge.
 *    Entries can be asserted, revised, and superseded.
 *    They carry provenance: what observations or entries support them.
 *    Examples: "Patient X is EEOICPA-eligible", "Dr. Jones typically refers weekly"
 *
 * 3. KnowledgeQuery — a typed question the organization can ask.
 *    Queries return the best available knowledge for a subject + topic.
 *    If no knowledge exists, the engine says so — it never fabricates.
 *
 * ADR-015 compliance: AI may READ knowledge. AI may not WRITE knowledge
 * directly. All writes go through Observations (facts) or KnowledgeEntries
 * (asserted by humans or confirmed inference chains — flagged explicitly).
 *
 * ADR-016 compliance: KnowledgeSummary projections are computed views,
 * never canonical state.
 */

import { AlaraId } from '../shared/types';

// ─── Observation types ────────────────────────────────────────────────────────

export type ObservationSource =
  | 'AutomyndEvent'       // observed from Automynd integration
  | 'WorkflowOutcome'     // observed from workflow completion
  | 'PromiseOutcome'      // observed from promise kept/missed/voided
  | 'TaskOutcome'         // observed from task completion
  | 'CommunicationEvent'  // observed from communication lifecycle
  | 'RelationshipEvent'   // observed from relationship changes
  | 'HumanAssertion'      // directly asserted by a human actor
  | 'InferenceChain';     // derived from other observations (must flag aiInvolved)

export type ObservationConfidence = 'confirmed' | 'probable' | 'possible' | 'speculative';

export interface Observation {
  readonly id: AlaraId;
  readonly tenantId: string;
  /** What subject this observation is about (Alara UUID) */
  readonly subjectId: string;
  readonly subjectType: string;
  /** Topic / predicate — what aspect of the subject was observed */
  readonly topic: ObservationTopic;
  /** Human-readable statement of what was observed */
  readonly statement: string;
  /** Structured facts (key-value, never clinical content) */
  readonly facts: Record<string, unknown>;
  readonly source: ObservationSource;
  readonly confidence: ObservationConfidence;
  /** Whether AI reasoning was involved in producing this observation */
  readonly aiInvolved: boolean;
  /** Source event IDs that produced this observation */
  readonly sourceEventIds: readonly string[];
  /** Source observation IDs (if InferenceChain) */
  readonly sourceObservationIds: readonly string[];
  readonly observedAt: Date;
  readonly actor: string;
  readonly version: number;
}

export type ObservationTopic =
  | 'eligibility'           // program eligibility signals
  | 'referral_pattern'      // referral source behavior
  | 'clinical_need'         // non-clinical clinical need signal (homebound status, etc.)
  | 'care_coordination'     // coordination quality signals
  | 'data_integrity'        // data quality / conflict signals
  | 'relationship_quality'  // relationship health signals
  | 'promise_reliability'   // promise-keeping reliability
  | 'communication_quality' // communication effectiveness
  | 'workflow_efficiency'   // workflow performance
  | 'organizational_risk'   // risk indicators
  | 'patient_context'       // non-clinical patient context
  | 'program_context';      // program / benefit context

// ─── Knowledge Entry ──────────────────────────────────────────────────────────

export type KnowledgeEntryStatus =
  | 'active'      // currently believed to be true
  | 'superseded'  // replaced by a newer entry
  | 'retracted';  // no longer believed (was wrong or circumstances changed)

export type KnowledgeEntryKind =
  | 'fact'        // confirmed, observable fact
  | 'inference'   // derived from observations, not directly confirmed
  | 'policy'      // organizational policy or rule
  | 'preference'  // observed preference or pattern
  | 'risk';       // identified risk signal

export interface KnowledgeEntry {
  readonly id: AlaraId;
  readonly tenantId: string;
  /** What subject this entry is about */
  readonly subjectId: string;
  readonly subjectType: string;
  readonly topic: ObservationTopic;
  readonly kind: KnowledgeEntryKind;
  readonly status: KnowledgeEntryStatus;
  /** Human-readable knowledge statement */
  readonly statement: string;
  /** Structured content (never clinical document payloads) */
  readonly content: Record<string, unknown>;
  readonly confidence: ObservationConfidence;
  readonly aiInvolved: boolean;
  /** Observation IDs that support this entry */
  readonly supportingObservationIds: readonly string[];
  /** If superseded, the entry that supersedes this one */
  readonly supersededById: AlaraId | null;
  readonly assertedAt: Date;
  readonly assertedBy: string;
  readonly expiresAt: Date | null;
  readonly version: number;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface RecordObservationCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly topic: ObservationTopic;
  readonly statement: string;
  readonly facts: Record<string, unknown>;
  readonly source: ObservationSource;
  readonly confidence: ObservationConfidence;
  readonly aiInvolved: boolean;
  readonly sourceEventIds: string[];
  readonly sourceObservationIds: string[];
  readonly actor: string;
}

export interface AssertKnowledgeCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly topic: ObservationTopic;
  readonly kind: KnowledgeEntryKind;
  readonly statement: string;
  readonly content: Record<string, unknown>;
  readonly confidence: ObservationConfidence;
  readonly aiInvolved: boolean;
  readonly supportingObservationIds: string[];
  readonly expiresAt: Date | null;
  readonly actor: string;
}

export interface SupersedeKnowledgeCommand {
  readonly tenantId: string;
  readonly entryId: AlaraId;
  readonly newStatement: string;
  readonly newContent: Record<string, unknown>;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface RetractKnowledgeCommand {
  readonly tenantId: string;
  readonly entryId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Knowledge Query ──────────────────────────────────────────────────────────

export interface KnowledgeQuery {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly topic?: ObservationTopic;
  readonly kind?: KnowledgeEntryKind;
  readonly status?: KnowledgeEntryStatus;
  readonly minConfidence?: ObservationConfidence;
  /** Only return entries that haven't expired */
  readonly activeOnly?: boolean;
}

export interface KnowledgeQueryResult {
  readonly subjectId: string;
  readonly entries: readonly KnowledgeEntry[];
  readonly observations: readonly Observation[];
  readonly totalEntries: number;
  readonly totalObservations: number;
  readonly queriedAt: string;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface ObservationRecordedPayload {
  observationId: string;
  subjectId: string;
  subjectType: string;
  topic: ObservationTopic;
  source: ObservationSource;
  confidence: ObservationConfidence;
  aiInvolved: boolean;
}

export interface KnowledgeAssertedPayload {
  entryId: string;
  subjectId: string;
  topic: ObservationTopic;
  kind: KnowledgeEntryKind;
  confidence: ObservationConfidence;
  aiInvolved: boolean;
}

export interface KnowledgeSupersededPayload {
  oldEntryId: string;
  newEntryId: string;
  reason: string;
}

export interface KnowledgeRetractedPayload {
  entryId: string;
  reason: string;
}

// ─── Confidence ordering (for filtering) ─────────────────────────────────────

export const CONFIDENCE_RANK: Record<ObservationConfidence, number> = {
  confirmed:   4,
  probable:    3,
  possible:    2,
  speculative: 1,
};

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StaleKnowledgeEntryError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale knowledge entry ${id}: expected v${expected}, got v${actual}`);
    this.name = 'StaleKnowledgeEntryError';
  }
}

export class KnowledgeEntryNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Knowledge entry ${id} not found`);
    this.name = 'KnowledgeEntryNotFoundError';
  }
}

export class ObservationNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Observation ${id} not found`);
    this.name = 'ObservationNotFoundError';
  }
}

export class ClinicalContentViolationError extends Error {
  constructor(field: string) {
    super(`ADR-001 violation: clinical content field "${field}" is not permitted in knowledge entries`);
    this.name = 'ClinicalContentViolationError';
  }
}
