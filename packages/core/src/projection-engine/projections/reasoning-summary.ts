/**
 * Alara OS — Reasoning Summary Projection (ADR-016)
 *
 * A computed, non-authoritative summary of all reasoning outputs
 * for a subject. Rebuilt from canonical reasoning objects.
 *
 * "Discarding this projection loses no truth."
 *
 * ADR-016: methodVersion, canonicalInputs, confidence, aiInvolved all declared.
 * aiInvolved is TRUE — the Reasoning Engine uses LLM providers.
 */

import {
  ConfidenceLevel,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
  ProjectionType,
} from '../types';
import {
  Hypothesis,
  MissingInformation,
  Recommendation,
  ReasoningConfidence,
} from '../../reasoning-engine/types';

// ─── Input / Value ────────────────────────────────────────────────────────────

export interface ReasoningSummaryInput {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly hypotheses: readonly Hypothesis[];
  readonly recommendations: readonly Recommendation[];
  readonly missingInformation: readonly MissingInformation[];
}

export interface ReasoningSummaryValue {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly activeHypothesisCount: number;
  readonly recommendationCount: number;
  readonly approvedRecommendationCount: number;
  readonly rejectedRecommendationCount: number;
  readonly openMissingInformationCount: number;
  readonly confidenceDistribution: Record<ReasoningConfidence, number>;
  readonly criticalMissingInfo: readonly string[];
  readonly topRecommendations: readonly { id: string; title: string; priority: string; status: string }[];
  readonly modelIdentifiers: readonly string[];
  readonly disclaimer: 'computed-projection-advisory-only';
}

// ─── Projection definition ────────────────────────────────────────────────────

export const ReasoningSummaryProjectionDefinition: ProjectionDefinition<
  ReasoningSummaryInput,
  ReasoningSummaryValue
> = {
  type: 'ReasoningSummary' as ProjectionType,
  methodName: 'reasoning-summary',
  methodVersion: '1.0.0',

  declareDependencies(subjectId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Hypotheses', kind: 'object', sourceId: `${subjectId}::hypotheses` },
      { name: 'Recommendations', kind: 'object', sourceId: `${subjectId}::recommendations` },
      { name: 'Missing information', kind: 'object', sourceId: `${subjectId}::missing_information` },
    ];
  },

  build(input: ReasoningSummaryInput): ProjectionBuildResult<ReasoningSummaryValue> {
    const activeHypotheses = input.hypotheses.filter(h => h.status === 'active');
    const approvedRecs = input.recommendations.filter(r => r.status === 'approved');
    const rejectedRecs = input.recommendations.filter(r => r.status === 'rejected');
    const openMissing = input.missingInformation.filter(m => m.status === 'open');
    const criticalMissing = openMissing.filter(m => m.importance === 'critical').map(m => m.question);

    // Confidence distribution across all reasoning objects
    const dist: Record<ReasoningConfidence, number> = { high: 0, medium: 0, low: 0, insufficient: 0 };
    for (const h of activeHypotheses) dist[h.confidence.overall]++;
    for (const r of input.recommendations) dist[r.confidence.overall]++;

    // Top 3 approved recommendations by priority
    const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const topRecs = [...approvedRecs]
      .sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0))
      .slice(0, 3)
      .map(r => ({ id: String(r.id), title: r.title, priority: r.priority, status: r.status }));

    const modelIds = [...new Set([
      ...input.hypotheses.map(h => h.modelIdentifier),
      ...input.recommendations.map(r => r.modelIdentifier),
    ])];

    const overallConfidence: ConfidenceLevel =
      dist.high >= 2 ? 'high' : dist.medium >= 1 ? 'moderate' : 'low';

    return {
      value: {
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        activeHypothesisCount: activeHypotheses.length,
        recommendationCount: input.recommendations.length,
        approvedRecommendationCount: approvedRecs.length,
        rejectedRecommendationCount: rejectedRecs.length,
        openMissingInformationCount: openMissing.length,
        confidenceDistribution: dist,
        criticalMissingInfo: criticalMissing,
        topRecommendations: topRecs,
        modelIdentifiers: modelIds,
        disclaimer: 'computed-projection-advisory-only',
      },
      confidence: overallConfidence,
      inferenceBasis: 'ai_generated', // Reasoning Engine uses LLM
      aiInvolved: true,               // Always true for reasoning outputs
      sourceEventIds: [
        ...input.hypotheses.map(h => String(h.id)),
        ...input.recommendations.map(r => String(r.id)),
      ],
      freshUntil: null,
    };
  },
};
