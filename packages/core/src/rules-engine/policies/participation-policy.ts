/**
 * Alara OS — Participation Policy Module
 *
 * Implements ADR-014: the Participation/Workforce Member model.
 *
 * "Identity is stable. Participation changes."
 * Permissions attach to relationship/context edges, not to the identity node.
 *
 * ROLE PERMISSION MAP:
 *   Actor      → may read, write, own, initiate actions
 *   Owner      → may read, write, assign, archive
 *   Covering   → same as Actor, but access expires at coverageExpiresAt
 *   Stakeholder → may read only; may not write or initiate actions
 *   Informed   → receives output only; may not read raw objects
 *   None       → no access
 *
 * RULE CHAIN:
 *   1. Participation fact missing → DENY
 *   2. Role is None → DENY
 *   3. Covering role expired → DENY
 *   4. Role insufficient for requested access → DENY
 *   5. All checks pass → ALLOW
 */

import { PolicyEvaluation, PolicyModule, RecommendedAction, RuleContext } from '../types';
import { ParticipationFact, ParticipationRole } from './context-types';

const WRITE_ROLES: ParticipationRole[] = ['Actor', 'Owner', 'Covering'];
const READ_ROLES: ParticipationRole[] = ['Actor', 'Owner', 'Covering', 'Stakeholder'];

const RULE_SETS = [
  'ruleset.intake',
  'ruleset.workflow.assignment',
  'ruleset.visit.completed',
  'ruleset.promise.tracking',
  'ruleset.external.sync',
];

export const ParticipationPolicyModule: PolicyModule = {
  id: 'policy.participation',
  name: 'Participation Policy (ADR-014)',
  version: '1.0.0',
  priority: 30,
  ruleSetIds: RULE_SETS,

  evaluate(context: RuleContext): PolicyEvaluation {
    const participation = context.objects['participation'] as ParticipationFact | undefined;
    const accessType = (context.metadata?.['accessType'] as 'read' | 'write') ?? 'read';

    // ── Rule 1: Participation fact required ───────────────────────────────────
    if (!participation) {
      return deny(this.id, 'participation.missing',
        'Participation Missing',
        'No participation record in context. Actor must have a defined role on this object.',
      );
    }

    // ── Rule 2: None role → always deny ───────────────────────────────────────
    if (participation.role === 'None') {
      return deny(this.id, 'participation.no-role',
        'No Participation Role',
        `Actor "${context.actor}" has role "None" on object "${participation.objectId}". Access denied.`,
      );
    }

    // ── Rule 3: Covering role expiry ──────────────────────────────────────────
    if (participation.role === 'Covering' && participation.coverageExpiresAt) {
      const expired = new Date(participation.coverageExpiresAt) < new Date();
      if (expired) {
        return deny(this.id, 'participation.coverage-expired',
          'Coverage Expired',
          `Covering access for actor "${context.actor}" expired at ${participation.coverageExpiresAt}.`,
        );
      }
    }

    // ── Rule 4: Role must be sufficient for the access type ───────────────────
    if (accessType === 'write' && !WRITE_ROLES.includes(participation.role)) {
      return deny(this.id, 'participation.insufficient-role',
        'Insufficient Role for Write',
        `Role "${participation.role}" does not permit write access. ` +
        `Write requires one of: ${WRITE_ROLES.join(', ')}.`,
      );
    }

    if (accessType === 'read' && !READ_ROLES.includes(participation.role)) {
      return deny(this.id, 'participation.insufficient-role',
        'Insufficient Role for Read',
        `Role "${participation.role}" does not permit read access.`,
      );
    }

    // ── Allow: build context-appropriate actions ───────────────────────────────
    const actions: RecommendedAction[] = [];
    if (participation.role === 'Covering') {
      actions.push({
        type: 'EMIT_EVENT',
        payload: {
          type: 'CoveringAccessUsed',
          workforceMemberId: participation.workforceMemberId,
          objectId: participation.objectId,
          expiresAt: participation.coverageExpiresAt,
        },
        rationale: 'Covering access should be logged for audit.',
        requiresHumanApproval: false,
      });
    }

    return {
      moduleId: this.id,
      outcome: 'ALLOW',
      appliedRules: [{
        ruleId: 'participation.role-sufficient',
        ruleName: 'Role Sufficient',
        outcome: 'ALLOW',
        reason: `Actor "${context.actor}" has role "${participation.role}" — sufficient for "${accessType}" access.`,
      }],
      skippedRules: [],
      actions,
      reasoning: `Participation check passed. Role: ${participation.role}, access: ${accessType}.`,
    };
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
