/**
 * Alara OS — Consent Authority Policy Module
 *
 * Answers ONE question for the consent capture surface: "May this actor grant or
 * withdraw consent for this subject?" It is the decision authority (evaluated by
 * the RulesEngine) for the `ruleset.consent.capture` rule set — the API handler
 * and ConsentCaptureService never make this decision themselves.
 *
 * Smallest safe rule (documented limitation): authority is granted to
 *   1. the subject themselves (actor === subjectId), or
 *   2. an organizational actor with a sufficient participation role on the subject
 *      (Owner / Actor), as supported by canonical relationship/participation facts.
 * Everything else — including missing actor/subject context — is DENIED (fail closed).
 * Richer representative/guardian modeling is deferred until the graph carries those
 * facts explicitly.
 */

import { PolicyEvaluation, PolicyModule, RuleContext } from '../types';
import { ParticipationFact, ParticipationRole } from './context-types';

export const CONSENT_CAPTURE_RULESET = 'ruleset.consent.capture';

// Organizational roles permitted to grant/withdraw consent on a subject's behalf.
const GRANT_ROLES: ParticipationRole[] = ['Owner', 'Actor'];

export const ConsentAuthorityPolicyModule: PolicyModule = {
  id: 'policy.consent.authority',
  name: 'Consent Authority Policy (who may grant/withdraw consent)',
  version: '1.0.0',
  priority: 10,
  ruleSetIds: [CONSENT_CAPTURE_RULESET],

  evaluate(context: RuleContext): PolicyEvaluation {
    const actor = context.actor;
    const subjectId = context.objects['subjectId'] as string | undefined;
    const participation = context.objects['participation'] as ParticipationFact | undefined;

    // Fail closed: actor or subject context missing/indeterminate.
    if (!actor || !subjectId) {
      return deny(this.id, 'consent.authority.missing-context', 'Consent Authority — Missing Context',
        'Actor or subject context is missing; consent authority cannot be established. Fail closed.');
    }

    // The subject may grant/withdraw their own consent.
    if (actor === subjectId) {
      return allow(this.id, 'consent.authority.self', 'Consent Authority — Self',
        `Actor "${actor}" is the subject and may grant/withdraw their own consent.`);
    }

    // An organizational actor with a sufficient participation role on the subject.
    if (participation && participation.role !== 'None' && GRANT_ROLES.includes(participation.role)) {
      return allow(this.id, 'consent.authority.participation', 'Consent Authority — Participation',
        `Actor "${actor}" has role "${participation.role}" on subject "${subjectId}" — sufficient to grant/withdraw consent.`);
    }

    // Otherwise deny.
    return deny(this.id, 'consent.authority.denied', 'Consent Authority — Denied',
      `Actor "${actor}" is not authorized to grant/withdraw consent for subject "${subjectId}".`);
  },
};

function allow(moduleId: string, ruleId: string, ruleName: string, reason: string): PolicyEvaluation {
  return {
    moduleId, outcome: 'ALLOW',
    appliedRules: [{ ruleId, ruleName, outcome: 'ALLOW', reason }],
    skippedRules: [], actions: [], reasoning: reason,
  };
}

function deny(moduleId: string, ruleId: string, ruleName: string, reason: string): PolicyEvaluation {
  return {
    moduleId, outcome: 'DENY',
    appliedRules: [{ ruleId, ruleName, outcome: 'DENY', reason }],
    skippedRules: [], actions: [], reasoning: reason,
  };
}
