/**
 * Alara OS — Rules Engine Types
 *
 * The Rules Engine answers: "What should happen, and is it permitted?"
 * It receives a RuleContext (assembled by the pipeline coordinator from
 * live object state + event data) and returns a deterministic Decision.
 *
 * KEY DESIGN DECISIONS:
 *   1. Policy modules are loaded separately from the engine (M1b).
 *      The engine doesn't know about Consent, Participation, or AI Act
 *      constraints — those are policy modules plugged in at startup.
 *   2. Every evaluation produces an Explanation — mandatory for audit,
 *      for the "everything explainable" constitutional requirement, and
 *      for the AI recommendation layer that may override or defer.
 *   3. Rules are deterministic. AI sits behind the Rules Engine.
 *      (ADR-003: AI is last in the chain. ADR-015: AI cannot act autonomously.)
 */

// ─── Rule context ─────────────────────────────────────────────────────────────

/**
 * The context passed to every rule evaluation.
 * Assembled by the pipeline coordinator from:
 *   - the triggering event
 *   - the current state of relevant objects
 *   - actor identity
 */
export interface RuleContext {
  readonly tenantId: string;
  readonly actor: string;
  readonly eventType: string;
  readonly eventPayload: Record<string, unknown>;
  readonly ruleSetId: string;
  /** Arbitrary domain objects relevant to the evaluation */
  readonly objects: Record<string, unknown>;
  /** Additional metadata the coordinator wants to pass */
  readonly metadata?: Record<string, unknown>;
}

// ─── Decision ─────────────────────────────────────────────────────────────────

export type DecisionOutcome = 'ALLOW' | 'DENY' | 'REQUIRE_HUMAN' | 'DEFER';

export interface Decision {
  readonly outcome: DecisionOutcome;
  readonly ruleSetId: string;
  readonly ruleId: string;
  readonly explanation: Explanation;
  readonly actions: readonly RecommendedAction[];
  readonly evaluatedAt: Date;
}

// ─── Explanation (constitutional requirement: everything explainable) ──────────

export interface Explanation {
  readonly summary: string;
  readonly reasoning: readonly string[];
  readonly appliedRules: readonly AppliedRule[];
  readonly skippedRules: readonly SkippedRule[];
}

export interface AppliedRule {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly outcome: DecisionOutcome;
  readonly reason: string;
}

export interface SkippedRule {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly reason: string;
}

// ─── Recommended actions ──────────────────────────────────────────────────────

export type ActionType =
  | 'CREATE_WORKFLOW'
  | 'ASSIGN_TASK'
  | 'SEND_COMMUNICATION'
  | 'ESCALATE'
  | 'FLAG_FOR_HUMAN'
  | 'UPDATE_OBJECT'
  | 'EMIT_EVENT'
  | 'NO_ACTION';

export interface RecommendedAction {
  readonly type: ActionType;
  readonly payload: Record<string, unknown>;
  readonly rationale: string;
  /** If true, a human must approve before this action executes */
  readonly requiresHumanApproval: boolean;
}

// ─── Audit log entry ──────────────────────────────────────────────────────────

export interface RuleAuditEntry {
  readonly id: string;              // UUIDv7
  readonly tenantId: string;
  readonly actor: string;
  readonly ruleSetId: string;
  readonly ruleId: string;
  readonly outcome: DecisionOutcome;
  readonly context: RuleContext;
  readonly decision: Decision;
  readonly evaluatedAt: Date;
}

// ─── Policy module interface (M1b: BD-014, ADR-014, ADR-015 plug in here) ─────

/**
 * A PolicyModule is a named, versioned set of rules that the engine loads.
 * M1b will implement:
 *   - ConsentPolicyModule     (BD-014)
 *   - ParticipationPolicyModule (ADR-014)
 *   - AIActConstraintModule   (ADR-015)
 *
 * The engine calls evaluate() on each loaded module in priority order.
 * The FIRST module that returns DENY or REQUIRE_HUMAN wins (fail-fast).
 * If all modules return ALLOW, the engine proceeds with ALLOW + merged actions.
 */
export interface PolicyModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly priority: number; // lower = evaluated first
  readonly ruleSetIds: readonly string[]; // which rule sets this module applies to

  /**
   * Evaluate the policy against the given context.
   * Must be deterministic — same inputs always produce same output.
   * Must never perform I/O — all data arrives in the context.
   */
  evaluate(context: RuleContext): PolicyEvaluation;
}

export interface PolicyEvaluation {
  readonly moduleId: string;
  readonly outcome: DecisionOutcome;
  readonly appliedRules: readonly AppliedRule[];
  readonly skippedRules: readonly SkippedRule[];
  readonly actions: readonly RecommendedAction[];
  readonly reasoning: string;
}

// ─── Rule Set ─────────────────────────────────────────────────────────────────

export interface RuleSet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
}

// ─── Registry interface ───────────────────────────────────────────────────────

export interface IRulesRegistry {
  registerPolicyModule(module: PolicyModule): void;
  unregisterPolicyModule(moduleId: string): void;
  getPolicyModulesForRuleSet(ruleSetId: string): PolicyModule[];
  registerRuleSet(ruleSet: RuleSet): void;
  getRuleSet(id: string): RuleSet | undefined;
  getAllRuleSets(): RuleSet[];
}
