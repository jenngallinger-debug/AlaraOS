/**
 * Alara OS — Trigger Registry
 *
 * In-memory registry. In production this is backed by the `triggers` table
 * and reloaded on change. The interface is stable — swap the implementation
 * without changing the Engine or any downstream consumers.
 */

import { ITriggerRegistry, TriggerDefinition } from './types';

export class TriggerRegistry implements ITriggerRegistry {
  private readonly triggers = new Map<string, TriggerDefinition>();

  register(trigger: TriggerDefinition): void {
    if (this.triggers.has(trigger.id)) {
      throw new Error(`Trigger "${trigger.id}" is already registered. Unregister first.`);
    }
    this.triggers.set(trigger.id, trigger);
  }

  unregister(triggerId: string): void {
    this.triggers.delete(triggerId);
  }

  getAll(): TriggerDefinition[] {
    return Array.from(this.triggers.values());
  }

  getById(id: string): TriggerDefinition | undefined {
    return this.triggers.get(id);
  }

  getForEventType(eventType: string): TriggerDefinition[] {
    return Array.from(this.triggers.values())
      .filter(t => t.enabled && t.eventTypes.includes(eventType))
      .sort((a, b) => a.priority - b.priority);
  }
}
