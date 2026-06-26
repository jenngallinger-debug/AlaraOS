/**
 * Alara OS — Reasoning Engine (M9)
 *
 * Orchestrates LLM-assisted reasoning over deterministic inputs.
 *
 * Pipeline:
 *   AssembleContext → Provider.generateHypotheses
 *   → Provider.generateRecommendations
 *   → Rules Engine gate (recommendations only)
 *   → Persist outputs
 *   → Emit canonical events
 *
 * ADR-003 AI Last: Called only after deterministic logic (M8 Brain) has run.
 * ADR-015: Engine only calls the provider. Provider never queries DB.
 *           Engine never creates workflows, tasks, or communications.
 * Rules Engine gate: every recommendation is evaluated before being marked approved.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { RulesEngine } from '../rules-engine/engine';
import { RuleContext } from '../rules-engine/types';
import { ReasoningProvider } from './providers';
import {
  ConfidenceAssessment,
  EvidenceChain,
  GenerateHypothesesCommand,
  GenerateNarrativeCommand,
  GenerateRecommendationsCommand,
  Hypothesis,
  HypothesisGeneratedPayload,
  HypothesisStatus,
  IdentifyMissingInformationCommand,
  InsufficientEvidenceError,
  MissingInformation,
  MissingInformationIdentifiedPayload,
  Narrative,
  NarrativeGeneratedPayload,
  NarrativeSection,
  Recommendation,
  RecommendationActionType,
  RecommendationApprovedPayload,
  RecommendationGeneratedPayload,
  RecommendationPriority,
  RecommendationRejectedPayload,
  RecommendationStatus,
  ReasoningConfidence,
  ReasoningContext,
} from './types';

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface HypothesisRow {
  id: string; tenant_id: string; subject_id: string; subject_type: string;
  statement: string; rationale: string; evidence: unknown; confidence: unknown;
  alternative_explanations: string[]; category: string; status: string;
  generated_at: string; model_identifier: string; version: number;
}

interface RecommendationRow {
  id: string; tenant_id: string; subject_id: string; subject_type: string;
  title: string; rationale: string; action_type: string; action: unknown;
  evidence: unknown; confidence: unknown; priority: string; status: string;
  rules_engine_approved: boolean | null; rules_engine_explanation: string | null;
  generated_at: string; model_identifier: string; version: number;
}

interface NarrativeRow {
  id: string; tenant_id: string; subject_id: string; subject_type: string;
  narrative_type: string; sections: unknown; evidence: unknown;
  confidence: unknown; generated_at: string; model_identifier: string; version: number;
}

interface MissingInfoRow {
  id: string; tenant_id: string; subject_id: string; subject_type: string;
  question: string; importance: string; category: string;
  why_needed: string; how_to_obtain: string; evidence: unknown;
  status: string; generated_at: string; model_identifier: string; version: number;
}

// ─── Reasoning Engine result ──────────────────────────────────────────────────

export interface ReasoningResult {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly hypotheses: readonly Hypothesis[];
  readonly recommendations: readonly Recommendation[];
  readonly narrative: Narrative | null;
  readonly missingInformation: readonly MissingInformation[];
  readonly eventIds: readonly string[];
}

// ─── Repository (read-only) ───────────────────────────────────────────────────

export class ReasoningRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getHypothesesForSubject(tenantId: string, subjectId: string): Promise<Hypothesis[]> {
    const rows = await this.db.query<HypothesisRow>(
      `SELECT * FROM hypotheses WHERE tenant_id = $1 AND subject_id = $2 ORDER BY generated_at DESC`,
      [tenantId, subjectId],
    );
    return rows.map(rowToHypothesis);
  }

  async getRecommendationsForSubject(tenantId: string, subjectId: string): Promise<Recommendation[]> {
    const rows = await this.db.query<RecommendationRow>(
      `SELECT * FROM recommendations WHERE tenant_id = $1 AND subject_id = $2 ORDER BY generated_at DESC`,
      [tenantId, subjectId],
    );
    return rows.map(rowToRecommendation);
  }

  async getMissingInformationForSubject(tenantId: string, subjectId: string): Promise<MissingInformation[]> {
    const rows = await this.db.query<MissingInfoRow>(
      `SELECT * FROM missing_information WHERE tenant_id = $1 AND subject_id = $2 AND status = 'open' ORDER BY generated_at DESC`,
      [tenantId, subjectId],
    );
    return rows.map(rowToMissingInfo);
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class ReasoningEngine {
  readonly repo: ReasoningRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
    private readonly provider: ReasoningProvider,
    private readonly rules: RulesEngine,
  ) {
    this.repo = new ReasoningRepository(db);
  }

  // ── Generate hypotheses ────────────────────────────────────────────────────

  async generateHypotheses(cmd: GenerateHypothesesCommand): Promise<readonly Hypothesis[]> {
    const { context } = cmd;

    if (context.patterns.length === 0 && context.knowledgeEntries.length === 0) {
      throw new InsufficientEvidenceError(
        context.subjectId,
        'No patterns or knowledge entries available to reason from.',
      );
    }

    const evidenceChain: EvidenceChain = {
      patternIds: context.patterns.map(p => String(p.id)),
      knowledgeEntryIds: context.knowledgeEntries.map(e => String(e.id)),
      observationIds: context.observations.map(o => String(o.id)),
      relationshipIds: [],
      objectIds: [context.subjectId],
      eventIds: [],
      rationale: `Generated from ${context.patterns.length} patterns and ${context.knowledgeEntries.length} knowledge entries.`,
    };

    const results = await this.provider.generateHypotheses(context, evidenceChain);
    const hypotheses: Hypothesis[] = [];

    for (const r of results) {
      const hyp = await this.persistHypothesis(cmd.tenantId, cmd.subjectId, cmd.subjectType, r, evidenceChain);
      hypotheses.push(hyp);

      const payload: HypothesisGeneratedPayload = {
        hypothesisId: String(hyp.id),
        subjectId: cmd.subjectId,
        category: hyp.category,
        confidence: hyp.confidence.overall,
        modelIdentifier: this.provider.modelIdentifier,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: hyp.id,
        type: 'HypothesisGenerated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
      });
    }

    return hypotheses;
  }

  // ── Generate recommendations ───────────────────────────────────────────────

  async generateRecommendations(cmd: GenerateRecommendationsCommand): Promise<readonly Recommendation[]> {
    const { context, hypotheses } = cmd;
    if (hypotheses.length === 0) return [];

    const evidenceChain: EvidenceChain = {
      patternIds: context.patterns.map(p => String(p.id)),
      knowledgeEntryIds: context.knowledgeEntries.map(e => String(e.id)),
      observationIds: context.observations.map(o => String(o.id)),
      relationshipIds: [],
      objectIds: [context.subjectId],
      eventIds: [],
      rationale: `Recommendations derived from ${hypotheses.length} hypotheses.`,
    };

    const results = await this.provider.generateRecommendations(context, hypotheses, evidenceChain);
    const recommendations: Recommendation[] = [];

    for (const r of results) {
      const rec = await this.persistRecommendation(cmd.tenantId, cmd.subjectId, cmd.subjectType, r, evidenceChain);

      const genPayload: RecommendationGeneratedPayload = {
        recommendationId: String(rec.id),
        subjectId: cmd.subjectId,
        actionType: rec.actionType,
        priority: rec.priority,
        modelIdentifier: this.provider.modelIdentifier,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: rec.id,
        type: 'RecommendationGenerated' as EventType,
        payload: genPayload as unknown as Record<string, unknown>,
        actor: cmd.actor,
      });

      // ADR-003 / ADR-015: Rules Engine gate — evaluate before approval
      const ruleContext: RuleContext = {
        tenantId: cmd.tenantId,
        actor: cmd.actor,
        eventType: 'ReasoningRecommendationRequested',
        eventPayload: {
          objectType: cmd.subjectType,
          recommendationId: String(rec.id),
          actionType: rec.actionType,
          priority: rec.priority,
        },
        ruleSetId: 'ruleset.intake',
        objects: {},
        metadata: { accessType: 'read' },
      };

      const decision = await this.rules.evaluate(ruleContext);
      const approved = decision.outcome !== 'DENY';

      // Update recommendation with Rules Engine decision
      await this.db.transaction(async (client) => {
        await client.query(
          `UPDATE recommendations SET rules_engine_approved = $1, rules_engine_explanation = $2, status = $3, version = version + 1
           WHERE id = $4 AND tenant_id = $5`,
          [
            approved,
            decision.explanation.summary,
            approved ? 'approved' : 'rejected',
            rec.id,
            cmd.tenantId,
          ],
        );
      });

      if (approved) {
        const approvedPayload: RecommendationApprovedPayload = {
          recommendationId: String(rec.id),
          rulesEngineDecision: decision.explanation.summary,
        };
        await this.eventStore.append({
          tenantId: cmd.tenantId, streamId: rec.id,
          type: 'RecommendationApproved' as EventType,
          payload: approvedPayload as unknown as Record<string, unknown>,
          actor: cmd.actor,
        });
      } else {
        const rejectedPayload: RecommendationRejectedPayload = {
          recommendationId: String(rec.id),
          rulesEngineDecision: decision.explanation.summary,
          reason: decision.explanation.summary,
        };
        await this.eventStore.append({
          tenantId: cmd.tenantId, streamId: rec.id,
          type: 'RecommendationRejected' as EventType,
          payload: rejectedPayload as unknown as Record<string, unknown>,
          actor: cmd.actor,
        });
      }

      recommendations.push({
        ...rec,
        rulesEngineApproved: approved,
        rulesEngineExplanation: decision.explanation.summary,
        status: (approved ? 'approved' : 'rejected') as RecommendationStatus,
      });
    }

    return recommendations;
  }

  // ── Generate narrative ─────────────────────────────────────────────────────

  async generateNarrative(cmd: GenerateNarrativeCommand): Promise<Narrative> {
    const { context } = cmd;
    const evidenceChain: EvidenceChain = {
      patternIds: context.patterns.map(p => String(p.id)),
      knowledgeEntryIds: context.knowledgeEntries.map(e => String(e.id)),
      observationIds: context.observations.map(o => String(o.id)),
      relationshipIds: [],
      objectIds: [context.subjectId],
      eventIds: [],
      rationale: `Narrative generated for ${cmd.narrativeType}.`,
    };

    const result = await this.provider.generateNarrative(context, cmd.narrativeType, evidenceChain);
    const id = newAlaraId();

    const sections: NarrativeSection[] = result.sections.map(s => ({
      heading: s.heading,
      body: s.body,
      evidenceIds: [],
    }));

    const confidence: ConfidenceAssessment = {
      overall: result.confidence,
      evidenceQuality: result.confidence,
      conflictingEvidence: false,
      conflictSummary: null,
      missingEvidence: [],
      reasoningMethod: 'narrative-generation',
      modelIdentifier: this.provider.modelIdentifier,
      assessedAt: new Date().toISOString(),
    };

    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO narratives (id, tenant_id, subject_id, subject_type, narrative_type, sections, evidence, confidence, model_identifier, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)`,
        [id, cmd.tenantId, cmd.subjectId, cmd.subjectType, cmd.narrativeType,
          JSON.stringify(sections), JSON.stringify(evidenceChain), JSON.stringify(confidence),
          this.provider.modelIdentifier],
      );
    });

    const narrative: Narrative = {
      id, tenantId: cmd.tenantId, subjectId: cmd.subjectId, subjectType: cmd.subjectType,
      narrativeType: cmd.narrativeType, sections, evidence: evidenceChain, confidence,
      generatedAt: new Date().toISOString(), modelIdentifier: this.provider.modelIdentifier, version: 1,
    };

    const payload: NarrativeGeneratedPayload = {
      narrativeId: String(id),
      subjectId: cmd.subjectId,
      narrativeType: cmd.narrativeType,
      modelIdentifier: this.provider.modelIdentifier,
    };
    await this.eventStore.append({
      tenantId: cmd.tenantId, streamId: id,
      type: 'NarrativeGenerated' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: cmd.actor,
    });

    return narrative;
  }

  // ── Identify missing information ───────────────────────────────────────────

  async identifyMissingInformation(cmd: IdentifyMissingInformationCommand): Promise<readonly MissingInformation[]> {
    const { context } = cmd;
    const evidenceChain: EvidenceChain = {
      patternIds: context.patterns.map(p => String(p.id)),
      knowledgeEntryIds: context.knowledgeEntries.map(e => String(e.id)),
      observationIds: context.observations.map(o => String(o.id)),
      relationshipIds: [], objectIds: [context.subjectId], eventIds: [],
      rationale: 'Missing information identification.',
    };

    const results = await this.provider.identifyMissingInformation(context, evidenceChain);
    const items: MissingInformation[] = [];

    for (const r of results) {
      const id = newAlaraId();
      await this.db.transaction(async (client) => {
        await client.query(
          `INSERT INTO missing_information (id, tenant_id, subject_id, subject_type, question, importance, category, why_needed, how_to_obtain, evidence, model_identifier, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
          [id, cmd.tenantId, cmd.subjectId, cmd.subjectType, r.question, r.importance,
            r.category, r.whyNeeded, r.howToObtain, JSON.stringify(evidenceChain),
            this.provider.modelIdentifier],
        );
      });

      const item: MissingInformation = {
        id, tenantId: cmd.tenantId, subjectId: cmd.subjectId, subjectType: cmd.subjectType,
        question: r.question, importance: r.importance, category: r.category,
        whyNeeded: r.whyNeeded, howToObtain: r.howToObtain, evidence: evidenceChain,
        status: 'open', generatedAt: new Date().toISOString(),
        modelIdentifier: this.provider.modelIdentifier, version: 1,
      };
      items.push(item);

      const payload: MissingInformationIdentifiedPayload = {
        missingInformationId: String(id), subjectId: cmd.subjectId,
        importance: r.importance, category: r.category,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId, streamId: id,
        type: 'MissingInformationIdentified' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
      });
    }

    return items;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async persistHypothesis(
    tenantId: string, subjectId: string, subjectType: string,
    r: import('./providers').ProviderHypothesisResult, evidence: EvidenceChain,
  ): Promise<Hypothesis> {
    const id = newAlaraId();
    const confidence: ConfidenceAssessment = {
      overall: r.confidence,
      evidenceQuality: r.confidence,
      conflictingEvidence: r.conflictingEvidence,
      conflictSummary: r.conflictSummary,
      missingEvidence: r.missingEvidence,
      reasoningMethod: 'hypothesis-generation',
      modelIdentifier: this.provider.modelIdentifier,
      assessedAt: new Date().toISOString(),
    };

    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO hypotheses (id, tenant_id, subject_id, subject_type, statement, rationale, evidence, confidence, alternative_explanations, category, status, model_identifier, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,1)`,
        [id, tenantId, subjectId, subjectType, r.statement, r.rationale,
          JSON.stringify(evidence), JSON.stringify(confidence),
          JSON.stringify(r.alternatives.map(a => a.statement)),
          r.category, this.provider.modelIdentifier],
      );
    });

    return {
      id, tenantId, subjectId, subjectType, statement: r.statement, rationale: r.rationale,
      evidence, confidence, alternativeExplanations: r.alternatives.map(a => a.statement),
      category: r.category, status: 'active' as HypothesisStatus,
      generatedAt: new Date().toISOString(), modelIdentifier: this.provider.modelIdentifier, version: 1,
    };
  }

  private async persistRecommendation(
    tenantId: string, subjectId: string, subjectType: string,
    r: import('./providers').ProviderRecommendationResult, evidence: EvidenceChain,
  ): Promise<Recommendation> {
    const id = newAlaraId();
    const confidence: ConfidenceAssessment = {
      overall: r.confidence,
      evidenceQuality: r.confidence,
      conflictingEvidence: false,
      conflictSummary: null,
      missingEvidence: [],
      reasoningMethod: 'recommendation-generation',
      modelIdentifier: this.provider.modelIdentifier,
      assessedAt: new Date().toISOString(),
    };
    const action = {
      type: r.actionType,
      description: r.actionDescription,
      urgency: r.urgency,
      targetId: r.targetId,
      targetType: r.targetType,
    };

    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO recommendations (id, tenant_id, subject_id, subject_type, title, rationale, action_type, action, evidence, confidence, priority, status, model_identifier, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,1)`,
        [id, tenantId, subjectId, subjectType, r.title, r.rationale, r.actionType,
          JSON.stringify(action), JSON.stringify(evidence), JSON.stringify(confidence),
          r.priority, this.provider.modelIdentifier],
      );
    });

    return {
      id, tenantId, subjectId, subjectType, title: r.title, rationale: r.rationale,
      actionType: r.actionType as RecommendationActionType, action,
      evidence, confidence, priority: r.priority as RecommendationPriority,
      status: 'pending' as RecommendationStatus,
      rulesEngineApproved: null, rulesEngineExplanation: null,
      generatedAt: new Date().toISOString(), modelIdentifier: this.provider.modelIdentifier, version: 1,
    };
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToHypothesis(row: HypothesisRow): Hypothesis {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, subjectId: row.subject_id,
    subjectType: row.subject_type, statement: row.statement, rationale: row.rationale,
    evidence: row.evidence as EvidenceChain, confidence: row.confidence as ConfidenceAssessment,
    alternativeExplanations: row.alternative_explanations ?? [],
    category: row.category as import('../organizational-brain/types').PatternCategory,
    status: row.status as HypothesisStatus, generatedAt: row.generated_at,
    modelIdentifier: row.model_identifier, version: row.version,
  };
}

function rowToRecommendation(row: RecommendationRow): Recommendation {
  const action = row.action as Recommendation['action'];
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, subjectId: row.subject_id,
    subjectType: row.subject_type, title: row.title, rationale: row.rationale,
    actionType: row.action_type as RecommendationActionType, action,
    evidence: row.evidence as EvidenceChain, confidence: row.confidence as ConfidenceAssessment,
    priority: row.priority as RecommendationPriority, status: row.status as RecommendationStatus,
    rulesEngineApproved: row.rules_engine_approved, rulesEngineExplanation: row.rules_engine_explanation,
    generatedAt: row.generated_at, modelIdentifier: row.model_identifier, version: row.version,
  };
}

function rowToMissingInfo(row: MissingInfoRow): MissingInformation {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, subjectId: row.subject_id,
    subjectType: row.subject_type, question: row.question,
    importance: row.importance as MissingInformation['importance'],
    category: row.category as import('../organizational-brain/types').PatternCategory,
    whyNeeded: row.why_needed, howToObtain: row.how_to_obtain,
    evidence: row.evidence as EvidenceChain, status: row.status as MissingInformation['status'],
    generatedAt: row.generated_at, modelIdentifier: row.model_identifier, version: row.version,
  };
}
