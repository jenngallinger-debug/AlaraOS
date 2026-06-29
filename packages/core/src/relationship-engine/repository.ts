/**
 * Alara OS — Relationship Repository
 *
 * Reads from the relationships and edges tables.
 * All writes go through the RelationshipEngine (event-sourced).
 */

import { DatabaseClient } from '../shared/database';
import { withTenantTransaction } from '../shared/tenant-scope';
import { AlaraId } from '../shared/types';
import {
  CareTeamMember,
  CareTeamView,
  ParticipationEdge,
  ParticipationRole,
  Relationship,
  RelationshipStatus,
  RelationshipType,
} from './types';

interface RelationshipRow {
  id: string;
  tenant_id: string;
  type: string;
  status: string;
  subject_id: string;
  description: string;
  version: number;
  created_at: string;
  updated_at: string;
  terminated_at: string | null;
  termination_reason: string | null;
}

interface EdgeRow {
  id: string;
  tenant_id: string;
  relationship_id: string;
  participant_id: string;
  participant_type: string;
  role: string;
  active: boolean;
  started_at: string;
  ended_at: string | null;
  coverage_expires_at: string | null;
  version: number;
}

export class RelationshipRepository {
  constructor(private readonly db: DatabaseClient) {}

  // RLS step 2 (first live adopter): the single-statement, tenant-filtered reads below run inside a
  // tenant-scoped transaction so each read carries `app.tenant_id`. Behavior-preserving today — RLS
  // is inert (the GUC is unread), so the same SQL/params/ordering return the same rows.
  // (computeCareTeamView is an aggregate/multi-query method — deferred to a dedicated refactor.)
  async getById(tenantId: string, id: AlaraId): Promise<Relationship | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<RelationshipRow>(
        `SELECT * FROM relationships WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToRelationship(row) : null;
    });
  }

  async getBySubject(tenantId: string, subjectId: AlaraId): Promise<Relationship[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<RelationshipRow>(
        `SELECT * FROM relationships WHERE tenant_id = $1 AND subject_id = $2 ORDER BY created_at ASC`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToRelationship);
    });
  }

  async getActiveBySubject(tenantId: string, subjectId: AlaraId): Promise<Relationship[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<RelationshipRow>(
        `SELECT * FROM relationships WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY created_at ASC`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToRelationship);
    });
  }

  async getEdgeById(tenantId: string, edgeId: AlaraId): Promise<ParticipationEdge | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<EdgeRow>(
        `SELECT * FROM edges WHERE id = $1 AND tenant_id = $2`,
        [edgeId, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToEdge(row) : null;
    });
  }

  async getActiveEdgesForRelationship(
    tenantId: string,
    relationshipId: AlaraId,
  ): Promise<ParticipationEdge[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<EdgeRow>(
        `SELECT * FROM edges WHERE tenant_id = $1 AND relationship_id = $2 AND active = true ORDER BY started_at ASC`,
        [tenantId, relationshipId],
      );
      return r.rows.map(rowToEdge);
    });
  }

  async getAllEdgesForRelationship(
    tenantId: string,
    relationshipId: AlaraId,
  ): Promise<ParticipationEdge[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<EdgeRow>(
        `SELECT * FROM edges WHERE tenant_id = $1 AND relationship_id = $2 ORDER BY started_at ASC`,
        [tenantId, relationshipId],
      );
      return r.rows.map(rowToEdge);
    });
  }

  async getActiveEdgesForParticipant(
    tenantId: string,
    participantId: string,
  ): Promise<ParticipationEdge[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<EdgeRow>(
        `SELECT * FROM edges WHERE tenant_id = $1 AND participant_id = $2 AND active = true ORDER BY started_at ASC`,
        [tenantId, participantId],
      );
      return r.rows.map(rowToEdge);
    });
  }

  /**
   * Compute the Care Team view for a patient.
   * Care Team is NOT canonical state — it is computed from active edges
   * across all active relationships for the patient.
   *
   * "Care Team is a relationship-set (a view over active edges), not an object."
   * (ADR-014, Part XI Object Doctrine)
   */
  async computeCareTeamView(tenantId: string, subjectId: AlaraId): Promise<CareTeamView> {
    const activeRelationships = await this.getActiveBySubject(tenantId, subjectId);

    const allEdges: EdgeRow[] = [];
    for (const rel of activeRelationships) {
      const rows = await this.db.query<EdgeRow>(
        `SELECT e.* FROM edges e
          WHERE e.tenant_id = $1
            AND e.relationship_id = $2
            AND e.active = true`,
        [tenantId, rel.id],
      );
      allEdges.push(...rows);
    }

    const members: CareTeamMember[] = allEdges.map(e => {
      const rel = activeRelationships.find(r => String(r.id) === e.relationship_id)!;
      return {
        participantId: e.participant_id,
        participantType: e.participant_type as ParticipationEdge['participantType'],
        role: e.role as ParticipationRole,
        relationshipId: e.relationship_id as AlaraId,
        relationshipType: rel.type,
        startedAt: new Date(e.started_at),
        coverageExpiresAt: e.coverage_expires_at ? new Date(e.coverage_expires_at) : null,
      };
    });

    return {
      subjectId,
      tenantId,
      members,
      computedAt: new Date().toISOString(),
      sourceEdgeIds: allEdges.map(e => e.id),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    type: row.type as RelationshipType,
    status: row.status as RelationshipStatus,
    subjectId: row.subject_id as AlaraId,
    description: row.description,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    terminatedAt: row.terminated_at ? new Date(row.terminated_at) : null,
    terminationReason: row.termination_reason,
  };
}

function rowToEdge(row: EdgeRow): ParticipationEdge {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    relationshipId: row.relationship_id as AlaraId,
    participantId: row.participant_id,
    participantType: row.participant_type as ParticipationEdge['participantType'],
    role: row.role as ParticipationRole,
    active: row.active,
    startedAt: new Date(row.started_at),
    endedAt: row.ended_at ? new Date(row.ended_at) : null,
    coverageExpiresAt: row.coverage_expires_at ? new Date(row.coverage_expires_at) : null,
    version: row.version,
  };
}
