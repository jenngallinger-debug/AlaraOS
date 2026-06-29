/**
 * Alara OS — Organizational Brain Repository
 *
 * Read layer for patterns.
 * All writes go through the OrganizationalBrainEngine (event-sourced).
 */

import { DatabaseClient } from '../shared/database';
import { withTenantTransaction } from '../shared/tenant-scope';
import { AlaraId } from '../shared/types';
import {
  DetectedPattern,
  PatternCategory,
  PatternConfidence,
  PatternEvidence,
  PatternSeverity,
  PatternStatus,
} from './types';

interface PatternRow {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  description: string;
  subject_id: string;
  subject_type: string;
  evidence: unknown;
  confidence: string;
  severity: string;
  status: string;
  detector_id: string;
  detector_version: string;
  superseded_by_id: string | null;
  first_detected_at: string;
  last_confirmed_at: string;
  resolved_at: string | null;
  version: number;
}

function rowToPattern(row: PatternRow): DetectedPattern {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    category: row.category as PatternCategory,
    title: row.title,
    description: row.description,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    evidence: row.evidence as PatternEvidence,
    confidence: row.confidence as PatternConfidence,
    severity: row.severity as PatternSeverity,
    status: row.status as PatternStatus,
    detectorId: row.detector_id,
    detectorVersion: row.detector_version,
    supersededById: row.superseded_by_id as AlaraId | null,
    firstDetectedAt: new Date(row.first_detected_at),
    lastConfirmedAt: new Date(row.last_confirmed_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    version: row.version,
  };
}

export class OrganizationalBrainRepository {
  constructor(private readonly db: DatabaseClient) {}

  // RLS step 2 (Batch A): single-statement, tenant-filtered reads run inside a tenant-scoped
  // transaction so each read carries `app.tenant_id`. Behavior-preserving today (RLS inert →
  // same rows); identical SQL/params/ordering/mapping. No writes on this repo.
  async getPatternById(tenantId: string, id: AlaraId): Promise<DetectedPattern | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<PatternRow>(
        `SELECT * FROM detected_patterns WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToPattern(row) : null;
    });
  }

  async getActivePatternsForSubject(
    tenantId: string,
    subjectId: string,
    category?: PatternCategory,
  ): Promise<DetectedPattern[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      if (category) {
        const r = await client.query<PatternRow>(
          `SELECT * FROM detected_patterns WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' AND category = $3 ORDER BY first_detected_at DESC`,
          [tenantId, subjectId, category],
        );
        return r.rows.map(rowToPattern);
      }
      const r = await client.query<PatternRow>(
        `SELECT * FROM detected_patterns WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY first_detected_at DESC`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToPattern);
    });
  }

  async getAllPatternsForSubject(tenantId: string, subjectId: string): Promise<DetectedPattern[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<PatternRow>(
        `SELECT * FROM detected_patterns WHERE tenant_id = $1 AND subject_id = $2 ORDER BY first_detected_at DESC`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToPattern);
    });
  }

  async getPatternByDetectorAndSubject(
    tenantId: string,
    detectorId: string,
    subjectId: string,
  ): Promise<DetectedPattern | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<PatternRow>(
        `SELECT * FROM detected_patterns WHERE tenant_id = $1 AND detector_id = $2 AND subject_id = $3 AND status = 'active' LIMIT 1`,
        [tenantId, detectorId, subjectId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToPattern(row) : null;
    });
  }
}
