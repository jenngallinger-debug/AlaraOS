/**
 * Alara OS — Relationship Health Projection (ADR-016)
 *
 * Relationship Health is NOT canonical state.
 * It is a Computed Projection governed by ADR-016.
 * Discarding this projection loses no truth.
 * It rebuilds identically from canonical events.
 *
 * This is the M6 upgrade to the M3 stub RelationshipHealthProjection.
 * It now incorporates relationship-specific events from the
 * Relationship Engine (RelationshipCreated, EdgeCreated, EdgeRemoved,
 * RelationshipTerminated) in addition to the M3 events.
 */

import { DomainEvent } from '../../events/types';
import {
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
  RelationshipHealthValue,
} from '../types';

export interface RelationshipHealthInputV2 {
  readonly relationshipId: string;
  /** All events from the relationship's event stream */
  readonly relationshipEvents: readonly DomainEvent[];
  /** Promise/task/workflow events correlated to this relationship's subject */
  readonly operationalEvents: readonly DomainEvent[];
}

export const RelationshipHealthProjectionV2Definition: ProjectionDefinition<
  RelationshipHealthInputV2,
  RelationshipHealthValue
> = {
  type: 'RelationshipHealth',
  methodName: 'relationship-health-score-v2',
  methodVersion: '2.0.0',

  declareDependencies(relationshipId: string): readonly ProjectionDependency[] {
    return [
      {
        name: 'Relationship event stream',
        kind: 'event_stream',
        sourceId: relationshipId,
        eventTypeFilter: [
          'RelationshipCreated', 'EdgeCreated', 'EdgeRemoved',
          'RelationshipTerminated', 'RelationshipSuspended', 'RelationshipReactivated',
          'OwnershipTransferred',
        ],
      },
      {
        name: 'Operational outcomes',
        kind: 'event_stream',
        sourceId: `${relationshipId}::operational`,
        eventTypeFilter: ['PromiseKept', 'PromiseMissed', 'PromiseVoided', 'TaskCompleted', 'WorkflowCompleted', 'DataIntegrityFlagged'],
      },
    ];
  },

  build(input: RelationshipHealthInputV2): ProjectionBuildResult<RelationshipHealthValue> {
    let kept = 0, missed = 0, voided = 0, integrityFlags = 0;
    let tasksCompleted = 0, workflowsCompleted = 0;
    let participantChanges = 0;
    let terminationPenalty = 0;

    // Score relationship structure events
    for (const event of input.relationshipEvents) {
      switch (event.type) {
        case 'EdgeCreated':      participantChanges++; break;
        case 'EdgeRemoved':      participantChanges++; break;
        case 'RelationshipTerminated': terminationPenalty = 2; break;
        case 'RelationshipSuspended':  terminationPenalty = Math.max(terminationPenalty, 1); break;
      }
    }

    // Score operational outcomes
    for (const event of input.operationalEvents) {
      switch (event.type) {
        case 'PromiseKept':          kept++; break;
        case 'PromiseMissed':        missed++; break;
        case 'PromiseVoided':        voided++; break;
        case 'DataIntegrityFlagged': integrityFlags++; break;
        case 'TaskCompleted':        tasksCompleted++; break;
        case 'WorkflowCompleted':    workflowsCompleted++; break;
      }
    }

    const allEvents = [...input.relationshipEvents, ...input.operationalEvents];
    const total = kept + missed + voided + integrityFlags + tasksCompleted + workflowsCompleted;

    let healthScore: number;
    if (total === 0) {
      healthScore = participantChanges > 0 ? 0.6 : 0.5;
    } else {
      const positive = kept + tasksCompleted + workflowsCompleted;
      const negative = missed + integrityFlags * 2 + terminationPenalty;
      healthScore = Math.max(0, Math.min(1, (positive - negative) / Math.max(1, total)));
    }

    const healthLabel: RelationshipHealthValue['healthLabel'] =
      total === 0 ? 'unknown'
      : terminationPenalty >= 2 ? 'at_risk'
      : healthScore >= 0.7 ? 'healthy'
      : healthScore >= 0.4 ? 'moderate'
      : 'at_risk';

    return {
      value: {
        relationshipId: input.relationshipId,
        promisesKept: kept,
        promisesMissed: missed,
        promisesVoided: voided,
        dataIntegrityFlags: integrityFlags,
        tasksCompleted,
        workflowsCompleted,
        healthScore: Math.round(healthScore * 100) / 100,
        healthLabel,
      },
      confidence: allEvents.length >= 5 ? 'high' : allEvents.length >= 2 ? 'moderate' : 'low',
      inferenceBasis: 'inference',
      aiInvolved: false,
      sourceEventIds: allEvents.map(e => e.id),
      freshUntil: null,
    };
  },
};
