/**
 * Alara OS — Projection Engine
 *
 * Implements ADR-016 enforcement:
 *   - No projection stored without dependency declaration.
 *   - Projections rebuild from event stream identically.
 *   - Deleting projection state loses no truth.
 *   - Projections cannot write canonical objects.
 *   - Projections cannot emit side-effectful actions.
 *
 * The engine emits ONLY these event types:
 *   ProjectionRebuilt | ProjectionInvalidated | ProjectionFailed
 */

import { newAlaraId, newEventId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { ProjectionRegistry } from './registry';
import { IProjectionStore } from './types';
import {
  ConfidenceLevel,
  InferenceBasis,
  IProjectionStore as IPS,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionFailedPayload,
  ProjectionInvalidatedPayload,
  ProjectionMetadata,
  ProjectionRebuiltPayload,
  ProjectionType,
  StoredProjection,
} from './types';

// ─── Build input assembler interface ──────────────────────────────────────────

/**
 * The caller provides an assembler that reads canonical inputs
 * and returns the typed input the ProjectionDefinition.build() expects.
 *
 * This keeps the engine generic — it doesn't know how to fetch Patient
 * objects or workflow rows, but the assembler does.
 */
export interface ProjectionInputAssembler<TInput = Record<string, unknown>> {
  assemble(subjectId: string, tenantId: string): Promise<TInput>;
  /** Returns event IDs that contributed to the assembled input */
  sourceEventIds(subjectId: string, tenantId: string): Promise<string[]>;
}

// ─── Engine result types ───────────────────────────────────────────────────────

export interface ProjectionBuildSuccess {
  readonly built: true;
  readonly projection: StoredProjection;
  readonly eventId: string;
}

export interface ProjectionBuildFailure {
  readonly built: false;
  readonly reason: string;
  readonly eventId: string;
}

export type BuildResult = ProjectionBuildSuccess | ProjectionBuildFailure;

// ─── Projection Engine ─────────────────────────────────────────────────────────

export class ProjectionEngine {
  constructor(
    private readonly registry: ProjectionRegistry,
    private readonly store: IProjectionStore,
    private readonly eventStore: EventStore,
  ) {}

  /**
   * Build (or rebuild) a projection.
   *
   * ADR-016 enforcement:
   *   - Fails if definition has no dependencies declared.
   *   - Fails if definition has no method version.
   *   - Emits ProjectionRebuilt on success.
   *   - Emits ProjectionFailed on error (never throws to caller).
   *   - Never writes to canonical tables.
   */
  async build<TInput, TValue>(
    tenantId: string,
    type: ProjectionType,
    subjectId: string,
    assembler: ProjectionInputAssembler<TInput>,
    projectionStreamId?: AlaraId,
  ): Promise<BuildResult> {
    const definition = this.registry.get(type) as unknown as ProjectionDefinition<TInput, TValue> | undefined;

    if (!definition) {
      return this.fail(tenantId, type, subjectId, `No definition registered for projection type "${type}".`, projectionStreamId);
    }

    // ADR-016: validate dependency declaration
    const dependencies = definition.declareDependencies(subjectId);
    if (!dependencies || dependencies.length === 0) {
      return this.fail(tenantId, type, subjectId, `ADR-016 violation: projection "${type}" declares no canonical inputs. Dependency declaration is mandatory.`, projectionStreamId);
    }

    // ADR-016: validate method version
    if (!definition.methodVersion || definition.methodVersion.trim() === '') {
      return this.fail(tenantId, type, subjectId, `ADR-016 violation: projection "${type}" has no method version.`, projectionStreamId);
    }

    let result: ProjectionBuildResult<TValue>;
    try {
      const input = await assembler.assemble(subjectId, tenantId);
      result = definition.build(input);
    } catch (err) {
      return this.fail(tenantId, type, subjectId, `Build error: ${String(err)}`, projectionStreamId);
    }

    // Fetch source event IDs
    const sourceEventIds = await assembler.sourceEventIds(subjectId, tenantId);

    // Get existing build number
    const existing = await this.store.get(tenantId, type, subjectId);
    const buildNumber = (existing?.metadata.buildNumber ?? 0) + 1;

    const metadata: ProjectionMetadata = {
      projectionType: type,
      subjectId,
      tenantId,
      canonicalInputs: dependencies,
      methodName: definition.methodName,
      methodVersion: definition.methodVersion,
      freshUntil: result.freshUntil,
      sourceEventIds: [...sourceEventIds, ...result.sourceEventIds],
      confidence: result.confidence,
      inferenceBasis: result.inferenceBasis,
      aiInvolved: result.aiInvolved,
      lastBuiltAt: new Date().toISOString(),
      buildNumber,
    };

    const projection: StoredProjection<TValue> = {
      id: existing?.id ?? newAlaraId(),
      metadata,
      value: result.value,
    };

    await this.store.save(projection as unknown as StoredProjection);

    // Emit ProjectionRebuilt (only allowed output event type)
    const streamId = projectionStreamId ?? newAlaraId();
    const payload: ProjectionRebuiltPayload = {
      projectionType: type,
      subjectId,
      methodVersion: definition.methodVersion,
      buildNumber,
      confidence: result.confidence,
      sourceEventCount: metadata.sourceEventIds.length,
    };

    const evt = await this.eventStore.append({
      tenantId,
      streamId,
      type: 'ProjectionRebuilt' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: 'projection-engine',
    });

    return { built: true, projection: projection as unknown as StoredProjection, eventId: evt.id };
  }

  /**
   * Invalidate a projection — mark it stale so next read triggers rebuild.
   * Emits ProjectionInvalidated.
   */
  async invalidate(
    tenantId: string,
    type: ProjectionType,
    subjectId: string,
    reason: string,
    projectionStreamId?: AlaraId,
  ): Promise<void> {
    await this.store.delete(tenantId, type, subjectId);

    const payload: ProjectionInvalidatedPayload = { projectionType: type, subjectId, reason };
    await this.eventStore.append({
      tenantId,
      streamId: projectionStreamId ?? newAlaraId(),
      type: 'ProjectionInvalidated' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: 'projection-engine',
    });
  }

  /**
   * Get a stored projection, or null if not yet built / invalidated.
   * Callers should rebuild if null is returned.
   */
  async get(tenantId: string, type: ProjectionType, subjectId: string): Promise<StoredProjection | null> {
    return this.store.get(tenantId, type, subjectId);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async fail(
    tenantId: string,
    type: ProjectionType,
    subjectId: string,
    reason: string,
    streamId?: AlaraId,
  ): Promise<ProjectionBuildFailure> {
    const payload: ProjectionFailedPayload = { projectionType: type, subjectId, error: reason };
    const evt = await this.eventStore.append({
      tenantId,
      streamId: streamId ?? newAlaraId(),
      type: 'ProjectionFailed' as EventType,
      payload: payload as unknown as Record<string, unknown>,
      actor: 'projection-engine',
    });
    return { built: false, reason, eventId: evt.id };
  }
}
