/**
 * Alara OS — Prompt Assembler
 *
 * Assembles canonical evidence into a ReasoningContext for the provider.
 * The provider NEVER queries the database directly.
 * All data is assembled here and passed as a structured context object.
 *
 * ADR-001: No clinical content in assembled context.
 * ADR-015: Context is read-only input to the provider.
 */

import { DetectedPattern } from '../organizational-brain/types';
import { KnowledgeEntry, Observation } from '../knowledge-engine/types';
import { EvidenceChain, ReasoningContext } from './types';

// ─── Clinical content guard (ADR-001) ─────────────────────────────────────────

const CLINICAL_KEYS = new Set([
  'visitNotes', 'clinicalNotes', 'assessmentText', 'planOfCare', 'orderContent',
  'diagnosisCode', 'icd10', 'procedureCode', 'cpt', 'medications_full', 'oasis',
]);

function stripClinical(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!CLINICAL_KEYS.has(k)) cleaned[k] = v;
  }
  return cleaned;
}

// ─── Assembler ────────────────────────────────────────────────────────────────

export interface AssemblerInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly patterns: readonly DetectedPattern[];
  readonly knowledgeEntries: readonly KnowledgeEntry[];
  readonly observations: readonly Observation[];
  readonly objectAttributes: Record<string, unknown>;
  readonly externalReferences: readonly { system: string; extType: string; value: string }[];
  readonly workflowSummaries: readonly { workflowId: string; templateId: string; status: string }[];
  readonly recentEventTypes: readonly string[];
}

export function assembleContext(input: AssemblerInput): ReasoningContext {
  return {
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    patterns: input.patterns,
    knowledgeEntries: input.knowledgeEntries,
    observations: input.observations,
    // ADR-001: strip clinical content from object attributes
    objectAttributes: stripClinical(input.objectAttributes),
    externalReferences: input.externalReferences,
    workflowSummaries: input.workflowSummaries,
    // Event types only — no clinical payloads
    recentEventTypes: input.recentEventTypes,
  };
}

export function buildEvidenceChain(
  input: AssemblerInput,
  rationale: string,
): EvidenceChain {
  return {
    patternIds: input.patterns.map(p => String(p.id)),
    knowledgeEntryIds: input.knowledgeEntries.map(e => String(e.id)),
    observationIds: input.observations.map(o => String(o.id)),
    relationshipIds: [],
    objectIds: [input.subjectId],
    eventIds: [],
    rationale,
  };
}
