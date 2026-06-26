/**
 * Alara OS — Timeline Projection
 *
 * Chronological activity view for a patient / object.
 * Reads the event stream and produces an ordered sequence of entries.
 *
 * ADR-001 compliance: no clinical document content stored.
 *   Visit notes, POC content, assessment text → excluded.
 *   Event references only (eventId, type, actor, timestamp).
 */

import { DomainEvent } from '../../events/types';
import {
  ConfidenceLevel,
  InferenceBasis,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
  TimelineEntry,
  TimelineValue,
} from '../types';

// ─── Input type ────────────────────────────────────────────────────────────────

export interface TimelineInput {
  /** Subject Alara UUID */
  readonly subjectId: string;
  readonly subjectType: string;
  /** All events from the subject's event stream */
  readonly events: readonly DomainEvent[];
}

// ─── Summary generators ────────────────────────────────────────────────────────

function summarise(event: DomainEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'ObjectCreated':       return `${p.objectType ?? 'Object'} created`;
    case 'ObjectUpdated':       return `${p.objectType ?? 'Object'} updated`;
    case 'WorkflowStarted':     return `Workflow "${p.name ?? p.templateId}" started`;
    case 'WorkflowStepActivated': return `Workflow step "${p.stepName}" activated`;
    case 'WorkflowAdvanced':    return `Workflow advanced (step "${p.completedStepId}" completed)`;
    case 'WorkflowCompleted':   return `Workflow completed`;
    case 'WorkflowSuppressed':  return `Workflow suppressed: ${p.reason}`;
    case 'TaskCreated':         return `Task "${p.title ?? p.taskType}" created`;
    case 'TaskAssigned':        return `Task assigned to ${p.newOwnerId}`;
    case 'TaskCompleted':       return `Task completed`;
    case 'TaskEscalated':       return `Task escalated: ${p.reason}`;
    case 'PromiseCreated':      return `Promise created: ${p.description}`;
    case 'PromiseKept':         return `Promise kept: ${p.description}`;
    case 'PromiseMissed':       return `Promise missed: ${p.description}`;
    case 'PromiseVoided':       return `Promise voided (${p.reason}): ${p.description}`;
    case 'ExternalReferenceAdded': return `External reference added (${p.system}/${p.extType})`;
    case 'DataIntegrityFlagged': return `Data integrity conflict flagged`;
    case 'DataIntegrityResolved': return `Data integrity conflict resolved`;
    case 'AutomyndReferralObserved': return `Referral observed from Automynd`;
    case 'AutomyndVisitObserved':   return `Visit observed from Automynd`;
    default: return event.type;
  }
}

// Clinical event types — excluded per ADR-001
const EXCLUDED_TYPES = new Set([
  'ClinicalNoteCreated', 'ClinicalDocumentUpdated', 'AssessmentCompleted',
  'PlanOfCareCreated', 'OrderCreated',
]);

// ─── Projection Definition ─────────────────────────────────────────────────────

export const TimelineProjectionDefinition: ProjectionDefinition<TimelineInput, TimelineValue> = {
  type: 'Timeline',
  methodName: 'timeline-event-fold',
  methodVersion: '1.0.0',

  declareDependencies(subjectId: string): readonly ProjectionDependency[] {
    return [
      {
        name: 'Subject event stream',
        kind: 'event_stream',
        sourceId: subjectId,
        eventTypeFilter: undefined, // all events except EXCLUDED_TYPES
      },
    ];
  },

  build(input: TimelineInput): ProjectionBuildResult<TimelineValue> {
    const eligible = input.events.filter(e => !EXCLUDED_TYPES.has(e.type));

    const entries: TimelineEntry[] = eligible.map(event => ({
      eventId: event.id,
      eventType: event.type,
      occurredAt: event.occurredAt.toISOString(),
      actor: event.actor,
      summary: summarise(event),
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      // References only — never clinical content (ADR-001)
      references: {
        streamId: String(event.streamId),
        seq: String(event.seq),
      },
    }));

    // Sort chronologically
    entries.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const value: TimelineValue = {
      entries,
      eventCount: entries.length,
      firstEventAt: entries[0]?.occurredAt ?? null,
      lastEventAt: entries[entries.length - 1]?.occurredAt ?? null,
    };

    return {
      value,
      confidence: 'high',
      inferenceBasis: 'fact',
      aiInvolved: false,
      sourceEventIds: eligible.map(e => e.id),
      freshUntil: null, // always rebuild from latest events
    };
  },
};
