/**
 * Alara OS — Reasoning Providers
 *
 * Provider abstraction for LLM-assisted reasoning.
 * The Reasoning Engine is the ONLY layer permitted to call an LLM.
 *
 * Providers:
 *   StubReasoningProvider  — deterministic, used in tests and dev
 *   OpenAIProvider         — interface stub (production implementation pending)
 *   AnthropicProvider      — interface stub (production implementation pending)
 *
 * ADR-015: Providers never query the database directly.
 * They receive assembled context and return structured outputs.
 * They never create workflows, assign tasks, or send communications.
 */

import {
  Alternative,
  ConfidenceAssessment,
  EvidenceChain,
  Hypothesis,
  HypothesisStatus,
  MissingInformation,
  Narrative,
  NarrativeSection,
  NarrativeType,
  Recommendation,
  ReasoningConfidence,
  ReasoningContext,
  RecommendationActionType,
  RecommendationPriority,
  RecommendationStatus,
} from './types';
import { AlaraId } from '../shared/types';
import { newAlaraId } from '../shared/ids';
import { PatternCategory } from '../organizational-brain/types';

// ─── Provider interface ────────────────────────────────────────────────────────

export interface ProviderHypothesisResult {
  readonly statement: string;
  readonly rationale: string;
  readonly alternatives: readonly Alternative[];
  readonly category: PatternCategory;
  readonly confidence: ReasoningConfidence;
  readonly conflictingEvidence: boolean;
  readonly conflictSummary: string | null;
  readonly missingEvidence: readonly string[];
}

export interface ProviderRecommendationResult {
  readonly title: string;
  readonly rationale: string;
  readonly actionType: RecommendationActionType;
  readonly actionDescription: string;
  readonly urgency: 'immediate' | 'within_24h' | 'within_week' | 'when_convenient';
  readonly targetId?: string;
  readonly targetType?: string;
  readonly priority: RecommendationPriority;
  readonly confidence: ReasoningConfidence;
}

export interface ProviderNarrativeResult {
  readonly sections: readonly { heading: string; body: string }[];
  readonly confidence: ReasoningConfidence;
}

export interface ProviderMissingInformationResult {
  readonly question: string;
  readonly importance: 'critical' | 'high' | 'medium' | 'low';
  readonly category: PatternCategory;
  readonly whyNeeded: string;
  readonly howToObtain: string;
}

export interface ReasoningProvider {
  readonly name: string;
  readonly modelIdentifier: string;

  generateHypotheses(
    context: ReasoningContext,
    evidenceChain: EvidenceChain,
  ): Promise<readonly ProviderHypothesisResult[]>;

  generateRecommendations(
    context: ReasoningContext,
    hypotheses: readonly Hypothesis[],
    evidenceChain: EvidenceChain,
  ): Promise<readonly ProviderRecommendationResult[]>;

  generateNarrative(
    context: ReasoningContext,
    narrativeType: NarrativeType,
    evidenceChain: EvidenceChain,
  ): Promise<ProviderNarrativeResult>;

  identifyMissingInformation(
    context: ReasoningContext,
    evidenceChain: EvidenceChain,
  ): Promise<readonly ProviderMissingInformationResult[]>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfidence(
  overall: ReasoningConfidence,
  conflicting: boolean,
  conflictSummary: string | null,
  missing: readonly string[],
  method: string,
  modelId: string,
): ConfidenceAssessment {
  return {
    overall,
    evidenceQuality: overall,
    conflictingEvidence: conflicting,
    conflictSummary,
    missingEvidence: missing,
    reasoningMethod: method,
    modelIdentifier: modelId,
    assessedAt: new Date().toISOString(),
  };
}

// ─── Stub Provider (deterministic — used in tests and dev) ─────────────────────

export class StubReasoningProvider implements ReasoningProvider {
  readonly name = 'stub';
  readonly modelIdentifier = 'stub-v1';

  async generateHypotheses(
    context: ReasoningContext,
    evidenceChain: EvidenceChain,
  ): Promise<readonly ProviderHypothesisResult[]> {
    const patternCount = context.patterns.length;
    if (patternCount === 0) return [];

    const results: ProviderHypothesisResult[] = [];
    const categories = new Set(context.patterns.map(p => p.category));

    for (const category of categories) {
      const categoryPatterns = context.patterns.filter(p => p.category === category);
      const hasHighSeverity = categoryPatterns.some(p => p.severity === 'critical' || p.severity === 'high');

      results.push({
        statement: `Deterministic analysis of ${categoryPatterns.length} ${category} pattern(s) detected for subject ${context.subjectId}.`,
        rationale: `Evidence: ${categoryPatterns.map(p => p.title).join(', ')}.`,
        alternatives: hasHighSeverity ? [{
          statement: 'Pattern may be transient rather than systemic.',
          plausibility: 'low',
          whyLessLikely: 'Multiple corroborating signals detected across the same subject.',
        }] : [],
        category,
        confidence: categoryPatterns.length >= 2 ? 'medium' : 'low',
        conflictingEvidence: evidenceChain.patternIds.length > 0 && context.knowledgeEntries.some(e => e.confidence === 'speculative'),
        conflictSummary: null,
        missingEvidence: context.observations.length === 0 ? ['No observations recorded for this subject.'] : [],
      });
    }

    return results;
  }

  async generateRecommendations(
    context: ReasoningContext,
    hypotheses: readonly Hypothesis[],
    evidenceChain: EvidenceChain,
  ): Promise<readonly ProviderRecommendationResult[]> {
    if (hypotheses.length === 0) return [];

    const results: ProviderRecommendationResult[] = [];
    const highConfidence = hypotheses.filter(h => h.confidence.overall === 'high' || h.confidence.overall === 'medium');
    const toProcess = highConfidence.length > 0 ? highConfidence : hypotheses.slice(0, 1);

    for (const h of toProcess.slice(0, 2)) {
      results.push({
        title: `Review ${h.category} signals for ${context.subjectType}`,
        rationale: `Based on hypothesis: ${h.statement}`,
        actionType: 'investigate_pattern',
        actionDescription: `A Care Guide should review the ${h.category} patterns identified for this subject and determine if intervention is needed.`,
        urgency: h.confidence.overall === 'high' ? 'within_24h' : 'within_week',
        priority: h.confidence.overall === 'high' ? 'high' : 'medium',
        confidence: h.confidence.overall,
      });
    }

    // If missing evidence, recommend gathering it
    if (context.observations.length === 0) {
      results.push({
        title: 'Gather foundational observations',
        rationale: 'No observations recorded for this subject, limiting reasoning quality.',
        actionType: 'gather_information',
        actionDescription: 'Record initial observations about this subject to improve future reasoning quality.',
        urgency: 'when_convenient',
        priority: 'low',
        confidence: 'high',
      });
    }

    return results;
  }

  async generateNarrative(
    context: ReasoningContext,
    narrativeType: NarrativeType,
    evidenceChain: EvidenceChain,
  ): Promise<ProviderNarrativeResult> {
    const sections: { heading: string; body: string }[] = [
      {
        heading: 'Summary',
        body: `${context.subjectType} ${context.subjectId} has ${context.patterns.length} active pattern(s) across ${new Set(context.patterns.map(p => p.category)).size} categories.`,
      },
    ];

    if (context.patterns.length > 0) {
      sections.push({
        heading: 'Active Patterns',
        body: context.patterns.map(p => `${p.title} (${p.severity})`).join('; ') + '.',
      });
    }

    if (context.knowledgeEntries.length > 0) {
      sections.push({
        heading: 'Known Facts',
        body: `${context.knowledgeEntries.length} knowledge entries on record, including: ${context.knowledgeEntries.slice(0, 2).map(e => e.statement).join('; ')}.`,
      });
    }

    sections.push({
      heading: 'Assessment',
      body: `Based on available evidence, the situation ${context.patterns.some(p => p.severity === 'critical') ? 'requires immediate attention' : 'warrants monitoring'}. Confidence: ${context.observations.length >= 3 ? 'medium' : 'low'}.`,
    });

    return {
      sections,
      confidence: context.patterns.length >= 2 ? 'medium' : 'low',
    };
  }

  async identifyMissingInformation(
    context: ReasoningContext,
    evidenceChain: EvidenceChain,
  ): Promise<readonly ProviderMissingInformationResult[]> {
    const missing: ProviderMissingInformationResult[] = [];

    if (context.observations.length === 0) {
      missing.push({
        question: 'What are the foundational facts known about this subject?',
        importance: 'high',
        category: 'knowledge',
        whyNeeded: 'Without basic observations, reasoning quality is severely limited.',
        howToObtain: 'Record initial observations through direct interaction or available records.',
      });
    }

    if (context.knowledgeEntries.length === 0) {
      missing.push({
        question: 'Has this subject been assessed for program eligibility?',
        importance: 'medium',
        category: 'knowledge',
        whyNeeded: 'Eligibility status is foundational for care coordination decisions.',
        howToObtain: 'Conduct initial eligibility screening with the appropriate program contacts.',
      });
    }

    if (context.workflowSummaries.length === 0 && context.patterns.length > 0) {
      missing.push({
        question: 'Is there an active intake or care workflow for this subject?',
        importance: 'medium',
        category: 'workflow',
        whyNeeded: 'Active patterns without workflows may indicate coordination gaps.',
        howToObtain: 'Verify workflow status and initiate intake if not already started.',
      });
    }

    return missing;
  }
}

// ─── OpenAI Provider (interface stub — production pending) ────────────────────

export class OpenAIProvider implements ReasoningProvider {
  readonly name = 'openai';
  readonly modelIdentifier: string;

  constructor(modelId = 'gpt-4o') {
    this.modelIdentifier = modelId;
  }

  async generateHypotheses(_ctx: ReasoningContext, _ev: EvidenceChain): Promise<readonly ProviderHypothesisResult[]> {
    throw new Error('OpenAIProvider is not configured for production use in this environment. Set OPENAI_API_KEY and implement the API call.');
  }

  async generateRecommendations(_ctx: ReasoningContext, _hyp: readonly Hypothesis[], _ev: EvidenceChain): Promise<readonly ProviderRecommendationResult[]> {
    throw new Error('OpenAIProvider is not configured for production use in this environment.');
  }

  async generateNarrative(_ctx: ReasoningContext, _type: NarrativeType, _ev: EvidenceChain): Promise<ProviderNarrativeResult> {
    throw new Error('OpenAIProvider is not configured for production use in this environment.');
  }

  async identifyMissingInformation(_ctx: ReasoningContext, _ev: EvidenceChain): Promise<readonly ProviderMissingInformationResult[]> {
    throw new Error('OpenAIProvider is not configured for production use in this environment.');
  }
}

// ─── Anthropic Provider (interface stub — production pending) ─────────────────

export class AnthropicProvider implements ReasoningProvider {
  readonly name = 'anthropic';
  readonly modelIdentifier: string;

  constructor(modelId = 'claude-sonnet-4-6') {
    this.modelIdentifier = modelId;
  }

  async generateHypotheses(_ctx: ReasoningContext, _ev: EvidenceChain): Promise<readonly ProviderHypothesisResult[]> {
    throw new Error('AnthropicProvider is not configured for production use in this environment. Set ANTHROPIC_API_KEY and implement the API call.');
  }

  async generateRecommendations(_ctx: ReasoningContext, _hyp: readonly Hypothesis[], _ev: EvidenceChain): Promise<readonly ProviderRecommendationResult[]> {
    throw new Error('AnthropicProvider is not configured for production use in this environment.');
  }

  async generateNarrative(_ctx: ReasoningContext, _type: NarrativeType, _ev: EvidenceChain): Promise<ProviderNarrativeResult> {
    throw new Error('AnthropicProvider is not configured for production use in this environment.');
  }

  async identifyMissingInformation(_ctx: ReasoningContext, _ev: EvidenceChain): Promise<readonly ProviderMissingInformationResult[]> {
    throw new Error('AnthropicProvider is not configured for production use in this environment.');
  }
}
