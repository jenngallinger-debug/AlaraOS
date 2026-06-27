/**
 * Alara OS — M1b Policy Modules
 *
 * All five policy modules implement the PolicyModule interface
 * and load into the Rules Engine via RulesRegistry.registerPolicyModule().
 *
 * Load order (by priority):
 *   1  DataIntegrityHumanReviewPolicyModule (priority 1)
 *   2  EMRBoundaryPolicyModule              (priority 2)
 *   5  AIActConstraintPolicyModule           (priority 5)
 *   20 ConsentPolicyModule                  (priority 20)
 *   30 ParticipationPolicyModule            (priority 30)
 */

export * from './context-types';
export { ConsentPolicyModule } from './consent-policy';
export { ParticipationPolicyModule } from './participation-policy';
export { AIActConstraintPolicyModule } from './ai-act-policy';
export { EMRBoundaryPolicyModule } from './emr-boundary-policy';
export { DataIntegrityHumanReviewPolicyModule } from './data-integrity-policy';
// Consent authority (who may grant/withdraw consent) — wired explicitly by the
// consent authorizer for the consent-capture rule set; NOT in the M1b auto-load set.
export { ConsentAuthorityPolicyModule, CONSENT_CAPTURE_RULESET } from './consent-authority-policy';
// Identity review (ambiguous/conflicting/PHI-risk identity → human) — wired explicitly
// for the identity-review rule set; always-registered, NOT in the M1b auto-load set.
export { IdentityReviewPolicyModule, IDENTITY_REVIEW_RULESET } from './identity-review-policy';

import { RulesRegistry } from '../registry';
import { ConsentPolicyModule } from './consent-policy';
import { ParticipationPolicyModule } from './participation-policy';
import { AIActConstraintPolicyModule } from './ai-act-policy';
import { EMRBoundaryPolicyModule } from './emr-boundary-policy';
import { DataIntegrityHumanReviewPolicyModule } from './data-integrity-policy';

/** M1b policy modules — load all into a registry */
export const M1B_POLICY_MODULES = [
  DataIntegrityHumanReviewPolicyModule, // priority 1
  EMRBoundaryPolicyModule,              // priority 2
  AIActConstraintPolicyModule,          // priority 5
  ConsentPolicyModule,                  // priority 20
  ParticipationPolicyModule,            // priority 30
];

/** Register all M1b policy modules into a registry */
export function registerM1bPolicies(registry: RulesRegistry): void {
  for (const module of M1B_POLICY_MODULES) {
    registry.registerPolicyModule(module);
  }
}
