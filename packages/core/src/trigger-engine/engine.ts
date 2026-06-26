/**
 * Alara OS — Trigger Engine
 *
 * Evaluates whether an incoming event fires any registered trigger.
 * Pure function at core: evaluate(trigger, event) → result.
 * No side effects. Fully deterministic. Testable in isolation.
 *
 * The engine does NOT call the Rules Engine — it returns TriggerFiredResult
 * objects that the pipeline coordinator uses to invoke the Rules Engine.
 */

import { DomainEvent } from '../events/types';
import {
  ITriggerRegistry,
  TriggerCondition,
  TriggerConditionOperator,
  TriggerDefinition,
  TriggerEvaluationResult,
  TriggerFiredResult,
} from './types';

// ─── Field access ─────────────────────────────────────────────────────────────

/**
 * Resolve a dot-path like "payload.objectType" or "payload.attributes.status"
 * against an event. The root is the event itself so callers can also reach
 * top-level event fields via "type", "actor", "tenantId", etc.
 */
function resolvePath(event: DomainEvent, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = event;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── Condition evaluation ─────────────────────────────────────────────────────

function evaluateCondition(
  event: DomainEvent,
  condition: TriggerCondition,
): boolean {
  const actual = resolvePath(event, condition.field);
  const expected = condition.value;
  const op: TriggerConditionOperator = condition.operator;

  switch (op) {
    case 'eq':          return actual === expected;
    case 'neq':         return actual !== expected;
    case 'gt':          return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':         return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':          return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':         return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':    return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    case 'not_contains':return typeof actual === 'string' && typeof expected === 'string' && !actual.includes(expected);
    case 'exists':      return actual !== undefined && actual !== null;
    case 'not_exists':  return actual === undefined || actual === null;
    case 'in':          return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':      return Array.isArray(expected) && !expected.includes(actual);
    default:
      // TypeScript exhaustiveness — should never happen at runtime
      return false;
  }
}

function describeCondition(c: TriggerCondition): string {
  return `${c.field} ${c.operator}${c.value !== undefined ? ` ${JSON.stringify(c.value)}` : ''}`;
}

// ─── Trigger Engine ───────────────────────────────────────────────────────────

export class TriggerEngine {
  constructor(private readonly registry: ITriggerRegistry) {}

  /**
   * Evaluate all registered triggers for the given event.
   * Returns one result per trigger that listens on this event type.
   * Results are sorted by trigger priority.
   */
  evaluate(event: DomainEvent): TriggerEvaluationResult[] {
    const candidates = this.registry.getForEventType(event.type);
    return candidates.map(trigger => this.evaluateTrigger(trigger, event));
  }

  /**
   * Return only the triggers that fired for this event.
   */
  fired(event: DomainEvent): TriggerFiredResult[] {
    return this.evaluate(event).filter(
      (r): r is TriggerFiredResult => r.fired,
    );
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private evaluateTrigger(
    trigger: TriggerDefinition,
    event: DomainEvent,
  ): TriggerEvaluationResult {
    const results = trigger.conditions.map(condition => ({
      description: describeCondition(condition),
      passed: evaluateCondition(event, condition),
    }));

    const fired =
      trigger.conditions.length === 0 // no conditions = always fire
        ? true
        : trigger.logic === 'ALL'
          ? results.every(r => r.passed)
          : results.some(r => r.passed);

    if (fired) {
      return {
        fired: true,
        triggerId: trigger.id,
        triggerName: trigger.name,
        targetRuleSetId: trigger.targetRuleSetId,
        matchedConditions: results.filter(r => r.passed).map(r => r.description),
        event,
      };
    }

    const failedConditions = results.filter(r => !r.passed).map(r => r.description);
    return {
      fired: false,
      triggerId: trigger.id,
      triggerName: trigger.name,
      reason: `Conditions not met (${trigger.logic}): ${failedConditions.join(', ')}`,
    };
  }
}
