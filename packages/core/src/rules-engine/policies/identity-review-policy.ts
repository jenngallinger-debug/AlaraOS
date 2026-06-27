/**
 * Alara OS — Identity Review Policy Module
 *
 * The decision authority for the `ruleset.identity.review` rule set
 * (docs/architecture/identity-resolution-spec.md §5, §5.1). It answers ONE
 * question: "May this proposed identity-resolution action proceed automatically,
 * or must a human adjudicate it?" — reusing the RulesEngine `REQUIRE_HUMAN`
 * mechanism (NOT the DataIntegrityFact shape).
 *
 * RULE CHAIN (fail closed):
 *   1. No identity-conflict fact in context → REQUIRE_HUMAN (a missing fact is a
 *      programming error; never silently allow an identity action).
 *   2. PHI-bearing risk (e.g. a merge combining protected records) → REQUIRE_HUMAN.
 *   3. Any conflicting evidence present → REQUIRE_HUMAN.
 *   4. Multiple candidates (ambiguous identity) → REQUIRE_HUMAN.
 *   5. Proposed classification POSSIBLE_MATCH_REVIEW_REQUIRED → REQUIRE_HUMAN.
 *   6. Otherwise (clean MATCH / NO_MATCH / INSUFFICIENT_EVIDENCE) → ALLOW.
 *
 * IMPORTANT (spec §5.1): this module MUST be registered for its rule set at
 * startup. The RulesEngine default-ALLOWs when no policy is registered for a rule
 * set, so an unregistered identity-review rule set fails OPEN. Use
 * `registerIdentityReviewPolicies` / `createIdentityReviewRulesEngine` so the gate
 * is always present.
 */

import { PolicyEvaluation, PolicyModule, RuleContext } from '../types';
import { IdentityConflictFact } from './context-types';

export const IDENTITY_REVIEW_RULESET = 'ruleset.identity.review';

export const IdentityReviewPolicyModule: PolicyModule = {
  id: 'policy.identity.review',
  name: 'Identity Review Policy (ambiguous/conflicting/PHI-risk → human)',
  version: '1.0.0',
  priority: 10,
  ruleSetIds: [IDENTITY_REVIEW_RULESET],

  evaluate(context: RuleContext): PolicyEvaluation {
    const fact = context.objects['identityConflict'] as IdentityConflictFact | undefined;

    // Fail closed: an identity-review evaluation with no fact must not auto-allow.
    if (!fact) {
      return requireHuman(this.id, 'identity.review.missing-fact', 'Identity Review — Missing Fact',
        'No identity-conflict fact in context; identity authority cannot be established. Fail closed.');
    }

    if (fact.phiRisk) {
      return requireHuman(this.id, 'identity.review.phi-risk', 'Identity Review — PHI Risk',
        'Proposed action carries PHI-bearing merge risk; a human must adjudicate before any combination of protected records.');
    }

    if (fact.conflictingEvidence.length > 0) {
      const detail = fact.conflictingEvidence.map(c => `${c.field}:${c.code}`).join(', ');
      return requireHuman(this.id, 'identity.review.conflict', 'Identity Review — Conflicting Evidence',
        `Conflicting identity evidence (${detail}); a human must reconcile before resolving identity.`);
    }

    if (fact.candidateIds.length > 1) {
      return requireHuman(this.id, 'identity.review.multiple-candidates', 'Identity Review — Multiple Candidates',
        `${fact.candidateIds.length} candidate persons match; ambiguous identity requires human review.`);
    }

    if (fact.proposedClassification === 'POSSIBLE_MATCH_REVIEW_REQUIRED') {
      return requireHuman(this.id, 'identity.review.possible-match', 'Identity Review — Possible Match',
        'Proposed classification is POSSIBLE_MATCH_REVIEW_REQUIRED; human review required.');
    }

    // Clean MATCH (single, no conflict), NO_MATCH (safe create), or INSUFFICIENT_EVIDENCE
    // (handled at intake, not a merge) → no human adjudication needed by this gate.
    return allow(this.id, 'identity.review.clean', 'Identity Review — Clean',
      `Proposed classification "${fact.proposedClassification}" with no conflict, ambiguity, or PHI risk; may proceed without identity review.`);
  },
};

function requireHuman(moduleId: string, ruleId: string, ruleName: string, reason: string): PolicyEvaluation {
  return {
    moduleId, outcome: 'REQUIRE_HUMAN',
    appliedRules: [{ ruleId, ruleName, outcome: 'REQUIRE_HUMAN', reason }],
    skippedRules: [],
    actions: [{
      type: 'FLAG_FOR_HUMAN',
      payload: { gate: 'identity.review', ruleId },
      rationale: reason,
      requiresHumanApproval: true,
    }],
    reasoning: reason,
  };
}

function allow(moduleId: string, ruleId: string, ruleName: string, reason: string): PolicyEvaluation {
  return {
    moduleId, outcome: 'ALLOW',
    appliedRules: [{ ruleId, ruleName, outcome: 'ALLOW', reason }],
    skippedRules: [], actions: [], reasoning: reason,
  };
}
