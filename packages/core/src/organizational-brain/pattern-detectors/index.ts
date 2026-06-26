/**
 * Alara OS — Pattern Detectors
 *
 * Six families of deterministic pattern detectors.
 * NO AI. NO ML. NO probabilistic reasoning.
 * Pure event stream analysis, counting, and threshold comparison.
 *
 * Each detector:
 *   - reads events and active patterns
 *   - emits new patterns OR resolves existing ones
 *   - never mutates state
 *   - is fully deterministic (same input → same output)
 */

import { DomainEvent } from '../../events/types';
import {
  DetectedPattern,
  DetectorInput,
  DetectorResult,
  PatternDetector,
} from '../types';

// ─── Helper: count events by type ─────────────────────────────────────────────

function countByType(events: readonly DomainEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  return counts;
}

function eventIds(events: readonly DomainEvent[]): string[] {
  return events.map(e => e.id);
}

function patternBase(input: DetectorInput, detectorId: string, detectorVersion: string) {
  return {
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    detectorId,
    detectorVersion,
    status: 'active' as const,
    supersededById: null,
  };
}

// ─── RELATIONSHIP DETECTORS ───────────────────────────────────────────────────

/**
 * Detects relationship weakening: missed promises + data integrity flags
 * on the same relationship indicate trust erosion.
 */
export const RelationshipWeakeningDetector: PatternDetector = {
  id: 'relationship.weakening',
  version: '1.0.0',
  category: 'relationship',
  description: 'Detects relationships with multiple missed promises or integrity flags, indicating weakening trust.',

  detect(input: DetectorInput): DetectorResult {
    const counts = countByType(input.events);
    const missed = counts.get('PromiseMissed') ?? 0;
    const flags = counts.get('DataIntegrityFlagged') ?? 0;
    const total = missed + flags;
    const existingId = input.activePatterns.find(p => p.detectorId === 'relationship.weakening')?.id;

    if (total >= 3) {
      const confidence = total >= 5 ? 'high' : total >= 3 ? 'medium' : 'low';
      return {
        patternsDetected: [{
          ...patternBase(input, 'relationship.weakening', '1.0.0'),
          category: 'relationship',
          title: 'Relationship Weakening',
          description: `${total} negative signals detected (${missed} missed promises, ${flags} data integrity flags). Trust may be eroding.`,
          evidence: {
            description: `${missed} missed promises and ${flags} data integrity flags observed.`,
            supportingEventIds: eventIds(input.events.filter(e => ['PromiseMissed', 'DataIntegrityFlagged'].includes(e.type))),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: total,
            threshold: 3,
            observedAt: new Date().toISOString(),
          },
          confidence,
          severity: total >= 5 ? 'high' : 'medium',
        }],
        patternsToResolve: [],
      };
    }

    // Below threshold — resolve if previously detected
    return { patternsDetected: [], patternsToResolve: existingId ? [String(existingId)] : [] };
  },
};

/**
 * Detects referral inactivity: no new referrals from a source in a period.
 */
export const ReferralInactivityDetector: PatternDetector = {
  id: 'relationship.referral-inactivity',
  version: '1.0.0',
  category: 'relationship',
  description: 'Detects referral sources with zero referral activity in the event window.',

  detect(input: DetectorInput): DetectorResult {
    const referrals = input.events.filter(e => e.type === 'AutomyndReferralObserved');
    const existing = input.activePatterns.find(p => p.detectorId === 'relationship.referral-inactivity');

    if (referrals.length === 0 && input.events.length >= 5) {
      // Activity exists but no referrals — inactivity signal
      return {
        patternsDetected: [{
          ...patternBase(input, 'relationship.referral-inactivity', '1.0.0'),
          category: 'relationship',
          title: 'Referral Source Inactivity',
          description: 'No referrals observed from this source despite other activity. Relationship may be cooling.',
          evidence: {
            description: `${input.events.length} events observed but zero referrals.`,
            supportingEventIds: eventIds(input.events.slice(0, 5)),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: 0,
            threshold: 1,
            observedAt: new Date().toISOString(),
          },
          confidence: 'medium',
          severity: 'low',
        }],
        patternsToResolve: [],
      };
    }

    if (referrals.length > 0 && existing) {
      return { patternsDetected: [], patternsToResolve: [String(existing.id)] };
    }

    return { patternsDetected: [], patternsToResolve: [] };
  },
};

/**
 * Detects ownership instability: frequent ownership transfers.
 */
export const OwnershipInstabilityDetector: PatternDetector = {
  id: 'relationship.ownership-instability',
  version: '1.0.0',
  category: 'relationship',
  description: 'Detects frequent ownership transfers indicating coordination instability.',

  detect(input: DetectorInput): DetectorResult {
    const transfers = input.events.filter(e => e.type === 'OwnershipTransferred').length;
    const existing = input.activePatterns.find(p => p.detectorId === 'relationship.ownership-instability');

    if (transfers >= 3) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'relationship.ownership-instability', '1.0.0'),
          category: 'relationship',
          title: 'Ownership Instability',
          description: `${transfers} ownership transfers detected. Frequent handoffs may indicate coordination problems or staffing issues.`,
          evidence: {
            description: `${transfers} ownership transfers in the event window.`,
            supportingEventIds: eventIds(input.events.filter(e => e.type === 'OwnershipTransferred')),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: transfers,
            threshold: 3,
            observedAt: new Date().toISOString(),
          },
          confidence: transfers >= 5 ? 'high' : 'medium',
          severity: 'medium',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

// ─── WORKFLOW DETECTORS ───────────────────────────────────────────────────────

/**
 * Detects workflow abandonment: workflows started but never completed.
 */
export const WorkflowAbandonmentDetector: PatternDetector = {
  id: 'workflow.abandonment',
  version: '1.0.0',
  category: 'workflow',
  description: 'Detects workflows started but suppressed or never completed.',

  detect(input: DetectorInput): DetectorResult {
    const started = input.events.filter(e => e.type === 'WorkflowStarted').length;
    const completed = input.events.filter(e => e.type === 'WorkflowCompleted').length;
    const suppressed = input.events.filter(e => e.type === 'WorkflowSuppressed').length;
    const abandoned = started - completed;
    const existing = input.activePatterns.find(p => p.detectorId === 'workflow.abandonment');

    if (suppressed >= 2 || (started > 0 && abandoned >= 2)) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'workflow.abandonment', '1.0.0'),
          category: 'workflow',
          title: 'Workflow Abandonment',
          description: `${suppressed} suppressed workflows and ${abandoned} uncompleted workflows detected. Workflows may be starting but not reaching completion.`,
          evidence: {
            description: `${started} started, ${completed} completed, ${suppressed} suppressed.`,
            supportingEventIds: eventIds(input.events.filter(e => ['WorkflowStarted', 'WorkflowSuppressed'].includes(e.type))),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: suppressed + abandoned,
            threshold: 2,
            observedAt: new Date().toISOString(),
          },
          confidence: suppressed >= 3 ? 'high' : 'medium',
          severity: 'high',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

/**
 * Detects task overload: many open tasks assigned to same owner.
 */
export const TaskOverloadDetector: PatternDetector = {
  id: 'workflow.task-overload',
  version: '1.0.0',
  category: 'workflow',
  description: 'Detects high task creation rate without proportional completions.',

  detect(input: DetectorInput): DetectorResult {
    const created = input.events.filter(e => e.type === 'TaskCreated').length;
    const completed = input.events.filter(e => e.type === 'TaskCompleted').length;
    const escalated = input.events.filter(e => e.type === 'TaskEscalated').length;
    const backlog = created - completed;
    const existing = input.activePatterns.find(p => p.detectorId === 'workflow.task-overload');

    if (backlog >= 5 || escalated >= 2) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'workflow.task-overload', '1.0.0'),
          category: 'workflow',
          title: 'Task Overload',
          description: `${backlog} unresolved tasks (${created} created, ${completed} completed) with ${escalated} escalations. Owner may be overloaded.`,
          evidence: {
            description: `Task backlog of ${backlog} with ${escalated} escalations.`,
            supportingEventIds: eventIds(input.events.filter(e => ['TaskCreated', 'TaskEscalated'].includes(e.type))),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: backlog,
            threshold: 5,
            observedAt: new Date().toISOString(),
          },
          confidence: backlog >= 8 ? 'high' : 'medium',
          severity: escalated >= 3 ? 'critical' : 'high',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

/**
 * Detects SLA drift: promises with high miss rate.
 */
export const SLADriftDetector: PatternDetector = {
  id: 'workflow.sla-drift',
  version: '1.0.0',
  category: 'workflow',
  description: 'Detects systematic promise-keeping failures indicating SLA drift.',

  detect(input: DetectorInput): DetectorResult {
    const kept = input.events.filter(e => e.type === 'PromiseKept').length;
    const missed = input.events.filter(e => e.type === 'PromiseMissed').length;
    const total = kept + missed;
    const existing = input.activePatterns.find(p => p.detectorId === 'workflow.sla-drift');

    if (total >= 3 && missed / total >= 0.4) {
      const missRate = Math.round((missed / total) * 100);
      return {
        patternsDetected: [{
          ...patternBase(input, 'workflow.sla-drift', '1.0.0'),
          category: 'workflow',
          title: 'SLA Drift',
          description: `${missRate}% promise miss rate (${missed}/${total}). Service commitments are not being met consistently.`,
          evidence: {
            description: `${missed} missed out of ${total} promises (${missRate}% miss rate).`,
            supportingEventIds: eventIds(input.events.filter(e => ['PromiseKept', 'PromiseMissed'].includes(e.type))),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: missRate,
            threshold: 40,
            observedAt: new Date().toISOString(),
          },
          confidence: total >= 5 ? 'high' : 'medium',
          severity: missRate >= 60 ? 'critical' : 'high',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

// ─── KNOWLEDGE DETECTORS ──────────────────────────────────────────────────────

/**
 * Detects conflicting knowledge: data integrity flags suggest conflicting data.
 */
export const ConflictingKnowledgeDetector: PatternDetector = {
  id: 'knowledge.conflict',
  version: '1.0.0',
  category: 'knowledge',
  description: 'Detects data integrity flags that suggest conflicting information about a subject.',

  detect(input: DetectorInput): DetectorResult {
    const flags = input.events.filter(e => e.type === 'DataIntegrityFlagged').length;
    const resolved = input.events.filter(e => e.type === 'DataIntegrityResolved').length;
    const open = flags - resolved;
    const existing = input.activePatterns.find(p => p.detectorId === 'knowledge.conflict');

    if (open >= 2) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'knowledge.conflict', '1.0.0'),
          category: 'knowledge',
          title: 'Conflicting Knowledge',
          description: `${open} unresolved data integrity conflicts detected. Information about this subject may be inconsistent.`,
          evidence: {
            description: `${flags} integrity flags, ${resolved} resolved, ${open} open conflicts.`,
            supportingEventIds: eventIds(input.events.filter(e => e.type === 'DataIntegrityFlagged')),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: open,
            threshold: 2,
            observedAt: new Date().toISOString(),
          },
          confidence: open >= 3 ? 'high' : 'medium',
          severity: 'high',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

/**
 * Detects repeated observations of the same topic — emerging theme.
 */
export const EmergingThemeDetector: PatternDetector = {
  id: 'knowledge.emerging-theme',
  version: '1.0.0',
  category: 'knowledge',
  description: 'Detects when the same type of event recurs, suggesting an emerging organizational theme.',

  detect(input: DetectorInput): DetectorResult {
    const counts = countByType(input.events);
    const existing = input.activePatterns.find(p => p.detectorId === 'knowledge.emerging-theme');

    // Find the most common event type (excluding system events)
    const SYSTEM_EVENTS = new Set(['ProjectionRebuilt', 'ProjectionInvalidated', 'ProjectionFailed', 'ObservationRecorded', 'KnowledgeAsserted']);
    let topType = '';
    let topCount = 0;
    for (const [type, count] of counts) {
      if (!SYSTEM_EVENTS.has(type) && count > topCount) {
        topType = type;
        topCount = count;
      }
    }

    if (topCount >= 5) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'knowledge.emerging-theme', '1.0.0'),
          category: 'knowledge',
          title: 'Emerging Theme',
          description: `"${topType}" events appear ${topCount} times — an emerging theme for this subject.`,
          evidence: {
            description: `${topType} occurred ${topCount} times.`,
            supportingEventIds: eventIds(input.events.filter(e => e.type === topType)),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: topCount,
            threshold: 5,
            observedAt: new Date().toISOString(),
          },
          confidence: topCount >= 8 ? 'high' : 'medium',
          severity: 'info',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

// ─── JOURNEY DETECTORS ────────────────────────────────────────────────────────

/**
 * Detects communication failures in the patient journey.
 */
export const CommunicationFailureDetector: PatternDetector = {
  id: 'journey.communication-failure',
  version: '1.0.0',
  category: 'journey',
  description: 'Detects repeated communication failures indicating a friction point in the patient journey.',

  detect(input: DetectorInput): DetectorResult {
    const failed = input.events.filter(e => e.type === 'CommunicationFailed').length;
    const sent = input.events.filter(e => e.type === 'CommunicationSent').length;
    const existing = input.activePatterns.find(p => p.detectorId === 'journey.communication-failure');

    if (failed >= 2) {
      const failRate = sent > 0 ? Math.round((failed / (sent + failed)) * 100) : 100;
      return {
        patternsDetected: [{
          ...patternBase(input, 'journey.communication-failure', '1.0.0'),
          category: 'journey',
          title: 'Communication Failure Pattern',
          description: `${failed} communication failures (${failRate}% failure rate). A friction point exists in the communication journey.`,
          evidence: {
            description: `${failed} failures out of ${sent + failed} communication attempts.`,
            supportingEventIds: eventIds(input.events.filter(e => e.type === 'CommunicationFailed')),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: failed,
            threshold: 2,
            observedAt: new Date().toISOString(),
          },
          confidence: failed >= 3 ? 'high' : 'medium',
          severity: failed >= 4 ? 'high' : 'medium',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

/**
 * Detects positive journey pattern: successful completion with no failures.
 */
export const SuccessfulJourneyDetector: PatternDetector = {
  id: 'journey.successful-path',
  version: '1.0.0',
  category: 'journey',
  description: 'Identifies subjects with clean, successful journeys — a pattern worth replicating.',

  detect(input: DetectorInput): DetectorResult {
    const completed = input.events.filter(e => e.type === 'WorkflowCompleted').length;
    const kept = input.events.filter(e => e.type === 'PromiseKept').length;
    const failed = input.events.filter(e => e.type === 'CommunicationFailed').length;
    const missed = input.events.filter(e => e.type === 'PromiseMissed').length;
    const flags = input.events.filter(e => e.type === 'DataIntegrityFlagged').length;
    const existing = input.activePatterns.find(p => p.detectorId === 'journey.successful-path');

    if (completed >= 1 && kept >= 2 && failed === 0 && missed === 0 && flags === 0) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'journey.successful-path', '1.0.0'),
          category: 'journey',
          title: 'Successful Journey Path',
          description: `Clean journey: ${completed} completed workflows, ${kept} kept promises, zero failures. This is a model pattern.`,
          evidence: {
            description: `${completed} workflow completions and ${kept} kept promises with no negative events.`,
            supportingEventIds: eventIds(input.events.filter(e => ['WorkflowCompleted', 'PromiseKept'].includes(e.type))),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: completed + kept,
            threshold: 3,
            observedAt: new Date().toISOString(),
          },
          confidence: 'high',
          severity: 'info',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

// ─── COMMUNITY DETECTORS ──────────────────────────────────────────────────────

/**
 * Detects high referral engagement from a source — community opportunity.
 */
export const HighReferralEngagementDetector: PatternDetector = {
  id: 'community.high-referral-engagement',
  version: '1.0.0',
  category: 'community',
  description: 'Identifies referral sources with sustained high engagement — a community strength.',

  detect(input: DetectorInput): DetectorResult {
    const referrals = input.events.filter(e => e.type === 'AutomyndReferralObserved').length;
    const existing = input.activePatterns.find(p => p.detectorId === 'community.high-referral-engagement');

    if (referrals >= 5) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'community.high-referral-engagement', '1.0.0'),
          category: 'community',
          title: 'High Referral Engagement',
          description: `${referrals} referrals observed — this is a high-engagement referral source in the community.`,
          evidence: {
            description: `${referrals} referrals from this source.`,
            supportingEventIds: eventIds(input.events.filter(e => e.type === 'AutomyndReferralObserved')),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: referrals,
            threshold: 5,
            observedAt: new Date().toISOString(),
          },
          confidence: referrals >= 10 ? 'high' : 'medium',
          severity: 'info',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

// ─── ORGANIZATIONAL DETECTORS ─────────────────────────────────────────────────

/**
 * Detects operational health opportunity: high promise-keeping rate.
 */
export const OperationalExcellenceDetector: PatternDetector = {
  id: 'organizational.operational-excellence',
  version: '1.0.0',
  category: 'organizational',
  description: 'Identifies strong operational performance — high promise-keeping, low failures.',

  detect(input: DetectorInput): DetectorResult {
    const kept = input.events.filter(e => e.type === 'PromiseKept').length;
    const missed = input.events.filter(e => e.type === 'PromiseMissed').length;
    const total = kept + missed;
    const existing = input.activePatterns.find(p => p.detectorId === 'organizational.operational-excellence');

    if (total >= 5 && kept / total >= 0.85) {
      const keepRate = Math.round((kept / total) * 100);
      return {
        patternsDetected: [{
          ...patternBase(input, 'organizational.operational-excellence', '1.0.0'),
          category: 'organizational',
          title: 'Operational Excellence',
          description: `${keepRate}% promise-keeping rate (${kept}/${total}). Organizational performance is strong.`,
          evidence: {
            description: `${kept} kept out of ${total} promises (${keepRate}%).`,
            supportingEventIds: eventIds(input.events.filter(e => ['PromiseKept', 'PromiseMissed'].includes(e.type))),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: keepRate,
            threshold: 85,
            observedAt: new Date().toISOString(),
          },
          confidence: total >= 10 ? 'high' : 'medium',
          severity: 'info',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

/**
 * Detects quality risk: repeated data integrity issues across the organization.
 */
export const QualityRiskDetector: PatternDetector = {
  id: 'organizational.quality-risk',
  version: '1.0.0',
  category: 'organizational',
  description: 'Detects systematic data quality issues that represent organizational risk.',

  detect(input: DetectorInput): DetectorResult {
    const flags = input.events.filter(e => e.type === 'DataIntegrityFlagged').length;
    const resolved = input.events.filter(e => e.type === 'DataIntegrityResolved').length;
    const rate = input.events.length > 0 ? flags / input.events.length : 0;
    const existing = input.activePatterns.find(p => p.detectorId === 'organizational.quality-risk');

    if (flags >= 3 && rate >= 0.15) {
      return {
        patternsDetected: [{
          ...patternBase(input, 'organizational.quality-risk', '1.0.0'),
          category: 'organizational',
          title: 'Data Quality Risk',
          description: `${flags} data integrity flags (${Math.round(rate * 100)}% of all events) with ${flags - resolved} unresolved. Systematic quality risk detected.`,
          evidence: {
            description: `${flags} integrity flags, ${resolved} resolved, across ${input.events.length} total events.`,
            supportingEventIds: eventIds(input.events.filter(e => e.type === 'DataIntegrityFlagged')),
            supportingObjectIds: [input.subjectId],
            supportingObservationIds: [],
            measuredValue: flags,
            threshold: 3,
            observedAt: new Date().toISOString(),
          },
          confidence: flags >= 5 ? 'high' : 'medium',
          severity: 'critical',
        }],
        patternsToResolve: [],
      };
    }

    return { patternsDetected: [], patternsToResolve: existing ? [String(existing.id)] : [] };
  },
};

// ─── All detectors ────────────────────────────────────────────────────────────

export const ALL_PATTERN_DETECTORS: PatternDetector[] = [
  // Relationship
  RelationshipWeakeningDetector,
  ReferralInactivityDetector,
  OwnershipInstabilityDetector,
  // Workflow
  WorkflowAbandonmentDetector,
  TaskOverloadDetector,
  SLADriftDetector,
  // Knowledge
  ConflictingKnowledgeDetector,
  EmergingThemeDetector,
  // Journey
  CommunicationFailureDetector,
  SuccessfulJourneyDetector,
  // Community
  HighReferralEngagementDetector,
  // Organizational
  OperationalExcellenceDetector,
  QualityRiskDetector,
];
