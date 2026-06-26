/**
 * Alara OS — Projection Rebuilder
 *
 * "Discarding a projection loses no truth."
 *
 * The Rebuilder can reconstruct any projection by replaying canonical inputs.
 * It proves the ADR-016 regenerability guarantee: after clearing the store,
 * rebuilding produces an identical result.
 *
 * Usage:
 *   1. Clear the projection store (simulate cache loss).
 *   2. Call rebuilder.rebuild(tenantId, type, subjectId, assembler).
 *   3. Verify the result matches the original.
 */

import { ProjectionEngine, ProjectionInputAssembler, BuildResult } from './engine';
import { IProjectionStore } from './types';
import { ProjectionType } from './types';

export class ProjectionRebuilder {
  constructor(
    private readonly engine: ProjectionEngine,
    private readonly store: IProjectionStore,
  ) {}

  /**
   * Rebuild a projection from scratch (as if the cache was empty).
   * The result should be identical to the original build given the same inputs.
   */
  async rebuild<TInput>(
    tenantId: string,
    type: ProjectionType,
    subjectId: string,
    assembler: ProjectionInputAssembler<TInput>,
  ): Promise<BuildResult> {
    // Invalidate first (clear cache) then rebuild
    await this.store.delete(tenantId, type, subjectId);
    return this.engine.build(tenantId, type, subjectId, assembler);
  }

  /**
   * Rebuild all projections for a subject.
   * Used when a canonical input changes (e.g. new event arrives).
   */
  async rebuildAll<TInput>(
    tenantId: string,
    subjectId: string,
    assemblers: Map<ProjectionType, ProjectionInputAssembler<TInput>>,
  ): Promise<BuildResult[]> {
    const results: BuildResult[] = [];
    for (const [type, assembler] of assemblers) {
      const result = await this.rebuild(tenantId, type, subjectId, assembler);
      results.push(result);
    }
    return results;
  }
}
