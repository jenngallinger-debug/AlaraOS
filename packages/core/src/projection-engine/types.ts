/**
 * Alara OS — Projection Engine Types
 *
 * Implements ADR-016: Computed Projection Architecture.
 *
 * "A Computed Projection is a derived, recalculable, non-authoritative
 *  representation produced from canonical objects, events, relationships,
 *  observations, references, knowledge, and governing rules through a
 *  declared method. It may be cached or materialized, but it owns no source
 *  data, carries no independent identity, and must be fully regenerable
 *  from canonical inputs. When inputs change, it recalculates.
 *  Discarding a projection loses no truth."
 *
 * INVARIANTS (all enforced at the type and engine level):
 *   1. Every projection declares its canonical inputs.
 *   2. Every projection declares its method + version.
 *   3. Every projection declares its recalc trigger.
 *   4. Every projection declares confidence + inference/fact status.
 *   5. Every projection flags whether AI is involved.
 *   6. Projections cannot mutate canonical objects.
 *   7. Projections cannot emit workflow/task/communication commands.
 *   8. Projections are fully rebuildable from declared canonical inputs.
 */

import { AlaraId } from '../shared/types';

// ─── Projection metadata (ADR-016 required fields) ────────────────────────────

export type ProjectionType =
  // M3 — original four types
  | 'Timeline'
  | 'DigitalCareTwin'
  | 'ReferralSourceStrength'
  | 'RelationshipHealth'
  // M7 — Knowledge Engine
  | 'KnowledgeSummary'
  // M8 — Organizational Brain
  | 'OrganizationalHealth'
  // M9 — Reasoning Engine
  | 'ReasoningSummary';

export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'unknown';

export type InferenceBasis = 'fact' | 'inference' | 'estimate' | 'ai_generated';

/** Allowed output event types from the Projection Engine (ADR-016 constraint) */
export type ProjectionEventType =
  | 'ProjectionRebuilt'
  | 'ProjectionInvalidated'
  | 'ProjectionFailed';

/**
 * ADR-016 dependency declaration — mandatory on every projection.
 * Enables recalculation, traceability, and "discarding loses no truth."
 */
export interface ProjectionDependency {
  /** Human-readable name of this canonical input */
  readonly name: string;
  /** What type of input it is */
  readonly kind: 'object' | 'event_stream' | 'edge' | 'external_reference' | 'projection';
  /** Alara UUID of the specific object/stream, or '*' for all events of a type */
  readonly sourceId: string;
  /** Optional: filter to specific event types from this source */
  readonly eventTypeFilter?: readonly string[];
}

/** ADR-016 mandatory metadata for every stored projection */
export interface ProjectionMetadata {
  /** Identifier for the specific projection definition */
  readonly projectionType: ProjectionType;
  /** Human-readable key identifying WHAT this projection is about */
  readonly subjectId: string;
  readonly tenantId: string;
  /** Declared canonical inputs — the full dependency graph */
  readonly canonicalInputs: readonly ProjectionDependency[];
  /** Declared computation method name */
  readonly methodName: string;
  /** Semantic version of the method — bump when logic changes */
  readonly methodVersion: string;
  /** ISO datetime: when to force a recalculation */
  readonly freshUntil: string | null;
  /** Events that triggered the most recent build */
  readonly sourceEventIds: readonly string[];
  /** Confidence in this projection's output */
  readonly confidence: ConfidenceLevel;
  /** Whether the values are facts, inferences, or estimates */
  readonly inferenceBasis: InferenceBasis;
  /** Whether AI reasoning contributed to this projection */
  readonly aiInvolved: boolean;
  /** ISO datetime of most recent successful build */
  readonly lastBuiltAt: string;
  /** Build number — increments on every rebuild */
  readonly buildNumber: number;
}

// ─── Stored projection (metadata + value) ─────────────────────────────────────

export interface StoredProjection<TValue = Record<string, unknown>> {
  readonly id: AlaraId;
  readonly metadata: ProjectionMetadata;
  /** The computed value — DISPOSABLE. Discarding this loses no truth. */
  readonly value: TValue;
}

// ─── Projection definition interface ─────────────────────────────────────────

/**
 * Every projection implementation must implement this interface.
 * The engine calls build() and the result is stored with metadata.
 *
 * CONSTRAINT: build() must not:
 *   - Write to the objects, events, workflows, tasks, or promises tables.
 *   - Emit workflow / task / communication commands.
 *   - Perform I/O beyond reading canonical inputs (pure function over data).
 */
export interface ProjectionDefinition<
  TInput = Record<string, unknown>,
  TValue = Record<string, unknown>
> {
  readonly type: ProjectionType;
  readonly methodName: string;
  readonly methodVersion: string;

  /**
   * Declare which canonical inputs this projection depends on.
   * Called before build() so the engine can validate completeness.
   */
  declareDependencies(subjectId: string): readonly ProjectionDependency[];

  /**
   * Build the projection value from canonical inputs.
   * Pure function — same inputs always produce same output.
   * No side effects.
   */
  build(input: TInput): ProjectionBuildResult<TValue>;
}

export interface ProjectionBuildResult<TValue = Record<string, unknown>> {
  readonly value: TValue;
  readonly confidence: ConfidenceLevel;
  readonly inferenceBasis: InferenceBasis;
  readonly aiInvolved: boolean;
  /** Source event IDs that contributed to this build */
  readonly sourceEventIds: readonly string[];
  /** ISO datetime until this is considered fresh (null = always stale) */
  readonly freshUntil: string | null;
}

// ─── Projection events (ADR-016: only these event types may be emitted) ───────

export interface ProjectionRebuiltPayload {
  readonly projectionType: ProjectionType;
  readonly subjectId: string;
  readonly methodVersion: string;
  readonly buildNumber: number;
  readonly confidence: ConfidenceLevel;
  readonly sourceEventCount: number;
}

export interface ProjectionInvalidatedPayload {
  readonly projectionType: ProjectionType;
  readonly subjectId: string;
  readonly reason: string;
}

export interface ProjectionFailedPayload {
  readonly projectionType: ProjectionType;
  readonly subjectId: string;
  readonly error: string;
}

// ─── Projection store interface ────────────────────────────────────────────────

export interface IProjectionStore {
  save(projection: StoredProjection): Promise<void>;
  get(tenantId: string, type: ProjectionType, subjectId: string): Promise<StoredProjection | null>;
  delete(tenantId: string, type: ProjectionType, subjectId: string): Promise<void>;
  listForSubject(tenantId: string, subjectId: string): Promise<StoredProjection[]>;
}

// ─── Well-known projection value types ────────────────────────────────────────

/** Timeline entry — a single chronological event in the timeline */
export interface TimelineEntry {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;      // ISO datetime
  readonly actor: string;
  readonly summary: string;
  /** Object / entity this event pertains to */
  readonly subjectType: string;
  readonly subjectId: string;
  /** Reference IDs — never clinical content */
  readonly references: Record<string, string>;
}

/** Timeline Projection value */
export interface TimelineValue {
  readonly entries: readonly TimelineEntry[];
  readonly eventCount: number;
  readonly firstEventAt: string | null;
  readonly lastEventAt: string | null;
}

/** Digital Care Twin value (v0) — non-authoritative composite */
export interface DigitalCareTwinValue {
  /** Alara UUID of the Patient */
  readonly patientId: string;
  /** Snapshot of patient object attributes (never clinical docs) */
  readonly patientAttributes: Record<string, unknown>;
  /** ExternalReferences (system + extType + value) */
  readonly externalReferences: readonly { system: string; extType: string; value: string }[];
  /** Active workflow summaries */
  readonly activeWorkflows: readonly { workflowId: string; templateId: string; status: string; currentStepId: string | null }[];
  /** Open tasks */
  readonly openTasks: readonly { taskId: string; taskType: string; ownerId: string; dueAt: string | null }[];
  /** Open promises */
  readonly openPromises: readonly { promiseId: string; description: string; dueAt: string }[];
  /** Summary from Timeline projection */
  readonly timelineSummary: { eventCount: number; lastEventAt: string | null };
  /** ADR-001: not a clinical record, not source of truth, not a shadow chart */
  readonly disclaimer: 'computed-projection-advisory-only';
}

/** Referral Source Strength value */
export interface ReferralSourceStrengthValue {
  readonly referralSourceId: string;
  readonly totalReferrals: number;
  readonly completedWorkflows: number;
  readonly keptPromises: number;
  readonly missedPromises: number;
  readonly dataIntegrityFlags: number;
  /** Derived score 0.0–1.0 */
  readonly strengthScore: number;
  readonly trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
}

/** Relationship Health value */
export interface RelationshipHealthValue {
  readonly relationshipId: string;
  readonly promisesKept: number;
  readonly promisesMissed: number;
  readonly promisesVoided: number;
  readonly dataIntegrityFlags: number;
  readonly tasksCompleted: number;
  readonly workflowsCompleted: number;
  /** Derived 0.0–1.0 */
  readonly healthScore: number;
  readonly healthLabel: 'healthy' | 'moderate' | 'at_risk' | 'unknown';
}
