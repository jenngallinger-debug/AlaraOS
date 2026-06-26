/**
 * Alara OS — EMR Boundary Policy Module
 *
 * Implements ADR-001: Automynd = Clinical SoR. AlaraOS = Operational Intelligence.
 *
 * AlaraOS never:
 *   - duplicates clinical documentation
 *   - writes to Automynd / any external clinical system
 *   - becomes the source of truth for clinical content
 *   - stores clinical visit notes, orders, assessments, or POC content
 *
 * RULE CHAIN:
 *   1. No EMR boundary fact → skip (module doesn't apply)
 *   2. Would write to external system → DENY
 *   3. Would duplicate clinical content → DENY
 *   4. Accessing clinical documentation category directly → DENY
 *   5. Operational reference access → ALLOW
 */

import { PolicyEvaluation, PolicyModule, RuleContext } from '../types';
import { EMRBoundaryFact } from './context-types';

const CLINICAL_CATEGORIES: EMRBoundaryFact['dataCategory'][] = [
  'clinical_documentation',
  'visit_record',
  'order',
  'plan_of_care',
  'assessment',
];

const RULE_SETS = ['ruleset.external.sync', 'ruleset.data.integrity', 'ruleset.intake'];

export const EMRBoundaryPolicyModule: PolicyModule = {
  id: 'policy.emr-boundary',
  name: 'EMR Boundary Policy (ADR-001)',
  version: '1.0.0',
  priority: 2, // very high — boundary enforcement is near-first
  ruleSetIds: RULE_SETS,

  evaluate(context: RuleContext): PolicyEvaluation {
    const boundary = context.objects['emrBoundary'] as EMRBoundaryFact | undefined;

    // Module doesn't apply without EMR boundary fact
    if (!boundary) {
      return passThrough(this.id);
    }

    // ── Rule 1: Never write to external system ────────────────────────────────
    if (boundary.wouldWriteToExternalSystem) {
      return {
        moduleId: this.id,
        outcome: 'DENY',
        appliedRules: [{
          ruleId: 'emr.no-write-to-external',
          ruleName: 'No Write to External Clinical System (ADR-001)',
          outcome: 'DENY',
          reason: `AlaraOS must not write to "${boundary.externalSystem}". ` +
            `${boundary.externalSystem} is the clinical System of Record. ` +
            'AlaraOS is the Operational System of Intelligence. Write is prohibited.',
        }],
        skippedRules: [],
        actions: [{
          type: 'FLAG_FOR_HUMAN',
          payload: {
            externalSystem: boundary.externalSystem,
            rule: 'ADR-001: AlaraOS never writes to the clinical SoR.',
          },
          rationale: 'Writing to the clinical SoR is a hard architectural boundary.',
          requiresHumanApproval: true,
        }],
        reasoning: 'ADR-001 violation: attempted write to external clinical system.',
      };
    }

    // ── Rule 2: Never duplicate clinical content ───────────────────────────────
    if (boundary.wouldDuplicateClinicalContent) {
      return {
        moduleId: this.id,
        outcome: 'DENY',
        appliedRules: [{
          ruleId: 'emr.no-duplicate-clinical',
          ruleName: 'No Clinical Content Duplication (ADR-001)',
          outcome: 'DENY',
          reason: 'AlaraOS must not duplicate clinical documentation. ' +
            'AlaraOS stores operational intelligence, not clinical records. ' +
            'Use Document References only (Timeline uses Document References, never clinical content).',
        }],
        skippedRules: [],
        actions: [],
        reasoning: 'ADR-001 violation: attempted clinical content duplication.',
      };
    }

    // ── Rule 3: Clinical category requires operational reference pattern only ─
    if (CLINICAL_CATEGORIES.includes(boundary.dataCategory)) {
      return {
        moduleId: this.id,
        outcome: 'DENY',
        appliedRules: [{
          ruleId: 'emr.clinical-category-reference-only',
          ruleName: 'Clinical Category: Reference Pattern Only (ADR-001)',
          outcome: 'DENY',
          reason: `Data category "${boundary.dataCategory}" is a clinical record category. ` +
            'AlaraOS may track existence and operational status via ExternalReference, ' +
            'but must not store clinical content. Use the ExternalReference pattern.',
        }],
        skippedRules: [],
        actions: [],
        reasoning: `ADR-001: "${boundary.dataCategory}" is clinical content. Use ExternalReference.`,
      };
    }

    // ── Operational reference → ALLOW ─────────────────────────────────────────
    return {
      moduleId: this.id,
      outcome: 'ALLOW',
      appliedRules: [{
        ruleId: 'emr.operational-reference-allowed',
        ruleName: 'Operational Reference Permitted (ADR-001)',
        outcome: 'ALLOW',
        reason: `Data category "${boundary.dataCategory}" is an operational reference — not clinical content. ` +
          'ExternalReference pattern applies. No clinical duplication.',
      }],
      skippedRules: [],
      actions: [],
      reasoning: 'EMR boundary check passed. Operational reference access is permitted.',
    };
  },
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function passThrough(moduleId: string): PolicyEvaluation {
  return {
    moduleId,
    outcome: 'ALLOW',
    appliedRules: [{
      ruleId: 'emr.not-applicable',
      ruleName: 'EMR Boundary Not Applicable',
      outcome: 'ALLOW',
      reason: 'No EMR boundary fact in context. Module does not apply.',
    }],
    skippedRules: [],
    actions: [],
    reasoning: 'No EMR boundary context — module passes through.',
  };
}
