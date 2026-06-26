/**
 * Alara OS — Reasoning Engine Types (M9)
 *
 * Constitutional alignment:
 *   ADR-003 AI Last: "AI is consulted after all deterministic logic has run."
 *   ADR-015: AI may recommend. It may not create workflows, assign tasks,
 *             send communications, or bypass the Rules Engine.
 *   ADR-016: ReasoningSummaryProjection is a Computed Projection — disposable,
 *             rebuildable, never canonical state.
 *
 * The Reasoning Engine is the ONLY layer permitted to call an LLM.
 * The Organizational Brain remains deterministic.
 * The Rules Engine remains authoritative.
 * The Knowledge Engine remains factual.
 *
 * All Reasoning outputs are ADVISORY.
 * The Rules Engine always has final authority over recommendations.
 *
 * Evidence chain:
 *   Reasoning → Patterns → Knowledge → Relationships → Objects → Events
 *
 * No output may be produced without a traceable evidence chain.
 * No free-form strings — every output is typed.
 */

import { AlaraId } from '../shared/types';
import { PatternCategory } from '../organizational-brain/types';

// ─── Evidence Chain ───────────────────────────────────────────────────────────

export interface EvidenceChain {
  readonly patternIds: readonly string[];
  readonly knowledgeEntryIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly objectIds: readonly string[];
  readonly eventIds: readonly string[];
  /** Human-readable explanation of why this evidence supports the reasoning */
  readonly rationale: string;
}

// ─── Confidence Model ─────────────────────────────────────────────────────────

export type ReasoningConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface ConfidenceAssessment {
  readonly overall: ReasoningConfidence;
  readonly evidenceQuality: ReasoningConfidence;
  readonly conflictingEvidence: boolean;
  readonly conflictSummary: string | null;
  readonly missingEvidence: readonly string[];
  readonly reasoningMethod: string;
  readonly modelIdentifier: string;
  readonly assessedAt: string; // ISO datetime
}

// ─── Core reasoning objects ───────────────────────────────────────────────────

/** A possible explanation for observed patterns */
export interface Hypothesis {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly statement: string;
  readonly rationale: string;
  readonly evidence: EvidenceChain;
  readonly confidence: ConfidenceAssessment;
  readonly alternativeExplanations: readonly string[];
  readonly category: PatternCategory;
  readonly status: HypothesisStatus;
  readonly generatedAt: string;
  readonly modelIdentifier: string;
  readonly version: number;
}

export type HypothesisStatus = 'active' | 'confirmed' | 'refuted' | 'superseded';

/** An action recommendation derived from reasoning */
export interface Recommendation {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly title: string;
  readonly rationale: string;
  /** What type of action is being recommended */
  readonly actionType: RecommendationActionType;
  /** Structured action descriptor — never free-form */
  readonly action: RecommendedAction;
  readonly evidence: EvidenceChain;
  readonly confidence: ConfidenceAssessment;
  readonly priority: RecommendationPriority;
  readonly status: RecommendationStatus;
  /** Whether the Rules Engine has evaluated this */
  readonly rulesEngineApproved: boolean | null;
  /** Rules Engine explanation if evaluated */
  readonly rulesEngineExplanation: string | null;
  readonly generatedAt: string;
  readonly modelIdentifier: string;
  readonly version: number;
}

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';
export type RecommendationStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'acted_upon';

export type RecommendationActionType =
  | 'contact_patient'
  | 'contact_referral_source'
  | 'contact_physician'
  | 'review_knowledge'
  | 'investigate_pattern'
  | 'schedule_follow_up'
  | 'escalate_to_human'
  | 'review_workflow'
  | 'update_care_team'
  | 'gather_information';

export interface RecommendedAction {
  readonly type: RecommendationActionType;
  readonly description: string;
  readonly urgency: 'immediate' | 'within_24h' | 'within_week' | 'when_convenient';
  readonly targetId?: string;
  readonly targetType?: string;
}

/** An identified gap in available information */
export interface MissingInformation {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly question: string;
  readonly importance: 'critical' | 'high' | 'medium' | 'low';
  readonly category: PatternCategory;
  readonly whyNeeded: string;
  readonly howToObtain: string;
  readonly evidence: EvidenceChain;
  readonly status: 'open' | 'answered' | 'not_obtainable';
  readonly generatedAt: string;
  readonly modelIdentifier: string;
  readonly version: number;
}

/** A human-readable narrative generated from evidence */
export interface Narrative {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly narrativeType: NarrativeType;
  /** Structured sections — never a single free-form blob */
  readonly sections: readonly NarrativeSection[];
  readonly evidence: EvidenceChain;
  readonly confidence: ConfidenceAssessment;
  readonly generatedAt: string;
  readonly modelIdentifier: string;
  readonly version: number;
}

export type NarrativeType =
  | 'referral_summary'
  | 'patient_summary'
  | 'physician_summary'
  | 'case_summary'
  | 'organizational_summary';

export interface NarrativeSection {
  readonly heading: string;
  readonly body: string;
  readonly evidenceIds: readonly string[];
}

/** An alternative explanation for a pattern or hypothesis */
export interface Alternative {
  readonly statement: string;
  readonly plausibility: ReasoningConfidence;
  readonly whyLessLikely: string;
}

// ─── Reasoning Context (assembled input for the provider) ─────────────────────

export interface ReasoningContext {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  /** Active patterns from the Organizational Brain */
  readonly patterns: readonly import('../organizational-brain/types').DetectedPattern[];
  /** Active knowledge entries */
  readonly knowledgeEntries: readonly import('../knowledge-engine/types').KnowledgeEntry[];
  /** Relevant observations */
  readonly observations: readonly import('../knowledge-engine/types').Observation[];
  /** Object attributes (non-clinical) */
  readonly objectAttributes: Record<string, unknown>;
  /** External references */
  readonly externalReferences: readonly { system: string; extType: string; value: string }[];
  /** Active workflow summaries */
  readonly workflowSummaries: readonly { workflowId: string; templateId: string; status: string }[];
  /** Recent event types (no clinical content) */
  readonly recentEventTypes: readonly string[];
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface GenerateHypothesesCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly context: ReasoningContext;
  readonly actor: string;
}

export interface GenerateRecommendationsCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly hypotheses: readonly Hypothesis[];
  readonly context: ReasoningContext;
  readonly actor: string;
}

export interface GenerateNarrativeCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly narrativeType: NarrativeType;
  readonly context: ReasoningContext;
  readonly actor: string;
}

export interface IdentifyMissingInformationCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly context: ReasoningContext;
  readonly actor: string;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface HypothesisGeneratedPayload {
  hypothesisId: string;
  subjectId: string;
  category: string;
  confidence: ReasoningConfidence;
  modelIdentifier: string;
}

export interface RecommendationGeneratedPayload {
  recommendationId: string;
  subjectId: string;
  actionType: RecommendationActionType;
  priority: RecommendationPriority;
  modelIdentifier: string;
}

export interface RecommendationApprovedPayload {
  recommendationId: string;
  rulesEngineDecision: string;
}

export interface RecommendationRejectedPayload {
  recommendationId: string;
  rulesEngineDecision: string;
  reason: string;
}

export interface NarrativeGeneratedPayload {
  narrativeId: string;
  subjectId: string;
  narrativeType: NarrativeType;
  modelIdentifier: string;
}

export interface MissingInformationIdentifiedPayload {
  missingInformationId: string;
  subjectId: string;
  importance: string;
  category: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class InsufficientEvidenceError extends Error {
  constructor(subjectId: string, reason: string) {
    super(`Insufficient evidence to reason about ${subjectId}: ${reason}`);
    this.name = 'InsufficientEvidenceError';
  }
}

export class ReasoningProviderError extends Error {
  constructor(provider: string, message: string) {
    super(`Reasoning provider "${provider}" failed: ${message}`);
    this.name = 'ReasoningProviderError';
  }
}
