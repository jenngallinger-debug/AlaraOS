/**
 * Alara OS — Projection Store
 *
 * In-memory implementation used in tests and dev.
 * Production implementation writes to the `projections` table (migration 004).
 *
 * ADR-016: stored projections are DISPOSABLE. Deleting the store loses no truth.
 * The store is a performance cache, not a source of truth.
 */

import { IProjectionStore, ProjectionType, StoredProjection } from './types';

function key(tenantId: string, type: ProjectionType, subjectId: string): string {
  return `${tenantId}::${type}::${subjectId}`;
}

export class InMemoryProjectionStore implements IProjectionStore {
  private readonly store = new Map<string, StoredProjection>();

  async save(projection: StoredProjection): Promise<void> {
    this.store.set(key(projection.metadata.tenantId, projection.metadata.projectionType, projection.metadata.subjectId), projection);
  }

  async get(tenantId: string, type: ProjectionType, subjectId: string): Promise<StoredProjection | null> {
    return this.store.get(key(tenantId, type, subjectId)) ?? null;
  }

  async delete(tenantId: string, type: ProjectionType, subjectId: string): Promise<void> {
    this.store.delete(key(tenantId, type, subjectId));
  }

  async listForSubject(tenantId: string, subjectId: string): Promise<StoredProjection[]> {
    return Array.from(this.store.values())
      .filter(p => p.metadata.tenantId === tenantId && p.metadata.subjectId === subjectId);
  }

  /** For tests: snapshot the store's projection count */
  size(): number { return this.store.size; }

  /** For tests: clear all projections (simulates discarding cache) */
  clear(): void { this.store.clear(); }
}

/**
 * Database-backed projection store (production).
 * Reads/writes the `projections` table from migration 004.
 */
import { DatabaseClient } from '../shared/database';
import { withTenantTransaction } from '../shared/tenant-scope';
import { newAlaraId } from '../shared/ids';

interface ProjectionRow {
  id: string;
  tenant_id: string;
  projection_type: string;
  subject_id: string;
  method_name: string;
  method_version: string;
  canonical_inputs: unknown;
  source_event_ids: string[];
  confidence: string;
  inference_basis: string;
  ai_involved: boolean;
  fresh_until: string | null;
  last_built_at: string;
  build_number: number;
  value: unknown;
}

export class DatabaseProjectionStore implements IProjectionStore {
  constructor(private readonly db: DatabaseClient) {}

  async save(projection: StoredProjection): Promise<void> {
    const m = projection.metadata;
    await this.db.query(
      `INSERT INTO projections
         (id, tenant_id, projection_type, subject_id, method_name, method_version,
          canonical_inputs, source_event_ids, confidence, inference_basis, ai_involved,
          fresh_until, last_built_at, build_number, value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, projection_type, subject_id)
       DO UPDATE SET
         method_version   = EXCLUDED.method_version,
         canonical_inputs = EXCLUDED.canonical_inputs,
         source_event_ids = EXCLUDED.source_event_ids,
         confidence       = EXCLUDED.confidence,
         inference_basis  = EXCLUDED.inference_basis,
         ai_involved      = EXCLUDED.ai_involved,
         fresh_until      = EXCLUDED.fresh_until,
         last_built_at    = EXCLUDED.last_built_at,
         build_number     = EXCLUDED.build_number,
         value            = EXCLUDED.value,
         updated_at       = NOW()`,
      [
        projection.id ?? newAlaraId(),
        m.tenantId, m.projectionType, m.subjectId, m.methodName, m.methodVersion,
        JSON.stringify(m.canonicalInputs), JSON.stringify(m.sourceEventIds),
        m.confidence, m.inferenceBasis, m.aiInvolved,
        m.freshUntil, m.lastBuiltAt, m.buildNumber, JSON.stringify(projection.value),
      ],
    );
  }

  async get(tenantId: string, type: ProjectionType, subjectId: string): Promise<StoredProjection | null> {
    // RLS step 2 (first adopter): run the read inside a tenant-scoped transaction so it carries
    // `app.tenant_id`. Behavior-preserving today — RLS is inert (the GUC is unread), so the same
    // tenant-filtered SELECT returns the same rows. Same SQL/params/mapping as before.
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<ProjectionRow>(
        `SELECT * FROM projections WHERE tenant_id=$1 AND projection_type=$2 AND subject_id=$3`,
        [tenantId, type, subjectId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToProjection(row) : null;
    });
  }

  async delete(tenantId: string, type: ProjectionType, subjectId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM projections WHERE tenant_id=$1 AND projection_type=$2 AND subject_id=$3`,
      [tenantId, type, subjectId],
    );
  }

  async listForSubject(tenantId: string, subjectId: string): Promise<StoredProjection[]> {
    // RLS step 2 (first adopter): tenant-scoped transaction; behavior-preserving (RLS inert).
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<ProjectionRow>(
        `SELECT * FROM projections WHERE tenant_id=$1 AND subject_id=$2`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToProjection);
    });
  }
}

function rowToProjection(row: ProjectionRow): StoredProjection {
  return {
    id: row.id as import('../shared/types').AlaraId,
    metadata: {
      projectionType: row.projection_type as ProjectionType,
      subjectId: row.subject_id,
      tenantId: row.tenant_id,
      methodName: row.method_name,
      methodVersion: row.method_version,
      canonicalInputs: row.canonical_inputs as import('./types').ProjectionDependency[],
      sourceEventIds: row.source_event_ids,
      confidence: row.confidence as import('./types').ConfidenceLevel,
      inferenceBasis: row.inference_basis as import('./types').InferenceBasis,
      aiInvolved: row.ai_involved,
      freshUntil: row.fresh_until,
      lastBuiltAt: row.last_built_at,
      buildNumber: row.build_number,
    },
    value: row.value as Record<string, unknown>,
  };
}
