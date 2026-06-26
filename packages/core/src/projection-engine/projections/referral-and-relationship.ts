/**
 * Alara OS — Referral Source Strength Projection
 *
 * Derived view of referral-source reliability and activity.
 * Inputs: referral events, workflow outcomes, promise outcomes, data integrity flags.
 * ADR-016: computed, non-authoritative, fully regenerable.
 */

import { DomainEvent } from '../../events/types';
import {
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
  ReferralSourceStrengthValue,
} from '../types';

export interface ReferralSourceStrengthInput {
  readonly referralSourceId: string;
  /** All events related to this referral source */
  readonly events: readonly DomainEvent[];
}

export const ReferralSourceStrengthProjectionDefinition: ProjectionDefinition<
  ReferralSourceStrengthInput,
  ReferralSourceStrengthValue
> = {
  type: 'ReferralSourceStrength',
  methodName: 'referral-source-strength-v1',
  methodVersion: '1.0.0',

  declareDependencies(referralSourceId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Referral events',       kind: 'event_stream', sourceId: referralSourceId, eventTypeFilter: ['AutomyndReferralObserved'] },
      { name: 'Workflow outcomes',     kind: 'event_stream', sourceId: referralSourceId, eventTypeFilter: ['WorkflowStarted', 'WorkflowCompleted', 'WorkflowSuppressed'] },
      { name: 'Promise outcomes',      kind: 'event_stream', sourceId: referralSourceId, eventTypeFilter: ['PromiseKept', 'PromiseMissed', 'PromiseVoided'] },
      { name: 'Task outcomes',         kind: 'event_stream', sourceId: referralSourceId, eventTypeFilter: ['TaskCompleted'] },
      { name: 'Data integrity flags',  kind: 'event_stream', sourceId: referralSourceId, eventTypeFilter: ['DataIntegrityFlagged'] },
    ];
  },

  build(input: ReferralSourceStrengthInput): ProjectionBuildResult<ReferralSourceStrengthValue> {
    const counts = {
      referrals: 0, completedWorkflows: 0, keptPromises: 0,
      missedPromises: 0, dataIntegrityFlags: 0,
    };

    for (const event of input.events) {
      switch (event.type) {
        case 'AutomyndReferralObserved': counts.referrals++; break;
        case 'WorkflowCompleted':        counts.completedWorkflows++; break;
        case 'PromiseKept':              counts.keptPromises++; break;
        case 'PromiseMissed':            counts.missedPromises++; break;
        case 'DataIntegrityFlagged':     counts.dataIntegrityFlags++; break;
      }
    }

    // Method: weighted score
    // +1 per referral, +2 per completed workflow, +1 per kept promise
    // -1 per missed promise, -2 per data integrity flag
    const raw = (
      counts.referrals +
      counts.completedWorkflows * 2 +
      counts.keptPromises -
      counts.missedPromises -
      counts.dataIntegrityFlags * 2
    );
    const max = Math.max(1, counts.referrals + counts.completedWorkflows * 2 + counts.keptPromises);
    const strengthScore = Math.max(0, Math.min(1, raw / max));

    const trend: ReferralSourceStrengthValue['trend'] =
      counts.referrals < 2 ? 'insufficient_data'
      : counts.dataIntegrityFlags > counts.referrals * 0.3 ? 'declining'
      : strengthScore > 0.7 ? 'improving'
      : 'stable';

    const value: ReferralSourceStrengthValue = {
      referralSourceId: input.referralSourceId,
      totalReferrals: counts.referrals,
      completedWorkflows: counts.completedWorkflows,
      keptPromises: counts.keptPromises,
      missedPromises: counts.missedPromises,
      dataIntegrityFlags: counts.dataIntegrityFlags,
      strengthScore: Math.round(strengthScore * 100) / 100,
      trend,
    };

    return {
      value,
      confidence: counts.referrals >= 3 ? 'high' : counts.referrals >= 1 ? 'moderate' : 'low',
      inferenceBasis: 'inference',
      aiInvolved: false,
      sourceEventIds: input.events.map(e => e.id),
      freshUntil: null,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Relationship Health Projection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alara OS — Relationship Health Projection v0
 *
 * Derived health score for a Relationship edge.
 * Caches onto Relationship later (post BD-015 ratification).
 * ADR-016: non-authoritative, fully regenerable.
 */

import {
  RelationshipHealthValue,
} from '../types';

export interface RelationshipHealthInput {
  readonly relationshipId: string;
  readonly events: readonly DomainEvent[];
}

export const RelationshipHealthProjectionDefinition: ProjectionDefinition<
  RelationshipHealthInput,
  RelationshipHealthValue
> = {
  type: 'RelationshipHealth',
  methodName: 'relationship-health-score-v1',
  methodVersion: '1.0.0',

  declareDependencies(relationshipId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Promise outcomes',     kind: 'event_stream', sourceId: relationshipId, eventTypeFilter: ['PromiseKept', 'PromiseMissed', 'PromiseVoided'] },
      { name: 'Task outcomes',        kind: 'event_stream', sourceId: relationshipId, eventTypeFilter: ['TaskCompleted'] },
      { name: 'Workflow outcomes',    kind: 'event_stream', sourceId: relationshipId, eventTypeFilter: ['WorkflowCompleted'] },
      { name: 'Data integrity flags', kind: 'event_stream', sourceId: relationshipId, eventTypeFilter: ['DataIntegrityFlagged'] },
    ];
  },

  build(input: RelationshipHealthInput): ProjectionBuildResult<RelationshipHealthValue> {
    let kept = 0, missed = 0, voided = 0, integrityFlags = 0, tasksCompleted = 0, workflowsCompleted = 0;

    for (const event of input.events) {
      switch (event.type) {
        case 'PromiseKept':         kept++; break;
        case 'PromiseMissed':       missed++; break;
        case 'PromiseVoided':       voided++; break;
        case 'DataIntegrityFlagged': integrityFlags++; break;
        case 'TaskCompleted':       tasksCompleted++; break;
        case 'WorkflowCompleted':   workflowsCompleted++; break;
      }
    }

    const total = kept + missed + voided + integrityFlags + tasksCompleted + workflowsCompleted;

    let healthScore: number;
    if (total === 0) {
      healthScore = 0.5; // neutral when no data
    } else {
      const positive = kept + tasksCompleted + workflowsCompleted;
      const negative = missed + integrityFlags * 2;
      healthScore = Math.max(0, Math.min(1, (positive - negative) / Math.max(1, total)));
    }

    const healthLabel: RelationshipHealthValue['healthLabel'] =
      total === 0 ? 'unknown'
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
      confidence: total >= 5 ? 'high' : total >= 2 ? 'moderate' : 'low',
      inferenceBasis: 'inference',
      aiInvolved: false,
      sourceEventIds: input.events.map(e => e.id),
      freshUntil: null,
    };
  },
};
