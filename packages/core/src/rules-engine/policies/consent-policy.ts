/**
 * Alara OS — Consent Policy Module
 *
 * Implements BD-014: Consent governs whether an actor may perform a
 * specific permission type on a specific subject.
 *
 * BD-014 owns: scope · subject · grantor · recipient · permission type ·
 *              effective/expiration dates · revocation · versioning ·
 *              audit · evidence reference.
 *
 * BD-014 does NOT own: workflow state · relationship health ·
 *                       clinical truth · communications content ·
 *                       AI authority policy.
 *
 * RULE CHAIN (in priority order):
 *   1. Missing consent fact → DENY (consent required but not provided)
 *   2. Consent revoked → DENY
 *   3. Consent expired → DENY
 *   4. Consent pending → DENY (not yet active)
 *   5. Permission type not in consent scope → DENY
 *   6. Recipient mismatch → DENY
 *   7. All checks pass → ALLOW
 */

import { PolicyEvaluation, PolicyModule, RuleContext } from '../types';
import { ConsentFact, ConsentPermissionType } from './context-types';

// ─── Supported rule sets ──────────────────────────────────────────────────────

const RULE_SETS = [
  'ruleset.intake',
  'ruleset.external.sync',
  'ruleset.visit.completed',
  'ruleset.promise.tracking',
];

// ─── Module ───────────────────────────────────────────────────────────────────

export const ConsentPolicyModule: PolicyModule = {
  id: 'policy.consent',
  name: 'Consent Policy (BD-014)',
  version: '1.0.0',
  priority: 20, // after DataIntegrity (priority 1) but before participation (30)
  ruleSetIds: RULE_SETS,

  evaluate(context: RuleContext): PolicyEvaluation {
    const consent = context.objects['consent'] as ConsentFact | undefined;
    const requiredPermission = context.metadata?.['requiredPermission'] as ConsentPermissionType | undefined;

    // ── Rule 1: Consent fact must be present ──────────────────────────────────
    if (!consent) {
      return deny(this.id, 'consent.missing',
        'Consent Missing',
        'No consent record provided in context. Access requires explicit consent.',
      );
    }

    // ── Rule 2: Revocation check ───────────────────────────────────────────────
    if (consent.status === 'revoked' || consent.revokedAt) {
      return deny(this.id, 'consent.revoked',
        'Consent Revoked',
        `Consent ${consent.consentId} was revoked at ${consent.revokedAt}. ` +
        'Alara must gate all future access and may not un-disclose already-delivered information.',
      );
    }

    // ── Rule 3: Expiration check ───────────────────────────────────────────────
    if (consent.expirationDate) {
      const expired = new Date(consent.expirationDate) < new Date();
      if (expired) {
        return deny(this.id, 'consent.expired',
          'Consent Expired',
          `Consent ${consent.consentId} expired on ${consent.expirationDate}.`,
        );
      }
    }

    // ── Rule 4: Status must be active ─────────────────────────────────────────
    if (consent.status !== 'active') {
      return deny(this.id, 'consent.not-active',
        'Consent Not Active',
        `Consent ${consent.consentId} has status "${consent.status}". Only active consent permits access.`,
      );
    }

    // ── Rule 5: Recipient must match actor ────────────────────────────────────
    if (consent.recipientId !== context.actor && consent.recipientId !== '*') {
      return deny(this.id, 'consent.recipient-mismatch',
        'Consent Recipient Mismatch',
        `Consent ${consent.consentId} is granted to "${consent.recipientId}" ` +
        `but actor is "${context.actor}".`,
      );
    }

    // ── Rule 6: Permission type must be in scope (if required) ────────────────
    if (requiredPermission && !consent.permissionTypes.includes(requiredPermission)) {
      return deny(this.id, 'consent.permission-not-in-scope',
        'Permission Not in Consent Scope',
        `Consent ${consent.consentId} covers [${consent.permissionTypes.join(', ')}] ` +
        `but "${requiredPermission}" is required.`,
      );
    }

    // ── All checks passed ─────────────────────────────────────────────────────
    return allow(this.id, 'consent.valid',
      'Consent Valid',
      `Consent ${consent.consentId} is active, covers the required permission, ` +
      `and matches the requesting actor.`,
    );
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deny(
  moduleId: string,
  ruleId: string,
  ruleName: string,
  reason: string,
): PolicyEvaluation {
  return {
    moduleId,
    outcome: 'DENY',
    appliedRules: [{ ruleId, ruleName, outcome: 'DENY', reason }],
    skippedRules: [],
    actions: [],
    reasoning: reason,
  };
}

function allow(
  moduleId: string,
  ruleId: string,
  ruleName: string,
  reason: string,
): PolicyEvaluation {
  return {
    moduleId,
    outcome: 'ALLOW',
    appliedRules: [{ ruleId, ruleName, outcome: 'ALLOW', reason }],
    skippedRules: [],
    actions: [],
    reasoning: reason,
  };
}
