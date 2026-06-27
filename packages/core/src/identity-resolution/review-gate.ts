/**
 * Alara OS — Identity Review Gate (Phase 3)
 *
 * Bridges a matcher result (IdentityResolutionResult) to the RulesEngine identity
 * review decision (docs/architecture/identity-resolution-spec.md §5). It builds the
 * canonical IdentityConflictFact and delegates the ALLOW vs REQUIRE_HUMAN decision to
 * the IdentityReviewPolicyModule — the gate holds NO authorization logic itself.
 *
 * The factory ALWAYS registers the identity-review policy on its rule set, so the gate
 * cannot accidentally fail open (the RulesEngine default-ALLOWs an unregistered rule
 * set — spec §5.1).
 */

import { RulesEngine, RulesRegistry, NoopAuditSink } from '../rules-engine';
import {
  IdentityReviewPolicyModule,
  IDENTITY_REVIEW_RULESET,
} from '../rules-engine/policies/identity-review-policy';
import { IdentityConflictFact } from '../rules-engine/policies/context-types';
import { DecisionOutcome } from '../rules-engine/types';
import { IdentityCandidateInput, IdentityResolutionResult } from './types';

/** Options carrying signals the matcher cannot infer on its own (e.g. PHI risk). */
export interface IdentityReviewOptions {
  /** Whether the proposed action would combine/expose protected health information. */
  phiRisk?: boolean;
}

export interface IdentityReviewDecision {
  requiresHuman: boolean;
  outcome: DecisionOutcome;
  reason: string;
}

/** Confidence in a proposed classification (recorded as evidence; 0..1). */
function confidenceFor(result: IdentityResolutionResult): number {
  switch (result.outcome) {
    case 'MATCH': return result.conflicts.length > 0 ? 0.5 : 1;
    case 'NO_MATCH': return 1;
    case 'POSSIBLE_MATCH_REVIEW_REQUIRED': return 0.5;
    case 'INSUFFICIENT_EVIDENCE': return 0;
  }
}

/** Build the canonical identity-conflict fact (spec §5.1) from a matcher result. */
export function buildIdentityConflictFact(
  input: IdentityCandidateInput,
  result: IdentityResolutionResult,
  opts: IdentityReviewOptions = {},
): IdentityConflictFact {
  return {
    proposedClassification: result.outcome,
    subjectInput: {
      externalReferences: input.externalReferences ?? [],
      name: input.name,
      dob: input.dob,
    },
    candidateIds: result.candidateIds,
    conflictingEvidence: result.conflicts.map((c) => ({
      candidateId: c.candidateId,
      field: c.field,
      code: c.code,
    })),
    reasonCodes: result.reasonCodes,
    confidence: confidenceFor(result),
    phiRisk: opts.phiRisk ?? false,
  };
}

export class IdentityReviewGate {
  private readonly engine: RulesEngine;

  constructor(engine?: RulesEngine) {
    this.engine = engine ?? createIdentityReviewRulesEngine();
  }

  /** Decide whether a proposed identity action needs human adjudication. */
  async review(
    input: IdentityCandidateInput,
    result: IdentityResolutionResult,
    opts: IdentityReviewOptions = {},
  ): Promise<IdentityReviewDecision> {
    const fact = buildIdentityConflictFact(input, result, opts);
    const decision = await this.engine.evaluate({
      tenantId: input.tenantId,
      actor: 'system',
      eventType: 'IdentityResolution',
      eventPayload: {},
      ruleSetId: IDENTITY_REVIEW_RULESET,
      objects: { identityConflict: fact },
    });
    return {
      requiresHuman: decision.outcome === 'REQUIRE_HUMAN',
      outcome: decision.outcome,
      reason: decision.explanation.summary,
    };
  }
}

/**
 * Build a RulesEngine with the identity-review rule set and policy ALWAYS registered.
 * Use this rather than constructing an engine by hand so the gate never fails open.
 */
export function createIdentityReviewRulesEngine(): RulesEngine {
  const registry = new RulesRegistry();
  registerIdentityReviewPolicies(registry);
  return new RulesEngine(registry, new NoopAuditSink());
}

/** Register the identity-review rule set + policy module into a registry. */
export function registerIdentityReviewPolicies(registry: RulesRegistry): void {
  registry.registerRuleSet({
    id: IDENTITY_REVIEW_RULESET,
    name: 'Identity Review',
    description: 'Ambiguous, conflicting, or PHI-risk identity resolution requires human review.',
    version: '1.0.0',
  });
  registry.registerPolicyModule(IdentityReviewPolicyModule);
}
