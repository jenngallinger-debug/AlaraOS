/**
 * Alara OS — Projection Registry
 *
 * Manages ProjectionDefinition registrations.
 * The engine queries the registry to find the right builder for a given type.
 */

import { ProjectionDefinition, ProjectionType } from './types';

export class ProjectionRegistry {
  private readonly definitions = new Map<ProjectionType, ProjectionDefinition>();

  register<TInput, TValue>(definition: ProjectionDefinition<TInput, TValue>): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Projection definition for "${definition.type}" already registered.`);
    }
    this.definitions.set(definition.type, definition as unknown as ProjectionDefinition);
  }

  get(type: ProjectionType): ProjectionDefinition | undefined {
    return this.definitions.get(type);
  }

  getAll(): ProjectionDefinition[] {
    return Array.from(this.definitions.values());
  }

  has(type: ProjectionType): boolean {
    return this.definitions.has(type);
  }
}
