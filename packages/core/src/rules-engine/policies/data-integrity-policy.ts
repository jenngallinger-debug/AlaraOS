/**
 * Alara OS — Data Integrity Human Review Policy Module
 *
 * Governs data integrity conflicts between AlaraOS and Automynd.
 *
 * ADR-001 sub-doctrine: "Alara may detect/flag/route/monitor and suppress
 * unsafe automation on disputed fields. It may NOT overwrite, amend, or
 * become the source of truth. Automynd remains the clinical SoR."
 *
 * This module ALWAYS returns REQUIRE_HUMAN for any data integrity conflict.
 * It is intentionally strict — the one case where the engine has no path to ALLOW.
 *
 * RULE CHAIN:
 *   1. No data integrity fact → skip
 *   2. Any conflict present → REQUIRE_HUMAN with FLAG_FOR_HUMAN + SUPPRESS action
 */

import { PolicyEvaluation, PolicyModule, RuleContext } from '../types';
import { DataIntegrityFact } from './context-types';

const RULE_SETS = ['ruleset.data.integrity'];

export const DataIntegrityHumanReviewPolicyModule: PolicyModule = {
  id: 'policy.data-integrity-human-review',
  name: 'Data Integrity Human Review Policy (ADR-001)',
  version: '1.0.0',
  priority: 1, // highest priority — always evaluated first
  ruleSetIds: RULE_SETS,

  evaluate(context: RuleContext): PolicyEvaluation {
    const conflict = context.objects['dataIntegrity'] as DataIntegrityFact | undefined;

    if (!conflict) {
      return {
        moduleId: this.id,
        outcome: 'ALLOW',
        appliedRules: [{
          ruleId: 'data-integrity.no-conflict',
          ruleName: 'No Data Integrity Conflict',
          outcome: 'ALLOW',
          reason: 'No data integrity conflict in context.',
        }],
        skippedRules: [],
        actions: [],
        reasoning: 'No conflict found. Module passes through.',
      };
    }

    const conflictDetail =
      `Field "${conflict.field}" on object "${conflict.objectId}": ` +
      `Automynd="${String(conflict.externalValue)}", ` +
      `Alara="${String(conflict.alaraValue)}".`;

    return {
      moduleId: this.id,
      outcome: 'REQUIRE_HUMAN',
      appliedRules: [{
        ruleId: 'data-integrity.always-human',
        ruleName: 'Data Integrity Always Requires Human Review (ADR-001)',
        outcome: 'REQUIRE_HUMAN',
        reason:
          `Conflict detected: ${conflictDetail} ` +
          `Conflict type: ${conflict.conflictType}. ` +
          'ADR-001: Alara may not overwrite or become source of truth. ' +
          'Human must reconcile. Automynd remains the clinical SoR.',
      }],
      skippedRules: [],
      actions: [
        {
          type: 'FLAG_FOR_HUMAN',
          payload: {
            conflictType: conflict.conflictType,
            field: conflict.field,
            objectId: conflict.objectId,
            externalSystem: conflict.externalSystem,
            externalValue: conflict.externalValue,
            alaraValue: conflict.alaraValue,
            resolution: 'REQUIRES_HUMAN_RECONCILIATION',
            adR001Note: 'Alara may flag, route, and suppress automation. May not overwrite.',
          },
          rationale: 'ADR-001 mandates human reconciliation for all data integrity conflicts.',
          requiresHumanApproval: true,
        },
        {
          type: 'EMIT_EVENT',
          payload: {
            type: 'AutomationSuppressed',
            reason: 'DataIntegrityConflict',
            objectId: conflict.objectId,
            field: conflict.field,
          },
          rationale: 'Suppress any downstream automation on the conflicted field until reconciled.',
          requiresHumanApproval: false,
        },
      ],
      reasoning:
        `Data integrity conflict requires human review. ${conflictDetail} ` +
        'ADR-001: Alara detected, flagged, and suppressed automation. Human must resolve.',
    };
  },
};
