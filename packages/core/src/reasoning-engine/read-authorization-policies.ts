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
 * REQUIRED-FACT SEMANTICS (fact resolution):
 *   The boundary attaches an AuthorizationRequirements envelope to the record
 *   (AUTHZ_REQUIRES_KEY). When a fact kind is REQUIRED but its fact is absent,
 *   absence must NOT become implicit permission:
 *     - consent / participation: delegate with an undefined fact → the real
 *       module DENYs on missing fact (fail closed), reusing its own logic.
 *     - ai-act: the real module treats a missing AI-action as not-applicable
 *       (ALLOW), so the adapter returns REQUIRE_HUMAN when ai-act is required but
 *       unresolved (fail closed). When a fact is present it delegates as normal.
 *   When a fact kind is NOT required and absent, the adapter passes through (it
 *   is not what gates that record); other registered read policies still apply.
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

/** Record key under which the boundary attaches which fact kinds are required. */
export const AUTHZ_REQUIRES_KEY = '__authzRequires';

export interface AuthorizationRequirements {
  readonly consent?: boolean;
  readonly participation?: boolean;
  readonly aiAct?: boolean;
}

function recordOf(context: RuleContext): Record<string, unknown> {
  return (context.objects.record ?? {}) as Record<string, unknown>;
}

function requiresOf(record: Record<string, unknown>): AuthorizationRequirements {
  return (record[AUTHZ_REQUIRES_KEY] as AuthorizationRequirements | undefined) ?? {};
}

function passThrough(moduleId: string, kind: string): PolicyEvaluation {
  return {
    moduleId,
    outcome: 'ALLOW',
    appliedRules: [
      {
        ruleId: `${kind}.not-required`,
        ruleName: `${kind} not required for this read`,
        outcome: 'ALLOW',
        reason: `No ${kind} fact and ${kind} is not required for this read; this adapter does not gate it.`,
      },
    ],
    skippedRules: [],
    actions: [],
    reasoning: `No ${kind} fact and not required — pass through.`,
  };
}

function requireHuman(moduleId: string, kind: string, reason: string): PolicyEvaluation {
  return {
    moduleId,
    outcome: 'REQUIRE_HUMAN',
    appliedRules: [
      { ruleId: `${kind}.required-unresolved`, ruleName: `${kind} required but unresolved`, outcome: 'REQUIRE_HUMAN', reason },
    ],
    skippedRules: [],
    actions: [],
    reasoning: reason,
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
    const consent = record['consent'];
    const required = requiresOf(record).consent === true;
    if (consent === undefined && !required) return passThrough(this.id, 'consent');
    // Required-but-missing delegates with undefined → ConsentPolicyModule DENYs (fail closed).
    return ConsentPolicyModule.evaluate({
      ...context,
      objects: { consent },
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
    const participation = record['participation'];
    const required = requiresOf(record).participation === true;
    if (participation === undefined && !required) return passThrough(this.id, 'participation');
    // Required-but-missing delegates with undefined → ParticipationPolicyModule DENYs.
    return ParticipationPolicyModule.evaluate({
      ...context,
      objects: { participation },
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
    const aiAction = record['aiAction'];
    const required = requiresOf(record).aiAct === true;
    if (aiAction === undefined) {
      if (!required) return passThrough(this.id, 'ai-act');
      // The real module treats a missing AI-action as not-applicable (ALLOW),
      // so fail closed here when ai-act evaluation is required but unresolved.
      return requireHuman(this.id, 'ai-act',
        'AI-Act evaluation required but no AI-action fact could be resolved for this read.');
    }
    return AIActConstraintPolicyModule.evaluate({
      ...context,
      objects: { aiAction },
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
