/**
 * Alara OS — AI Act Constraint Policy Module
 *
 * Implements ADR-015: AI Act Constraint Register.
 *
 * "AI may COMPUTE over truth. It may never BECOME truth."
 *
 * PERMITTED autonomous AI actions:
 *   draft · recommend · summarize · classify · flag
 *
 * PROHIBITED autonomous AI actions (constitutional enforcement):
 *   clinical_escalate · external_disclose · consent_change ·
 *   order_interpret · benefit_auth · communicate_external
 *
 * ADR-015 catch-all doctrine: "AI may not autonomously perform any action
 * that creates, changes, revokes, discloses, escalates, or commits the
 * organization to a clinical, legal, financial, authorization, consent,
 * or external-stakeholder consequence."
 *
 * RULE CHAIN:
 *   1. No AI fact in context → skip (module doesn't apply)
 *   2. Action class is prohibited AND isAutonomous → DENY
 *   3. Action class is permitted → ALLOW (with confidence annotation)
 *   4. Unknown action class → REQUIRE_HUMAN (safe default)
 */

import { PolicyEvaluation, PolicyModule, RuleContext } from '../types';
import { AIActionClass, AIActionFact } from './context-types';

const PROHIBITED_AUTONOMOUS: Set<AIActionClass> = new Set([
  'clinical_escalate',
  'external_disclose',
  'consent_change',
  'order_interpret',
  'benefit_auth',
  'communicate_external',
]);

const PERMITTED_AUTONOMOUS: Set<AIActionClass> = new Set([
  'draft',
  'recommend',
  'summarize',
  'classify',
  'flag',
]);

const RULE_SETS = ['*']; // applies to every rule set

export const AIActConstraintPolicyModule: PolicyModule = {
  id: 'policy.ai-act-constraint',
  name: 'AI Act Constraint Policy (ADR-015)',
  version: '1.0.0',
  priority: 5, // very high — AI constraints checked early
  ruleSetIds: RULE_SETS,

  evaluate(context: RuleContext): PolicyEvaluation {
    const aiAction = context.objects['aiAction'] as AIActionFact | undefined;

    // ── Module doesn't apply if no AI action in context ───────────────────────
    if (!aiAction) {
      return {
        moduleId: this.id,
        outcome: 'ALLOW',
        appliedRules: [{
          ruleId: 'ai-act.not-applicable',
          ruleName: 'Not an AI Action',
          outcome: 'ALLOW',
          reason: 'No AI action fact in context. AI Act constraints do not apply.',
        }],
        skippedRules: [],
        actions: [],
        reasoning: 'No AI action context — module passes through.',
      };
    }

    // ── Rule 1: Prohibited class + autonomous = DENY ───────────────────────────
    if (aiAction.isAutonomous && PROHIBITED_AUTONOMOUS.has(aiAction.actionClass)) {
      const reason =
        `AI agent "${aiAction.agentId}" attempted autonomous action ` +
        `"${aiAction.actionClass}" which is prohibited by ADR-015. ` +
        `This action class creates a clinical, legal, financial, authorization, ` +
        `consent, or external-stakeholder consequence that requires human approval.`;

      return {
        moduleId: this.id,
        outcome: 'DENY',
        appliedRules: [{
          ruleId: 'ai-act.prohibited-autonomous',
          ruleName: 'Prohibited Autonomous AI Action (ADR-015)',
          outcome: 'DENY',
          reason,
        }],
        skippedRules: [],
        actions: [{
          type: 'FLAG_FOR_HUMAN',
          payload: {
            agentId: aiAction.agentId,
            actionClass: aiAction.actionClass,
            confidence: aiAction.confidence,
            adR015Note: 'AI may recommend this action; human must approve.',
          },
          rationale: 'ADR-015: Convert autonomous attempt to a human-gated recommendation.',
          requiresHumanApproval: true,
        }],
        reasoning: reason,
      };
    }

    // ── Rule 2: Prohibited class, NOT autonomous → convert to recommendation ───
    if (!aiAction.isAutonomous && PROHIBITED_AUTONOMOUS.has(aiAction.actionClass)) {
      return {
        moduleId: this.id,
        outcome: 'ALLOW',
        appliedRules: [{
          ruleId: 'ai-act.prohibited-class-assist-mode',
          ruleName: 'Prohibited Class — Assist Mode Allowed',
          outcome: 'ALLOW',
          reason: `"${aiAction.actionClass}" is prohibited autonomously but AI is in assist mode. ` +
            'Human is in control. Action proceeds as a recommendation.',
        }],
        skippedRules: [],
        actions: [{
          type: 'ASSIGN_TASK',
          payload: {
            taskType: 'ReviewAIRecommendation',
            agentId: aiAction.agentId,
            actionClass: aiAction.actionClass,
            confidence: aiAction.confidence,
          },
          rationale: 'Human must review and approve AI recommendation before action executes.',
          requiresHumanApproval: true,
        }],
        reasoning: 'AI is assisting, not acting. Human approval required before execution.',
      };
    }

    // ── Rule 3: Permitted class → ALLOW ───────────────────────────────────────
    if (PERMITTED_AUTONOMOUS.has(aiAction.actionClass)) {
      return {
        moduleId: this.id,
        outcome: 'ALLOW',
        appliedRules: [{
          ruleId: 'ai-act.permitted',
          ruleName: 'Permitted AI Action Class',
          outcome: 'ALLOW',
          reason: `"${aiAction.actionClass}" is a permitted autonomous AI action. ` +
            `Confidence: ${aiAction.confidence.toFixed(2)}.`,
        }],
        skippedRules: [],
        actions: [],
        reasoning: `AI action "${aiAction.actionClass}" is permitted. Confidence: ${aiAction.confidence.toFixed(2)}.`,
      };
    }

    // ── Rule 4: Unknown action class → REQUIRE_HUMAN (safe default) ───────────
    return {
      moduleId: this.id,
      outcome: 'REQUIRE_HUMAN',
      appliedRules: [{
        ruleId: 'ai-act.unknown-class',
        ruleName: 'Unknown AI Action Class',
        outcome: 'REQUIRE_HUMAN',
        reason: `AI action class "${aiAction.actionClass}" is not in the approved or prohibited list. ` +
          'ADR-015 catch-all: route to human.',
      }],
      skippedRules: [],
      actions: [{
        type: 'FLAG_FOR_HUMAN',
        payload: { agentId: aiAction.agentId, actionClass: aiAction.actionClass },
        rationale: 'Unknown AI action class — human must classify before it can be permitted.',
        requiresHumanApproval: true,
      }],
      reasoning: `Unknown AI action class "${aiAction.actionClass}". Defaulting to REQUIRE_HUMAN per ADR-015.`,
    };
  },
};
