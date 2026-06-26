/**
 * Alara OS — Knowledge Summary Projection (ADR-016)
 *
 * A computed, non-authoritative summary of what the organization knows
 * about a subject. Rebuilt from canonical knowledge entries and observations.
 *
 * "Discarding this projection loses no truth."
 *
 * ADR-001: No clinical content in any projection value.
 * ADR-016: methodVersion, canonicalInputs, confidence, aiInvolved all declared.
 */

import {
  ConfidenceLevel,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
} from '../types';
import {
  CONFIDENCE_RANK,
  KnowledgeEntry,
  KnowledgeEntryKind,
  Observation,
  ObservationTopic,
} from '../../knowledge-engine/types';

// ─── Input type ────────────────────────────────────────────────────────────────

export interface KnowledgeSummaryInput {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly activeEntries: readonly KnowledgeEntry[];
  readonly observations: readonly Observation[];
}

// ─── Value type ───────────────────────────────────────────────────────────────

export interface KnowledgeTopicSummary {
  readonly topic: ObservationTopic;
  readonly entryCount: number;
  readonly observationCount: number;
  readonly highestConfidence: string;
  readonly hasAiInvolvedEntry: boolean;
  readonly topStatement: string | null;
}

export interface KnowledgeSummaryValue {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly totalActiveEntries: number;
  readonly totalObservations: number;
  readonly byTopic: readonly KnowledgeTopicSummary[];
  readonly factCount: number;
  readonly inferenceCount: number;
  readonly riskCount: number;
  readonly hasExpiredEntries: boolean;
  readonly disclaimer: 'computed-projection-advisory-only';
}

// ─── Projection definition ─────────────────────────────────────────────────────

export const KnowledgeSummaryProjectionDefinition: ProjectionDefinition<
  KnowledgeSummaryInput,
  KnowledgeSummaryValue
> = {
  type: 'Timeline' as import('../types').ProjectionType, // Using Timeline slot; M8 will add KnowledgeSummary type
  methodName: 'knowledge-summary',
  methodVersion: '1.0.0',

  declareDependencies(subjectId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Active knowledge entries', kind: 'object', sourceId: `${subjectId}::knowledge_entries` },
      { name: 'Observations', kind: 'event_stream', sourceId: `${subjectId}::observations` },
    ];
  },

  build(input: KnowledgeSummaryInput): ProjectionBuildResult<KnowledgeSummaryValue> {
    const allTopics = new Set<ObservationTopic>([
      ...input.activeEntries.map(e => e.topic),
      ...input.observations.map(o => o.topic),
    ]);

    const byTopic: KnowledgeTopicSummary[] = [];
    for (const topic of allTopics) {
      const entries = input.activeEntries.filter(e => e.topic === topic);
      const obs = input.observations.filter(o => o.topic === topic);
      const confidenceRank: Record<string, number> = {
        confirmed: 4, probable: 3, possible: 2, speculative: 1,
      };
      const allConfidences = [
        ...entries.map(e => e.confidence as string),
        ...obs.map(o => o.confidence as string),
      ];
      const highest = allConfidences.reduce(
        (best, c) => (confidenceRank[c] ?? 0) > (confidenceRank[best] ?? 0) ? c : best,
        'speculative',
      );

      const topEntry = entries[0];
      byTopic.push({
        topic,
        entryCount: entries.length,
        observationCount: obs.length,
        highestConfidence: highest,
        hasAiInvolvedEntry: entries.some(e => e.aiInvolved),
        topStatement: topEntry?.statement ?? null,
      });
    }

    const now = new Date();
    const hasExpired = input.activeEntries.some(e => e.expiresAt && e.expiresAt < now);

    const countByKind = (kind: KnowledgeEntryKind) =>
      input.activeEntries.filter(e => e.kind === kind).length;

    const overallConfidence: ConfidenceLevel =
      input.activeEntries.length === 0 ? 'unknown' :
      input.activeEntries.some(e => e.confidence === 'confirmed') ? 'high' :
      input.activeEntries.some(e => e.confidence === 'probable') ? 'moderate' : 'low';

    return {
      value: {
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        totalActiveEntries: input.activeEntries.length,
        totalObservations: input.observations.length,
        byTopic,
        factCount: countByKind('fact'),
        inferenceCount: countByKind('inference'),
        riskCount: countByKind('risk'),
        hasExpiredEntries: hasExpired,
        disclaimer: 'computed-projection-advisory-only',
      },
      confidence: overallConfidence,
      inferenceBasis: input.activeEntries.some(e => e.aiInvolved) ? 'ai_generated' : 'inference',
      aiInvolved: input.activeEntries.some(e => e.aiInvolved),
      sourceEventIds: [
        ...input.activeEntries.map(e => String(e.id)),
        ...input.observations.map(o => String(o.id)),
      ],
      freshUntil: null,
    };
  },
};
