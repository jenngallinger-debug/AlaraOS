/**
 * Alara OS — Read Authorization Boundary for Reality Understanding (M9)
 *
 * Implementation pin (frozen, docs/architecture/implementation-pins.md #6):
 *   "Authorization must gate Graph reads before Reality Understanding sees data."
 *
 * The Reasoning Engine never reads the graph itself — it consumes a
 * ReasoningContext assembled from evidence (patterns, knowledge, observations,
 * object attributes). This module is the boundary where that evidence becomes a
 * context: EVERY candidate record passes the EXISTING RetrievalPermissionGate
 * (which reuses the RulesEngine + policy modules) BEFORE it can enter the
 * ReasoningContext. No record an actor may not see can reach evidence assembly,
 * context assembly, Reality Model synthesis, or downstream judgment.
 *
 * Reuse only: RetrievalPermissionGate + RulesEngine + existing policy modules.
 * Invents no permission logic; adds no second policy engine; does not modify
 * reasoning logic. Fail-closed, ALLOW-only: a record is admitted only on an
 * explicit ALLOW. DENY / REQUIRE_HUMAN / DEFER / evaluation error all suppress it.
 */

import { DetectedPattern } from '../organizational-brain/types';
import { KnowledgeEntry, Observation } from '../knowledge-engine/types';
import { AIActionFact } from '../rules-engine/policies/context-types';
import { RetrievalPermissionGate } from '../retrieval-engine/permission-gate';
import { assembleContext, AssemblerInput } from './prompt-assembler';
import { AuthorizationFacts, FactResolver } from './fact-resolver';
import { AuthorizationRequirements, AUTHZ_REQUIRES_KEY } from './read-authorization-policies';
import { ReasoningContext } from './types';

export interface AuthorizedContextOptions {
  readonly actor: string;
  /** Rule set the gate evaluates against (defaults to the retrieval read gate). */
  readonly ruleSetId?: string;
  /** Resolves consent/participation/ai-act facts from canonical state (facts only). */
  readonly resolver?: FactResolver;
  /** Which fact kinds are required for this read; required-but-unresolved fails closed. */
  readonly requires?: AuthorizationRequirements;
  /** The intended AI use for this read (fed to the resolver and the ai-act fact). */
  readonly intendedAiUse?: AIActionFact;
}

export interface AuthorizedContextResult {
  readonly context: ReasoningContext;
  /** Candidate records suppressed by the gate (count only — never the content). */
  readonly deniedCount: number;
  /** True only if the subject object itself was visible to the actor. */
  readonly subjectAuthorized: boolean;
}

/**
 * Assemble a ReasoningContext that contains ONLY evidence the actor is permitted
 * to see. Every record passes the existing RetrievalPermissionGate. If the
 * subject object itself is not visible, all per-subject evidence is dropped
 * (fail-closed) so Reality Understanding receives nothing protected.
 */
export async function assembleAuthorizedContext(
  gate: RetrievalPermissionGate,
  input: AssemblerInput,
  opts: AuthorizedContextOptions,
): Promise<AuthorizedContextResult> {
  const { actor, ruleSetId, resolver, requires, intendedAiUse } = opts;
  let deniedCount = 0;

  // Resolve facts ONCE for (actor, subject, intended AI use). Consent and
  // participation are about the subject/actor, not per evidence record.
  const resolved: AuthorizationFacts = resolver
    ? await resolver.resolve({
        tenantId: input.tenantId,
        actor,
        subjectId: input.subjectId,
        intendedAiUse,
      })
    : {};

  // The record the gate actually evaluates: the candidate record + resolved facts
  // (a record's own attached fact takes precedence) + the requirements envelope.
  // The ORIGINAL record is what enters the reasoning context — this gating
  // envelope never pollutes reasoning input.
  const enrich = (record: Record<string, unknown>): Record<string, unknown> => ({
    ...record,
    consent: record['consent'] ?? resolved.consent,
    participation: record['participation'] ?? resolved.participation,
    aiAction: record['aiAction'] ?? resolved.aiAction ?? intendedAiUse,
    [AUTHZ_REQUIRES_KEY]: requires ?? {},
  });

  const gateRecord = async (record: Record<string, unknown>): Promise<boolean> => {
    const visible = await gate.isVisible({
      tenantId: input.tenantId,
      actor,
      source: 'object',
      record: enrich(record),
      ruleSetId,
    });
    if (!visible) deniedCount += 1;
    return visible;
  };

  // 1. Gate the subject object itself. If the actor cannot see the subject, no
  //    per-subject evidence may reach reasoning.
  const subjectAuthorized = await gateRecord({
    id: input.subjectId,
    type: input.subjectType,
    attributes: input.objectAttributes,
  });

  if (!subjectAuthorized) {
    const empty = assembleContext({
      ...input,
      patterns: [],
      knowledgeEntries: [],
      observations: [],
      objectAttributes: {},
      externalReferences: [],
      workflowSummaries: [],
      recentEventTypes: [],
    });
    return { context: empty, deniedCount, subjectAuthorized: false };
  }

  // 2. Gate each per-subject evidence record independently.
  const patterns: DetectedPattern[] = [];
  for (const p of input.patterns) {
    if (await gateRecord(p as unknown as Record<string, unknown>)) patterns.push(p);
  }
  const knowledgeEntries: KnowledgeEntry[] = [];
  for (const k of input.knowledgeEntries) {
    if (await gateRecord(k as unknown as Record<string, unknown>)) knowledgeEntries.push(k);
  }
  const observations: Observation[] = [];
  for (const o of input.observations) {
    if (await gateRecord(o as unknown as Record<string, unknown>)) observations.push(o);
  }

  // 3. Assemble the context from the AUTHORIZED subset only. Reuses the existing
  //    assembler (which also strips clinical content per ADR-001).
  const context = assembleContext({
    ...input,
    patterns,
    knowledgeEntries,
    observations,
  });

  return { context, deniedCount, subjectAuthorized: true };
}
