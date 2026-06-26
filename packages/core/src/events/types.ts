/**
 * Alara OS — Event Types (M0 + M1a + M2)
 */
import { AlaraId, ObjectType } from '../shared/types';

export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly tenantId: string;
  readonly streamId: AlaraId;
  readonly seq: number;
  readonly type: EventType;
  readonly payload: TPayload;
  readonly actor: string;
  readonly occurredAt: Date;
  readonly causationId?: string;
  readonly correlationId?: string;
}

export const EVENT_TYPES = [
  // M0 — Object lifecycle
  'ObjectCreated', 'ObjectUpdated', 'ObjectStateTransitioned', 'ObjectArchived',
  // M0 — Relationship
  'EdgeCreated', 'EdgeRemoved',
  // M0 — ExternalReference
  'ExternalReferenceAdded', 'ExternalReferenceUpdated',
  // M0 — Data integrity
  'DataIntegrityFlagged', 'DataIntegrityResolved',
  // M1a — Automynd adapter
  'AutomyndPatientObserved', 'AutomyndReferralObserved', 'AutomyndVisitObserved', 'AutomyndOrderObserved',
  // M1a — Pipeline
  'TriggerFired', 'RuleEvaluated',
  // M7 — Knowledge Engine
  'ObservationRecorded',
  'KnowledgeAsserted', 'KnowledgeSuperseded', 'KnowledgeRetracted',
  // M6 — Relationship Engine
  'RelationshipCreated', 'RelationshipTerminated', 'RelationshipSuspended', 'RelationshipReactivated',
  'OwnershipTransferred',
  // M4 — Communication
  'CommunicationCreated', 'CommunicationQueued', 'CommunicationSent',
  'CommunicationDelivered', 'CommunicationFailed',
  // M3 — Projection
  'ProjectionRebuilt', 'ProjectionInvalidated', 'ProjectionFailed',
  // M2 — Workflow
  'WorkflowStarted', 'WorkflowStepActivated', 'WorkflowAdvanced',
  'WorkflowCompleted', 'WorkflowSuppressed', 'WorkflowFailed',
  'WorkflowStartRequested', 'TaskLinkedToStep', 'PromiseLinkedToStep',
  // M2 — Task
  'TaskCreated', 'TaskAssigned', 'TaskCompleted', 'TaskOverdue', 'TaskEscalated',
  // M2 — Promise
  'PromiseCreated', 'PromiseKept', 'PromiseMissed', 'PromiseVoided',
] as const;

export type EventType = typeof EVENT_TYPES[number];

export interface ObjectCreatedPayload { objectType: ObjectType; state: string; attributes: Record<string, unknown>; }
export interface ObjectUpdatedPayload { objectType: ObjectType; previousVersion: number; changes: Record<string, unknown>; newAttributes: Record<string, unknown>; }
export interface ObjectStateTransitionedPayload { objectType: ObjectType; fromState: string; toState: string; }
export interface ExternalReferenceAddedPayload { system: string; extType: string; value: string; }

export type ObjectCreatedEvent = DomainEvent<ObjectCreatedPayload>;
export type ObjectUpdatedEvent = DomainEvent<ObjectUpdatedPayload>;
export type ObjectStateTransitionedEvent = DomainEvent<ObjectStateTransitionedPayload>;
export type ExternalReferenceAddedEvent = DomainEvent<ExternalReferenceAddedPayload>;
