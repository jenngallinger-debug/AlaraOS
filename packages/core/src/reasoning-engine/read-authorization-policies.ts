/**
 * Alara OS — Read-boundary policy adapters
 *
 * The frozen Consent (BD-014), Participation (ADR-014), and AI-Act (ADR-015)
 * policy modules evaluate specific context shapes (objects.consent,
 * objects.participation, objects.aiAction) on specific rule sets. At the
 * retrieval READ boundary the gate presents the candidate record as
 * objects.record. These adapters bridge the two: they read the relevant fact
 * from the candidate record envelope and DELEGATE to the existing module's
 * evaluate() — reusing the real decision logic. They add no new policy logic and
 * no second policy engine.
 *
 * A deployment registers these for RETRIEVAL_READ_RULESET so that Reality
 * Understanding reads are gated by the same consent / participation / AI-Act
 * rules that govern the rest of the system. A record with no relevant fact
 * attached passes through this adapter (it is not what gates that record); other
 * registered read policies still apply.
 */

import {
  IRulesRegistry,
  PolicyEvaluation,
  PolicyModule,
  RuleContext,
} from '../rules-engine/types';
import { ConsentPolicyModule } from '../rules-engine/policies/consent-policy';
import { ParticipationPolicyModule } from '../rules-engine/policies/participation-policy';
import { AIActConstraintPolicyModule } from '../rules-engine/policies/ai-act-policy';
import { RETRIEVAL_READ_RULESET } from '../retrieval-engine/permission-gate';

function recordOf(context: RuleContext): Record<string, unknown> {
  return (context.objects.record ?? {}) as Record<string, unknown>;
}

function passThrough(moduleId: string, kind: string): PolicyEvaluation {
  return {
    moduleId,
    outcome: 'ALLOW',
    appliedRules: [
      {
        ruleId: `${kind}.not-attached`,
        ruleName: `${kind} fact not attached`,
        outcome: 'ALLOW',
        reason: `No ${kind} fact on this record; this adapter does not gate it.`,
      },
    ],
    skippedRules: [],
    actions: [],
    reasoning: `No ${kind} fact on record — pass through.`,
  };
}

/** Consent at the read boundary — delegates to the real ConsentPolicyModule. */
export const ConsentReadPolicy: PolicyModule = {
  id: 'policy.read.consent',
  name: 'Read Consent Policy (BD-014 @ read boundary)',
  version: '1.0.0',
  priority: 20,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = recordOf(context);
    if (record['consent'] === undefined) return passThrough(this.id, 'consent');
    return ConsentPolicyModule.evaluate({
      ...context,
      objects: { consent: record['consent'] },
      metadata: { ...context.metadata, requiredPermission: 'read' },
    });
  },
};

/** Participation at the read boundary — delegates to ParticipationPolicyModule. */
export const ParticipationReadPolicy: PolicyModule = {
  id: 'policy.read.participation',
  name: 'Read Participation Policy (ADR-014 @ read boundary)',
  version: '1.0.0',
  priority: 30,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = recordOf(context);
    if (record['participation'] === undefined) return passThrough(this.id, 'participation');
    return ParticipationPolicyModule.evaluate({
      ...context,
      objects: { participation: record['participation'] },
      metadata: { ...context.metadata, accessType: 'read' },
    });
  },
};

/** AI-Act constraints at the read boundary — delegates to AIActConstraintPolicyModule. */
export const AIActReadPolicy: PolicyModule = {
  id: 'policy.read.ai-act',
  name: 'Read AI Act Policy (ADR-015 @ read boundary)',
  version: '1.0.0',
  priority: 5,
  ruleSetIds: [RETRIEVAL_READ_RULESET],
  evaluate(context: RuleContext): PolicyEvaluation {
    const record = recordOf(context);
    if (record['aiAction'] === undefined) return passThrough(this.id, 'ai-act');
    return AIActConstraintPolicyModule.evaluate({
      ...context,
      objects: { aiAction: record['aiAction'] },
    });
  },
};

/** The read-boundary policy set, in priority order. */
export const READ_AUTHORIZATION_POLICIES: readonly PolicyModule[] = [
  AIActReadPolicy, // priority 5
  ConsentReadPolicy, // priority 20
  ParticipationReadPolicy, // priority 30
];

/** Register all read-boundary policy adapters into a registry. */
export function registerReadAuthorizationPolicies(registry: IRulesRegistry): void {
  for (const module of READ_AUTHORIZATION_POLICIES) {
    registry.registerPolicyModule(module);
  }
}
