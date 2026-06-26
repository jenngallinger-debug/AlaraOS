/**
 * Alara OS — Rules Engine
 *
 * Evaluates a RuleContext against all loaded PolicyModules for the rule set
 * specified by the triggering Trigger. Returns a deterministic Decision with
 * a full Explanation and a list of RecommendedActions.
 *
 * EVALUATION SEMANTICS:
 *   1. Load all PolicyModules for the rule set (sorted by priority).
 *   2. Evaluate each module in order.
 *   3. If any module returns DENY or REQUIRE_HUMAN → stop, return that outcome.
 *   4. If all modules return ALLOW → merge their actions and return ALLOW.
 *   5. If all modules return DEFER → return DEFER (unusual; means no rules apply).
 *   6. ALLOW with at least one REQUIRE_HUMAN action → escalate to REQUIRE_HUMAN.
 *
 * ADR-003: AI is last in the chain. This engine runs BEFORE the AI layer.
 * ADR-015: AI cannot autonomously perform certain action types. The engine
 *           enforces this by returning REQUIRE_HUMAN for those actions.
 */

import { newEventId } from '../shared/ids';
import {
  ActionType,
  AppliedRule,
  Decision,
  DecisionOutcome,
  Explanation,
  IRulesRegistry,
  PolicyEvaluation,
  RecommendedAction,
  RuleAuditEntry,
  RuleContext,
  SkippedRule,
} from './types';

// ─── Audit sink interface ─────────────────────────────────────────────────────

export interface IAuditSink {
  record(entry: RuleAuditEntry): Promise<void>;
}

/** No-op audit sink for tests and dev */
export class NoopAuditSink implements IAuditSink {
  async record(_entry: RuleAuditEntry): Promise<void> {}
}

// ─── Rules Engine ─────────────────────────────────────────────────────────────

export class RulesEngine {
  constructor(
    private readonly registry: IRulesRegistry,
    private readonly auditSink: IAuditSink = new NoopAuditSink(),
  ) {}

  /**
   * Evaluate a context against all applicable policy modules.
   * Always produces a Decision — never throws (errors become DENY).
   */
  async evaluate(context: RuleContext): Promise<Decision> {
    const modules = this.registry.getPolicyModulesForRuleSet(context.ruleSetId);

    if (modules.length === 0) {
      return this.buildDecision(context, 'ALLOW', 'no-policy-module', [], [], [], [
        'No policy modules registered for this rule set. Defaulting to ALLOW.',
      ]);
    }

    const evaluations: PolicyEvaluation[] = [];

    for (const module of modules) {
      let evaluation: PolicyEvaluation;
      try {
        evaluation = module.evaluate(context);
      } catch (err) {
        // A policy module that throws is treated as DENY — safe default
        evaluation = {
          moduleId: module.id,
          outcome: 'DENY',
          appliedRules: [],
          skippedRules: [],
          actions: [],
          reasoning: `Policy module threw an error: ${String(err)}`,
        };
      }

      evaluations.push(evaluation);

      // Fail-fast on DENY or REQUIRE_HUMAN
      if (evaluation.outcome === 'DENY' || evaluation.outcome === 'REQUIRE_HUMAN') {
        const decision = this.buildDecision(
          context,
          evaluation.outcome,
          module.id,
          evaluations.flatMap(e => e.appliedRules),
          evaluations.flatMap(e => e.skippedRules),
          evaluation.actions,
          evaluations.map(e => `[${e.moduleId}] ${e.reasoning}`),
        );
        await this.audit(context, decision);
        return decision;
      }
    }

    // All ALLOW — merge all actions; escalate if any require human approval
    const allActions = evaluations.flatMap(e => e.actions);
    const requiresHuman = allActions.some(a => a.requiresHumanApproval);

    const decision = this.buildDecision(
      context,
      requiresHuman ? 'REQUIRE_HUMAN' : 'ALLOW',
      'all-modules',
      evaluations.flatMap(e => e.appliedRules),
      evaluations.flatMap(e => e.skippedRules),
      allActions,
      evaluations.map(e => `[${e.moduleId}] ${e.reasoning}`),
    );
    await this.audit(context, decision);
    return decision;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildDecision(
    context: RuleContext,
    outcome: DecisionOutcome,
    ruleId: string,
    appliedRules: readonly AppliedRule[],
    skippedRules: readonly SkippedRule[],
    actions: readonly RecommendedAction[],
    reasoning: readonly string[],
  ): Decision {
    const explanation: Explanation = {
      summary: this.summarize(outcome, context.ruleSetId, appliedRules.length),
      reasoning,
      appliedRules,
      skippedRules,
    };

    return {
      outcome,
      ruleSetId: context.ruleSetId,
      ruleId,
      explanation,
      actions,
      evaluatedAt: new Date(),
    };
  }

  private summarize(
    outcome: DecisionOutcome,
    ruleSetId: string,
    rulesApplied: number,
  ): string {
    const label: Record<DecisionOutcome, string> = {
      ALLOW: 'Permitted',
      DENY: 'Denied',
      REQUIRE_HUMAN: 'Human approval required',
      DEFER: 'Deferred — no applicable policy',
    };
    return `${label[outcome]} by rule set "${ruleSetId}" (${rulesApplied} rule${rulesApplied !== 1 ? 's' : ''} applied)`;
  }

  private async audit(context: RuleContext, decision: Decision): Promise<void> {
    const entry: RuleAuditEntry = {
      id: newEventId(),
      tenantId: context.tenantId,
      actor: context.actor,
      ruleSetId: context.ruleSetId,
      ruleId: decision.ruleId,
      outcome: decision.outcome,
      context,
      decision,
      evaluatedAt: decision.evaluatedAt,
    };
    // Fire-and-forget — audit failures must not block the pipeline
    this.auditSink.record(entry).catch(err => {
      console.error('[RulesEngine] Audit sink error:', err);
    });
  }
}

// ─── Convenience: check if an action type requires human approval ─────────────

/** ADR-015: these action types can never be performed autonomously by AI */
const AI_PROHIBITED_ACTIONS: Set<ActionType> = new Set([
  'ESCALATE',
  'SEND_COMMUNICATION', // AI may draft; human must send
]);

export function requiresHumanApproval(actionType: ActionType): boolean {
  return AI_PROHIBITED_ACTIONS.has(actionType);
}
