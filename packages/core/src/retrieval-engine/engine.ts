/**
 * Alara OS — M11 Retrieval & Query Engine — Engine
 *
 * A deterministic, READ-ONLY query substrate that SELECTS and JOINS across the
 * existing canonical stores and returns results scoped to the asking actor.
 *
 * Anchors (ratified canon):
 *  - ADR-016: retrieval is a VIEW. It selects/joins; it never computes new
 *    authoritative truth and adds no ProjectionType.
 *  - ADR-001: it reads Alara-owned objects + ExternalReferences only; it never
 *    reaches into the EMR.
 *  - ADR-003: it is deterministic; no AI is involved.
 *
 * Invariants enforced here:
 *  - Read-only: the engine holds only read handles; it has no method that writes
 *    objects, edges, or events, and it emits NO domain events.
 *  - Permission inside the boundary: every candidate result passes the
 *    RetrievalPermissionGate (reusing the M1 RulesEngine) before being returned.
 *  - Provenance on every result.
 *  - Same query, different actor → possibly different results (scoped).
 */

import { ObjectGraphRepository } from '../object-graph/repository';
import { RelationshipRepository } from '../relationship-engine/repository';
import { EventStore } from '../events/store';
import { ProjectionEngine } from '../projection-engine/engine';
import { ProjectionType } from '../projection-engine/types';
import { AlaraObject } from '../shared/types';
import { DomainEvent } from '../events/types';
import { RetrievalPermissionGate } from './permission-gate';
import {
  RetrievalQuery,
  SourceQuery,
  RetrievalResult,
  RetrievalResultSet,
  QueryFilter,
  RetrievalQueryError,
} from './types';

/**
 * Read handles the engine composes over. All are existing repositories/stores
 * (M0/M3/M6). The engine receives them; it never constructs persistence itself.
 */
export interface RetrievalSources {
  readonly objects: ObjectGraphRepository;
  readonly events: EventStore;
  readonly relationships: RelationshipRepository;
  readonly projections: ProjectionEngine;
}

export class RetrievalEngine {
  constructor(
    private readonly sources: RetrievalSources,
    private readonly gate: RetrievalPermissionGate,
  ) {}

  /**
   * Execute a cross-boundary, permission-scoped read. Deterministic: the same
   * inputs against the same underlying state produce the same results.
   */
  async query(q: RetrievalQuery): Promise<RetrievalResultSet> {
    const admitted: RetrievalResult[] = [];
    let deniedCount = 0;

    for (const sq of q.sources) {
      const candidates = await this.readSource(q.tenantId, sq);
      for (const candidate of candidates) {
        const visible = await this.gate.isVisible({
          tenantId: q.tenantId,
          actor: q.actor,
          source: sq.source,
          record: candidate.value as Record<string, unknown>,
          ruleSetId: q.ruleSetId,
        });
        if (visible) {
          admitted.push(candidate);
        } else {
          deniedCount += 1;
        }
      }
    }

    return { results: admitted, deniedCount, actor: q.actor };
  }

  // ─── Source readers (each composes an existing read method) ───────────────────

  private async readSource(
    tenantId: string,
    sq: SourceQuery,
  ): Promise<RetrievalResult[]> {
    switch (sq.source) {
      case 'object':
        return this.readObjects(tenantId, sq);
      case 'event':
        return this.readEvents(tenantId, sq);
      case 'edge':
        return this.readEdges(tenantId, sq);
      case 'projection':
        return this.readProjection(tenantId, sq);
      default:
        throw new RetrievalQueryError(`Unknown query source: ${String(sq.source)}`);
    }
  }

  /**
   * Objects are read by id (matching the existing repository read surface).
   * `subjectId` is the object id to read. Type/attribute filters are applied
   * after the read. (No generic table scan is performed — retrieval composes the
   * existing by-id read; broad listing is intentionally out of scope for M11.)
   */
  private async readObjects(
    tenantId: string,
    sq: SourceQuery,
  ): Promise<RetrievalResult[]> {
    if (!sq.subjectId) {
      throw new RetrievalQueryError(
        "object source requires 'subjectId' (the object id to read)",
      );
    }
    const obj = await this.sources.objects.getById(tenantId, sq.subjectId);
    if (!obj) return [];
    if (sq.objectTypes && sq.objectTypes.length > 0 && !sq.objectTypes.includes(obj.type)) {
      return [];
    }
    if (!this.matchesAll(obj as unknown as Record<string, unknown>, sq.filters)) {
      return [];
    }
    return [
      {
        source: 'object',
        value: obj as unknown as Record<string, unknown>,
        provenance: { source: 'object', recordId: (obj as AlaraObject).id },
      },
    ];
  }

  /** Events are read from a stream (stream-ordered), then filtered. */
  private async readEvents(
    tenantId: string,
    sq: SourceQuery,
  ): Promise<RetrievalResult[]> {
    const streamId = sq.streamId ?? sq.subjectId;
    if (!streamId) {
      throw new RetrievalQueryError(
        "event source requires 'streamId' (or 'subjectId') to read a stream",
      );
    }
    const events = await this.sources.events.loadStream(tenantId, streamId);
    const out: RetrievalResult[] = [];
    for (const ev of events as DomainEvent[]) {
      const record = ev as unknown as Record<string, unknown>;
      if (!this.matchesAll(record, sq.filters)) continue;
      out.push({
        source: 'event',
        value: record,
        provenance: { source: 'event', recordId: ev.id, streamId: ev.streamId, seq: ev.seq },
      });
    }
    return out;
  }

  /** Edges are read as the active participation edges for a subject's relationships. */
  private async readEdges(
    tenantId: string,
    sq: SourceQuery,
  ): Promise<RetrievalResult[]> {
    if (!sq.subjectId) {
      throw new RetrievalQueryError("edge source requires 'subjectId'");
    }
    const relationships = await this.sources.relationships.getActiveBySubject(
      tenantId,
      sq.subjectId,
    );
    const out: RetrievalResult[] = [];
    for (const rel of relationships) {
      const edges = await this.sources.relationships.getActiveEdgesForRelationship(
        tenantId,
        rel.id,
      );
      for (const edge of edges) {
        const record = edge as unknown as Record<string, unknown>;
        if (!this.matchesAll(record, sq.filters)) continue;
        out.push({
          source: 'edge',
          value: record,
          provenance: { source: 'edge', recordId: (edge as { id: string }).id },
        });
      }
    }
    return out;
  }

  /**
   * Projections are read by (type, subjectId) from the existing Projection
   * Engine. Retrieval only READS an existing projection — it never builds,
   * recomputes, or adds a ProjectionType. The type must be one of the canonical
   * ProjectionType values; an unknown name yields no result rather than minting one.
   */
  private async readProjection(
    tenantId: string,
    sq: SourceQuery,
  ): Promise<RetrievalResult[]> {
    if (!sq.projectionType || !sq.subjectId) {
      throw new RetrievalQueryError(
        "projection source requires 'projectionType' and 'subjectId'",
      );
    }
    const stored = await this.sources.projections.get(
      tenantId,
      sq.projectionType as ProjectionType,
      sq.subjectId,
    );
    if (!stored) return [];
    const record = stored as unknown as Record<string, unknown>;
    if (!this.matchesAll(record, sq.filters)) return [];
    return [
      {
        source: 'projection',
        value: record,
        provenance: {
          source: 'projection',
          recordId: stored.id,
          projectionType: sq.projectionType,
        },
      },
    ];
  }

  // ─── Deterministic value filtering (selects; never computes new truth) ────────

  private matchesAll(
    record: Record<string, unknown>,
    filters?: readonly QueryFilter[],
  ): boolean {
    if (!filters || filters.length === 0) return true;
    return filters.every((f) => this.matches(record, f));
  }

  private matches(record: Record<string, unknown>, filter: QueryFilter): boolean {
    const actual = this.readPath(record, filter.field);
    switch (filter.operator) {
      case 'eq':
        return actual === filter.value;
      case 'neq':
        return actual !== filter.value;
      case 'exists':
        return actual !== undefined && actual !== null;
      case 'in':
        return Array.isArray(filter.value) && (filter.value as unknown[]).includes(actual);
      default:
        return false;
    }
  }

  /** Reads a dotted path (e.g. 'attributes.dob') from a record. Pure read. */
  private readPath(record: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let cur: unknown = record;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }
}
