/**
 * Alara OS — Journey Engine Types (M10.5)
 *
 * ADR-015: Journey is a first-class coordinating Object.
 *
 * Journey OWNS:
 *   - organizational intent
 *   - lifecycle
 *   - coordination state
 *   - event stream
 *
 * Journey REFERENCES (never owns):
 *   Person · Episode · Relationship · WorkforceMember
 *   Promise · Task · Communication · KnowledgeEntry
 *   Observation · Reasoning
 *
 * Journey Invariant: Journey references other first-class Objects.
 *   Journey does not absorb their responsibilities.
 *   Journey must never become a God Object.
 *
 * OD-1: A Person exists independently of any identifier.
 *   Journey never creates Person objects. Identity is linked when
 *   it resolves, never fabricated.
 */

import { AlaraId } from '../shared/types';

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export type JourneyLifecycle =
  | 'arrival'
  | 'orientation'
  | 'working'
  | 'identity_resolution'
  | 'care_coordination'
  | 'completed'
  | 'dormant'
  | 'reactivated'
  | 'archived';

/** Legal lifecycle transitions (State-Transition Principle). */
export const LIFECYCLE_TRANSITIONS: ReadonlyMap<JourneyLifecycle, ReadonlySet<JourneyLifecycle>> =
  new Map([
    ['arrival',             new Set(['orientation', 'dormant'])],
    ['orientation',         new Set(['working', 'dormant'])],
    ['working',             new Set(['identity_resolution', 'care_coordination', 'completed', 'dormant'])],
    ['identity_resolution', new Set(['care_coordination', 'working', 'dormant'])],
    ['care_coordination',   new Set(['completed', 'dormant'])],
    ['completed',           new Set(['dormant'])],
    ['dormant',             new Set(['reactivated', 'archived'])],
    ['reactivated',         new Set(['working', 'care_coordination', 'dormant'])],
    ['archived',            new Set()],   // terminal
  ]);

export function canTransition(
  from: JourneyLifecycle,
  to: JourneyLifecycle,
): boolean {
  return LIFECYCLE_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ─── Reference kinds — exhaustive (Journey Invariant) ────────────────────────

export type JourneyReferenceKind =
  | 'person'
  | 'episode'
  | 'relationship'
  | 'workforce_member'
  | 'stakeholder'           // M11: Stakeholder is a first-class Object (Architect ratified)
  | 'promise'
  | 'task'
  | 'communication'
  | 'knowledge_entry'
  | 'observation'
  | 'reasoning';

/** The complete exhaustive set. Adding a value is an architectural decision. */
export const JOURNEY_REFERENCE_KINDS: readonly JourneyReferenceKind[] = [
  'person', 'episode', 'relationship', 'workforce_member', 'stakeholder',
  'promise', 'task', 'communication', 'knowledge_entry', 'observation', 'reasoning',
];

// ─── Event types ─────────────────────────────────────────────────────────────

export type JourneyEventType =
  | 'JourneyStarted'
  | 'JourneyOriented'
  | 'JourneyWorkStarted'
  | 'JourneyIntentInferred'
  | 'JourneyObstacleSurfaced'
  | 'JourneyQuestionAnswered'
  | 'JourneyIdentityResolved'
  | 'JourneyHandoffInitiated'
  | 'JourneyWentDormant'
  | 'JourneyReactivated'
  | 'JourneySuspended'
  | 'JourneyResumed'
  | 'JourneyCompleted'
  | 'JourneyArchived'
  | 'JourneyMerged'
  | 'JourneySplit'
  | 'PersonLinkedToJourney'
  | 'EpisodeLinkedToJourney'
  | 'WorkforceMemberLinkedToJourney';

// ─── Core domain types ───────────────────────────────────────────────────────

/** Journey Object. Owns only the four canonical properties (ADR-015). */
export interface Journey {
  readonly id: AlaraId;
  readonly tenantId: string;
  // OWNED: organizational intent
  readonly intent: string | null;
  readonly intentInferredAt: Date | null;
  // OWNED: lifecycle
  readonly lifecycle: JourneyLifecycle;
  readonly lifecycleChangedAt: Date;
  // OWNED: coordination state
  readonly coordinationState: JourneyCoordinationState;
  // OD-1: resolved by linking, never fabricated
  readonly identityResolved: boolean;
  // provenance (immutable-history invariant)
  readonly mergedFrom: readonly AlaraId[];
  readonly splitFrom: AlaraId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Coordination state — everything the organization is tracking about this
 * Journey that isn't owned by another Object.
 * Stored as JSON in the journeys table.
 */
export interface JourneyCoordinationState {
  readonly actor?: string;
  readonly obstacle?: string;
  readonly suspended?: boolean;
  readonly nextStep?: { label: string; owner: string; honestWindow?: string };
  readonly humanHandoff?: {
    name: string;
    role: string;
    contextTransferred: boolean;
    workforceMemberId?: string;
  };
  readonly [key: string]: unknown;
}

/** A reference edge from Journey to another first-class Object. */
export interface JourneyReference {
  readonly id: AlaraId;
  readonly journeyId: AlaraId;
  readonly tenantId: string;
  readonly kind: JourneyReferenceKind;
  readonly refId: AlaraId;
  readonly role: string | null;
  readonly linkedAt: Date;
  readonly linkedBy: AlaraId | null;
  readonly meta: Record<string, unknown>;
}

/** An event on the Journey's own event stream (UUIDv7 id per OD-S2-2). */
export interface JourneyEvent {
  readonly id: string;           // UUIDv7 (newEventId())
  readonly journeyId: AlaraId;
  readonly tenantId: string;
  readonly eventType: JourneyEventType;
  readonly payload: Record<string, unknown>;
  readonly refKind: JourneyReferenceKind | null;
  readonly refId: AlaraId | null;
  readonly occurredAt: Date;
  readonly causedBy: string | null;  // UUIDv7 of causal event
}

/** Canonical read model. ProjectionType 'journey_state' is distinct. */
export interface JourneyProjection {
  readonly PROJECTION_TYPE: 'journey_state';
  readonly journeyId: AlaraId;
  readonly tenantId: string;
  readonly lifecycle: JourneyLifecycle;
  readonly intent: string | null;
  readonly obstacle: string | null;
  readonly actor: string | null;
  readonly workSummary: readonly WorkItem[];
  readonly nextStep: NextStep | null;
  readonly humanHandoff: HumanHandoff | null;
  readonly lastEventId: string | null;
  readonly projectedAt: Date;
}

export interface WorkItem {
  readonly refId: AlaraId;
  readonly kind: string;
  readonly label: string;
  readonly status: 'preparing' | 'in_progress' | 'done' | 'waiting';
}

export interface NextStep {
  readonly label: string;
  readonly owner: string;
  readonly honestWindow?: string;
}

export interface HumanHandoff {
  readonly name: string;
  readonly role: string;
  readonly contextTransferred: boolean;
  readonly workforceMemberId?: AlaraId;
}

export interface CapabilityToken {
  readonly token: string;
  readonly journeyId: AlaraId;
  readonly tenantId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date | null;
  readonly revoked: boolean;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class JourneyNotFoundError extends Error {
  constructor(id: AlaraId) { super(`Journey not found: ${id}`); }
}

export class InvalidLifecycleTransitionError extends Error {
  constructor(from: JourneyLifecycle, to: JourneyLifecycle) {
    super(`Cannot transition from '${from}' to '${to}'`);
  }
}
