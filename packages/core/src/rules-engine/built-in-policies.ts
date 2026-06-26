/**
 * Alara OS — Example Policy Modules
 *
 * These modules illustrate the PolicyModule interface and serve as the
 * built-in baseline until BD-014 (Consent) and ADR-014 (Participation)
 * are ratified and loaded as production modules in M1b.
 *
 * They are intentionally simple — they prove the interface works, not
 * encode production policy.
 */

import {
  ActionType,
  AppliedRule,
  PolicyEvaluation,
  PolicyModule,
  RecommendedAction,
  RuleContext,
} from './types';
import { requiresHumanApproval } from './engine';

// ─── Helper ───────────────────────────────────────────────────────────────────

function action(
  type: ActionType,
  payload: Record<string, unknown>,
  rationale: string,
): RecommendedAction {
  return { type, payload, rationale, requiresHumanApproval: requiresHumanApproval(type) };
}

function applied(ruleId: string, ruleName: string, outcome: 'ALLOW' | 'DENY' | 'REQUIRE_HUMAN', reason: string): AppliedRule {
  return { ruleId, ruleName, outcome, reason };
}

// ─── Module 1: Intake Gate ────────────────────────────────────────────────────
// Applies to ruleset.intake (triggered by PatientCreated / ReferralObserved).
// Validates that required fields are present before the intake workflow is opened.

export const IntakeGatePolicyModule: PolicyModule = {
  id: 'policy.intake-gate',
  name: 'Intake Gate Policy',
  version: '1.0.0',
  priority: 10,
  ruleSetIds: ['ruleset.intake'],

  evaluate(context: RuleContext): PolicyEvaluation {
    const payload = context.eventPayload;
    const attrs = (payload.attributes ?? {}) as Record<string, unknown>;

    const rules: AppliedRule[] = [];
    const actions: RecommendedAction[] = [];

    // Rule 1: Object must be a Patient
    if (payload.objectType !== 'Patient' && context.eventType !== 'AutomyndReferralObserved') {
      rules.push(applied('intake.type-check', 'Object type check', 'DENY',
        `Expected Patient or referral; got ${String(payload.objectType)}`));
      return { moduleId: this.id, outcome: 'DENY', appliedRules: rules, skippedRules: [], actions, reasoning: 'Non-patient object reached intake gate.' };
    }
    rules.push(applied('intake.type-check', 'Object type check', 'ALLOW', 'Object is a Patient or referral.'));

    // Rule 2: Tenant must match
    if (!context.tenantId) {
      rules.push(applied('intake.tenant-check', 'Tenant check', 'DENY', 'Missing tenantId'));
      return { moduleId: this.id, outcome: 'DENY', appliedRules: rules, skippedRules: [], actions, reasoning: 'Missing tenantId.' };
    }
    rules.push(applied('intake.tenant-check', 'Tenant check', 'ALLOW', 'Tenant present.'));

    // Rule 3: Recommend creating intake workflow
    actions.push(action('CREATE_WORKFLOW', {
      type: 'IntakeWorkflow',
      forObject: payload.objectType,
      triggeredBy: context.eventType,
    }, 'Every new patient requires an intake workflow.'));

    // Rule 4: Assign to available Care Guide (placeholder — real impl queries roster)
    actions.push(action('ASSIGN_TASK', {
      taskType: 'IntakeReview',
      assignTo: 'care-guide-pool',
    }, 'Intake review requires human Care Guide assignment.'));

    return {
      moduleId: this.id,
      outcome: 'ALLOW',
      appliedRules: rules,
      skippedRules: [],
      actions,
      reasoning: 'All intake gate rules passed. Intake workflow recommended.',
    };
  },
};

// ─── Module 2: Data Integrity Policy ─────────────────────────────────────────
// Applies to ruleset.data.integrity (triggered by DataIntegrityFlagged).
// Per ADR-001: Alara NEVER overwrites Automynd. Conflicts route to humans.

export const DataIntegrityPolicyModule: PolicyModule = {
  id: 'policy.data-integrity',
  name: 'Data Integrity Policy (ADR-001)',
  version: '1.0.0',
  priority: 1, // highest — data integrity always evaluated first
  ruleSetIds: ['ruleset.data.integrity'],

  evaluate(context: RuleContext): PolicyEvaluation {
    const payload = context.eventPayload;
    const rules: AppliedRule[] = [];

    // Rule: ALL data integrity conflicts require human resolution
    // ADR-001: "Alara may detect/flag/route/monitor; may NOT overwrite/amend/become SoT"
    rules.push(applied(
      'data-integrity.always-human',
      'Data conflicts always require human resolution',
      'REQUIRE_HUMAN',
      `Conflict detected: ${JSON.stringify(payload.conflictDetails ?? {})}. Automynd remains SoR.`,
    ));

    const actions: RecommendedAction[] = [
      action('FLAG_FOR_HUMAN', {
        conflictType: payload.conflictType,
        conflictDetails: payload.conflictDetails,
        objectId: payload.objectId,
        system: 'Automynd',
        rule: 'ADR-001: Alara is not the clinical SoR. Human must reconcile.',
      }, 'ADR-001 requires human reconciliation of all data conflicts.'),
    ];

    return {
      moduleId: this.id,
      outcome: 'REQUIRE_HUMAN',
      appliedRules: rules,
      skippedRules: [],
      actions,
      reasoning: 'ADR-001: All data integrity conflicts route to human review. AI may not resolve these autonomously.',
    };
  },
};

// ─── Module 3: Default Allow ───────────────────────────────────────────────
// Catch-all for rule sets that haven't loaded a specific policy yet.
// Allows with NO actions — safe default for non-sensitive events.

export const DefaultAllowPolicyModule: PolicyModule = {
  id: 'policy.default-allow',
  name: 'Default Allow (no-op)',
  version: '1.0.0',
  priority: 999, // always last
  ruleSetIds: ['*'], // applies to all rule sets

  evaluate(context: RuleContext): PolicyEvaluation {
    return {
      moduleId: this.id,
      outcome: 'ALLOW',
      appliedRules: [{
        ruleId: 'default.allow',
        ruleName: 'Default Allow',
        outcome: 'ALLOW',
        reason: `No specific policy loaded for rule set "${context.ruleSetId}". Defaulting to ALLOW with no actions.`,
      }],
      skippedRules: [],
      actions: [],
      reasoning: 'Default allow policy — no domain-specific policy loaded.',
    };
  },
};

export const BUILT_IN_POLICY_MODULES: PolicyModule[] = [
  IntakeGatePolicyModule,
  DataIntegrityPolicyModule,
  DefaultAllowPolicyModule,
];

export const BUILT_IN_RULE_SETS = [
  { id: 'ruleset.intake',             name: 'Intake',              description: 'Patient intake evaluation.',         version: '1.0.0' },
  { id: 'ruleset.workflow.assignment', name: 'Workflow Assignment', description: 'Workflow ownership + notification.', version: '1.0.0' },
  { id: 'ruleset.promise.tracking',   name: 'Promise Tracking',    description: 'Promise creation + deadline.',       version: '1.0.0' },
  { id: 'ruleset.visit.completed',    name: 'Visit Completed',     description: 'Post-visit evaluation.',             version: '1.0.0' },
  { id: 'ruleset.data.integrity',     name: 'Data Integrity',      description: 'ADR-001 data conflict routing.',     version: '1.0.0' },
  { id: 'ruleset.external.sync',      name: 'External Sync',       description: 'ExternalReference sync evaluation.', version: '1.0.0' },
];
