/**
 * Alara OS — M11 Retrieval & Query Engine — Permission Gate
 *
 * The permission gate scopes retrieval results to what the asking actor may see.
 * It is applied INSIDE the query boundary (success criterion / invariant): a
 * candidate result is admitted ONLY if the existing Rules Engine returns ALLOW.
 *
 * This reuses the existing M1 permission model — RulesEngine + RuleContext +
 * the ConsentPolicyModule / ParticipationPolicyModule. The retrieval engine
 * invents NO new permission logic. A consent revocation or participation change
 * that affects those policy modules therefore changes retrieval results too.
 *
 * READ semantics: the gate builds a read/visibility RuleContext describing
 * "actor X wants to read record R" and evaluates it. Only ALLOW admits. DENY,
 * REQUIRE_HUMAN, and DEFER all suppress the record from results (retrieval never
 * surfaces content the actor may not freely see).
 */

import { RulesEngine } from '../rules-engine/engine';
import { RuleContext } from '../rules-engine/types';
import { QuerySource } from './types';

/** Default rule set used for read/visibility evaluation. */
export const RETRIEVAL_READ_RULESET = 'retrieval-read';

/** The synthetic event type used to express "read this record" to the Rules Engine. */
export const RETRIEVAL_READ_EVENT = 'RetrievalRead';

export interface GateInput {
  readonly tenantId: string;
  readonly actor: string;
  readonly source: QuerySource;
  /** The candidate record being considered for visibility. */
  readonly record: Record<string, unknown>;
  readonly ruleSetId?: string;
}

/**
 * Decides whether a single candidate record is visible to the actor.
 * Returns true only on ALLOW. Never throws — a gate error suppresses the record
 * (fail-closed), consistent with the Rules Engine's own safe-default behaviour.
 */
export class RetrievalPermissionGate {
  constructor(private readonly rules: RulesEngine) {}

  async isVisible(input: GateInput): Promise<boolean> {
    const context: RuleContext = {
      tenantId: input.tenantId,
      actor: input.actor,
      eventType: RETRIEVAL_READ_EVENT,
      eventPayload: { source: input.source },
      ruleSetId: input.ruleSetId ?? RETRIEVAL_READ_RULESET,
      // The candidate record is provided as a domain object so consent /
      // participation policy modules can evaluate visibility against it.
      objects: { record: input.record, source: input.source },
      metadata: { retrieval: true },
    };

    try {
      const decision = await this.rules.evaluate(context);
      // Only an explicit ALLOW admits the record. Everything else suppresses it.
      return decision.outcome === 'ALLOW';
    } catch {
      // Fail-closed: if the gate cannot evaluate, the record is not visible.
      return false;
    }
  }
}
