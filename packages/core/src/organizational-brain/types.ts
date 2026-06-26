/**
 * Alara OS — Organizational Brain Types (M8)
 *
 * The Organizational Brain is the platform's ability to recognize patterns
 * across people, workflows, relationships, knowledge, events, and time.
 *
 * Constitutional alignment:
 *   "The organization continuously becomes more capable." (Part XI — Learn)
 *   "Intelligence is the organization's ability to transform information
 *    into shared understanding and sound judgment." (Vocabulary)
 *
 * The Brain:
 *   MAY: observe, aggregate, correlate, score, classify, publish patterns
 *   MAY NOT: assign tasks, change workflows, create communications,
 *             execute commands, change permissions, call AI, modify EMR data
 *
 * Everything the Brain emits is ADVISORY.
 * It discovers patterns. It does not decide or execute.
 *
 * ADR-015: Brain is NOT AI. It is deterministic pattern recognition.
 *   No LLM. No probabilistic ML. No autonomous actions.
 *   AI will consume Brain outputs in M9.
 *
 * ADR-016: OrganizationalHealthProjection is a Computed Projection.
 *   Disposable. Rebuildable. Not canonical state.
 */

import { AlaraId } from '../shared/types';

// ─── Pattern categories ───────────────────────────────────────────────────────

export type PatternCategory =
  | 'relationship'    // relationship weakening/strengthening, trust trends
  | 'workflow'        // bottlenecks, delays, SLA drift, abandoned workflows
  | 'knowledge'       // repeated observations, conflicts, gaps
  | 'journey'         // friction points, abandonment, successful paths
  | 'community'       // referral ecosystem, physician engagement
  | 'organizational'; // operational pain, staffing, quality improvement

export type PatternStatus =
  | 'active'      // currently observed, unresolved
  | 'resolved'    // the pattern has stopped occurring
  | 'superseded'  // a newer, more specific pattern replaces this one
  | 'dismissed';  // acknowledged but not acted upon

export type PatternSeverity =
  | 'critical'  // requires immediate attention
  | 'high'      // should be addressed soon
  | 'medium'    // warrants monitoring
  | 'low'       // informational
  | 'info';     // positive pattern or opportunity

// ─── Evidence ─────────────────────────────────────────────────────────────────

export interface PatternEvidence {
  readonly description: string;
  readonly supportingEventIds: readonly string[];
  readonly supportingObjectIds: readonly string[];
  readonly supportingObservationIds: readonly string[];
  readonly measuredValue: number | string | null;
  readonly threshold: number | string | null;
  readonly observedAt: string; // ISO datetime
}

// ─── Pattern (first-class organizational object) ──────────────────────────────

export interface DetectedPattern {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly category: PatternCategory;
  /** Human-readable pattern name */
  readonly title: string;
  /** Human-readable description of what was detected and why it matters */
  readonly description: string;
  /** Subject this pattern is about (patient, referral source, workflow, etc.) */
  readonly subjectId: string;
  readonly subjectType: string;
  readonly evidence: PatternEvidence;
  readonly confidence: PatternConfidence;
  readonly severity: PatternSeverity;
  readonly status: PatternStatus;
  /** Which detector produced this pattern */
  readonly detectorId: string;
  readonly detectorVersion: string;
  /** If status=superseded, the pattern that supersedes this one */
  readonly supersededById: AlaraId | null;
  readonly firstDetectedAt: Date;
  readonly lastConfirmedAt: Date;
  readonly resolvedAt: Date | null;
  readonly version: number;
}

export type PatternConfidence = 'high' | 'medium' | 'low';

// ─── Pattern detector interface ───────────────────────────────────────────────

export interface DetectorInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly events: readonly import('../events/types').DomainEvent[];
  readonly activePatterns: readonly DetectedPattern[];
}

export interface DetectorResult {
  readonly patternsDetected: readonly Omit<DetectedPattern, 'id' | 'tenantId' | 'firstDetectedAt' | 'lastConfirmedAt' | 'resolvedAt' | 'version' | 'supersededById'>[];
  readonly patternsToResolve: readonly string[]; // pattern IDs to mark resolved
}

export interface PatternDetector {
  readonly id: string;
  readonly version: string;
  readonly category: PatternCategory;
  readonly description: string;
  detect(input: DetectorInput): DetectorResult;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface RunBrainAnalysisCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly actor: string;
}

export interface ResolvePatternCommand {
  readonly tenantId: string;
  readonly patternId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface DismissPatternCommand {
  readonly tenantId: string;
  readonly patternId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface SupersedePatternCommand {
  readonly tenantId: string;
  readonly oldPatternId: AlaraId;
  readonly newPatternId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface PatternDetectedPayload {
  patternId: string;
  category: PatternCategory;
  title: string;
  severity: PatternSeverity;
  confidence: PatternConfidence;
  subjectId: string;
  subjectType: string;
  detectorId: string;
}

export interface PatternResolvedPayload {
  patternId: string;
  category: PatternCategory;
  previousVersion: number;
}

export interface PatternDismissedPayload {
  patternId: string;
  reason: string;
  previousVersion: number;
}

export interface PatternSupersededPayload {
  oldPatternId: string;
  newPatternId: string;
}

export interface PatternConfirmedPayload {
  patternId: string;
  previousVersion: number;
}

export interface OpportunitySurfacedPayload {
  patternId: string;
  title: string;
  subjectId: string;
  subjectType: string;
}

export interface RiskSurfacedPayload {
  patternId: string;
  title: string;
  severity: PatternSeverity;
  subjectId: string;
  subjectType: string;
}

export interface TrendDetectedPayload {
  patternId: string;
  category: PatternCategory;
  title: string;
  subjectId: string;
  direction: 'improving' | 'declining' | 'stable';
}

// ─── Organizational Health Projection value (ADR-016) ─────────────────────────

export interface OrganizationalHealthValue {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly activePatternCount: number;
  readonly openRiskCount: number;
  readonly opportunityCount: number;
  readonly patternsByCategory: Record<PatternCategory, number>;
  readonly patternsBySeverity: Record<PatternSeverity, number>;
  readonly criticalPatterns: readonly { id: string; title: string; severity: PatternSeverity }[];
  readonly opportunities: readonly { id: string; title: string }[];
  readonly trendIndicator: 'improving' | 'stable' | 'declining' | 'unknown';
  readonly healthScore: number; // 0.0–1.0
  readonly disclaimer: 'computed-projection-advisory-only';
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StalePatternError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale pattern ${id}: expected v${expected}, got v${actual}`);
    this.name = 'StalePatternError';
  }
}

export class PatternNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Pattern ${id} not found`);
    this.name = 'PatternNotFoundError';
  }
}
