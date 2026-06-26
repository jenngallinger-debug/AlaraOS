/**
 * Alara OS — Organizational Health Projection (ADR-016)
 *
 * A computed, non-authoritative summary of the organizational health
 * for a subject, derived from detected patterns.
 *
 * "Discarding this projection loses no truth."
 * Rebuild from canonical patterns at any time.
 *
 * ADR-016: methodVersion, canonicalInputs, confidence, aiInvolved all declared.
 * aiInvolved is always false — the Brain is deterministic, not AI.
 */

import {
  ConfidenceLevel,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
  ProjectionType,
} from '../types';
import {
  DetectedPattern,
  OrganizationalHealthValue,
  PatternCategory,
  PatternSeverity,
} from '../../organizational-brain/types';

// ─── Input type ────────────────────────────────────────────────────────────────

export interface OrganizationalHealthInput {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly activePatterns: readonly DetectedPattern[];
}

// ─── Projection definition ─────────────────────────────────────────────────────

export const OrganizationalHealthProjectionDefinition: ProjectionDefinition<
  OrganizationalHealthInput,
  OrganizationalHealthValue
> = {
  type: 'OrganizationalHealth' as ProjectionType,
  methodName: 'organizational-health',
  methodVersion: '1.0.0',

  declareDependencies(subjectId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Active patterns', kind: 'object', sourceId: `${subjectId}::detected_patterns` },
    ];
  },

  build(input: OrganizationalHealthInput): ProjectionBuildResult<OrganizationalHealthValue> {
    const active = input.activePatterns.filter(p => p.status === 'active');

    // Count by category
    const byCategory = {} as Record<PatternCategory, number>;
    const allCategories: PatternCategory[] = ['relationship', 'workflow', 'knowledge', 'journey', 'community', 'organizational'];
    for (const cat of allCategories) byCategory[cat] = 0;
    for (const p of active) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;

    // Count by severity
    const bySeverity = {} as Record<PatternSeverity, number>;
    const allSeverities: PatternSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of allSeverities) bySeverity[sev] = 0;
    for (const p of active) bySeverity[p.severity] = (bySeverity[p.severity] ?? 0) + 1;

    const critical = active.filter(p => p.severity === 'critical' || p.severity === 'high');
    const opportunities = active.filter(p => p.severity === 'info');
    const risks = active.filter(p => p.severity === 'critical' || p.severity === 'high');

    // Health score: 1.0 = perfect, degrades with high/critical patterns
    const penalty = (bySeverity.critical ?? 0) * 0.3 + (bySeverity.high ?? 0) * 0.15 + (bySeverity.medium ?? 0) * 0.05;
    const healthScore = Math.max(0, Math.min(1, 1 - penalty));

    const trendIndicator: OrganizationalHealthValue['trendIndicator'] =
      active.length === 0 ? 'unknown' :
      healthScore >= 0.8 ? 'improving' :
      healthScore >= 0.5 ? 'stable' :
      'declining';

    const overallConfidence: ConfidenceLevel =
      active.length >= 5 ? 'high' :
      active.length >= 2 ? 'moderate' : 'low';

    return {
      value: {
        tenantId: '', // set by caller context
        subjectId: input.subjectId,
        subjectType: input.subjectType,
        activePatternCount: active.length,
        openRiskCount: risks.length,
        opportunityCount: opportunities.length,
        patternsByCategory: byCategory,
        patternsBySeverity: bySeverity,
        criticalPatterns: critical.map(p => ({ id: String(p.id), title: p.title, severity: p.severity })),
        opportunities: opportunities.map(p => ({ id: String(p.id), title: p.title })),
        trendIndicator,
        healthScore: Math.round(healthScore * 100) / 100,
        disclaimer: 'computed-projection-advisory-only',
      },
      confidence: overallConfidence,
      inferenceBasis: 'inference',
      aiInvolved: false, // Brain is deterministic — no AI
      sourceEventIds: active.map(p => String(p.id)),
      freshUntil: null,
    };
  },
};
