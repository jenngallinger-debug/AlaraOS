/**
 * Alara OS — Trigger Engine Types
 *
 * The Trigger Engine answers: "Is this event interesting enough to evaluate?"
 * It sits between the Event Store and the Rules Engine.
 *
 * Pipeline: Event → TriggerEngine → (if fired) → RulesEngine → Workflow
 *
 * Constitutional alignment (Part XI): "Triggers exist only to answer:
 * Should something happen now? Triggers are temporary. They either fire. Or expire."
 */

import { DomainEvent } from '../events/types';

// ─── Trigger conditions ───────────────────────────────────────────────────────

export type TriggerConditionOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains'
  | 'exists' | 'not_exists'
  | 'in' | 'not_in';

export interface TriggerCondition {
  /** Dot-path into the event payload, e.g. "objectType" or "attributes.status" */
  readonly field: string;
  readonly operator: TriggerConditionOperator;
  readonly value?: unknown;
}

export type TriggerLogic = 'ALL' | 'ANY'; // AND / OR across conditions

// ─── Trigger definition ───────────────────────────────────────────────────────

export interface TriggerDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Event types this trigger listens on */
  readonly eventTypes: readonly string[];
  readonly conditions: readonly TriggerCondition[];
  readonly logic: TriggerLogic;
  /** Human-readable rationale shown in audit/explain output */
  readonly rationale: string;
  /** Which rule set to invoke when this trigger fires */
  readonly targetRuleSetId: string;
  readonly enabled: boolean;
  /** Lower = evaluated first when multiple triggers match */
  readonly priority: number;
}

// ─── Evaluation results ───────────────────────────────────────────────────────

export interface TriggerFiredResult {
  readonly fired: true;
  readonly triggerId: string;
  readonly triggerName: string;
  readonly targetRuleSetId: string;
  readonly matchedConditions: readonly string[];
  readonly event: DomainEvent;
}

export interface TriggerNotFiredResult {
  readonly fired: false;
  readonly triggerId: string;
  readonly triggerName: string;
  readonly reason: string;
}

export type TriggerEvaluationResult = TriggerFiredResult | TriggerNotFiredResult;

// ─── Registry interface ───────────────────────────────────────────────────────

export interface ITriggerRegistry {
  register(trigger: TriggerDefinition): void;
  unregister(triggerId: string): void;
  getAll(): TriggerDefinition[];
  getById(id: string): TriggerDefinition | undefined;
  /** Return enabled triggers that listen on a given event type, sorted by priority */
  getForEventType(eventType: string): TriggerDefinition[];
}
