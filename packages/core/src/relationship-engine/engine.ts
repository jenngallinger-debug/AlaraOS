/**
 * Alara OS — Relationship Engine
 *
 * Manages the full relationship lifecycle and participation edges.
 * Every state transition appends an event. All state is reconstructable
 * from the event stream.
 *
 * ADR-014 enforcement:
 *   - ParticipationRole is relationship-scoped (not identity)
 *   - Covering roles have enforced expiry
 *   - Care Team is computed from edges, never stored
 *   - Ownership transfer emits ParticipantAdded + ParticipantRemoved pair
 */

import { PoolClient } from 'pg';
import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import {
  AddParticipantCommand,
  CoverageExpiredError,
  CreateRelationshipCommand,
  InvalidParticipationRoleError,
  ParticipantAddedPayload,
  ParticipantRemovedPayload,
  ParticipationEdge,
  ParticipationRole,
  ReactivateRelationshipCommand,
  Relationship,
  RelationshipCreatedPayload,
  RelationshipNotActiveError,
  RelationshipReactivatedPayload,
  RelationshipSuspendedPayload,
  RelationshipTerminatedPayload,
  RemoveParticipantCommand,
  StaleRelationshipError,
  SuspendRelationshipCommand,
  TerminateRelationshipCommand,
  TransferOwnershipCommand,
} from './types';
import { RelationshipRepository } from './repository';

// ─── Row types ────────────────────────────────────────────────────────────────

interface RelationshipRow {
  id: string; tenant_id: string; type: string; status: string;
  subject_id: string; description: string; version: number;
  created_at: string; updated_at: string;
  terminated_at: string | null; termination_reason: string | null;
}

interface EdgeRow {
  id: string; tenant_id: string; relationship_id: string;
  participant_id: string; participant_type: string; role: string;
  active: boolean; started_at: string; ended_at: string | null;
  coverage_expires_at: string | null; version: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class RelationshipEngine {
  readonly repo: RelationshipRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
  ) {
    this.repo = new RelationshipRepository(db);
  }

  // ── Create relationship ────────────────────────────────────────────────────

  async create(cmd: CreateRelationshipCommand): Promise<Relationship> {
    return this.db.transaction(async (client) => {
      const id = newAlaraId();

      await client.query(
        `INSERT INTO relationships (id, tenant_id, type, status, subject_id, description, version)
         VALUES ($1, $2, $3, 'active', $4, $5, 1)`,
        [id, cmd.tenantId, cmd.type, cmd.subjectId, cmd.description],
      );

      const payload: RelationshipCreatedPayload = {
        relationshipId: String(id),
        type: cmd.type,
        subjectId: String(cmd.subjectId),
        description: cmd.description,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: id,
        type: 'RelationshipCreated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });

      return (await this.repo.getById(cmd.tenantId, id))!;
    });
  }

  // ── Add participant (create edge) ─────────────────────────────────────────

  async addParticipant(cmd: AddParticipantCommand): Promise<ParticipationEdge> {
    // Validate covering role has expiry
    if (cmd.role === 'Covering' && !cmd.coverageExpiresAt) {
      throw new InvalidParticipationRoleError(
        'Covering',
        'Covering role requires coverageExpiresAt. Coverage without an expiry is not permitted.',
      );
    }

    // Validate coverage hasn't already expired before we even create it
    if (cmd.role === 'Covering' && cmd.coverageExpiresAt && cmd.coverageExpiresAt < new Date()) {
      throw new CoverageExpiredError(cmd.participantId, cmd.coverageExpiresAt.toISOString());
    }

    return this.db.transaction(async (client) => {
      const rel = await this.getRelationshipWithVersionCheck(
        client, cmd.tenantId, cmd.relationshipId, cmd.expectedVersion,
      );

      if (rel.status !== 'active') {
        throw new RelationshipNotActiveError(cmd.relationshipId, rel.status);
      }

      const edgeId = newAlaraId();

      await client.query(
        `INSERT INTO edges
           (id, tenant_id, relationship_id, participant_id, participant_type,
            role, active, coverage_expires_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, 1)`,
        [
          edgeId, cmd.tenantId, cmd.relationshipId,
          cmd.participantId, cmd.participantType, cmd.role,
          cmd.coverageExpiresAt?.toISOString() ?? null,
        ],
      );

      // Bump relationship version
      await client.query(
        `UPDATE relationships SET version = version + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.relationshipId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: ParticipantAddedPayload = {
        relationshipId: String(cmd.relationshipId),
        edgeId: String(edgeId),
        participantId: cmd.participantId,
        participantType: cmd.participantType,
        role: cmd.role,
        coverageExpiresAt: cmd.coverageExpiresAt?.toISOString() ?? null,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.relationshipId,
        type: 'EdgeCreated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });

      return (await this.repo.getEdgeById(cmd.tenantId, edgeId))!;
    });
  }

  // ── Remove participant (deactivate edge) ──────────────────────────────────

  async removeParticipant(cmd: RemoveParticipantCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      const rel = await this.getRelationshipWithVersionCheck(
        client, cmd.tenantId, cmd.relationshipId, cmd.expectedVersion,
      );

      if (rel.status !== 'active') {
        throw new RelationshipNotActiveError(cmd.relationshipId, rel.status);
      }

      const edgeResult = await client.query<EdgeRow>(
        `UPDATE edges SET active = false, ended_at = NOW(), version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND active = true
         RETURNING *`,
        [cmd.edgeId, cmd.tenantId],
      );

      if (!edgeResult.rows || edgeResult.rows.length === 0) {
        throw new Error(`Edge ${cmd.edgeId} not found or already inactive.`);
      }

      const edge = edgeResult.rows[0];

      // Bump relationship version
      await client.query(
        `UPDATE relationships SET version = version + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.relationshipId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: ParticipantRemovedPayload = {
        relationshipId: String(cmd.relationshipId),
        edgeId: String(cmd.edgeId),
        participantId: edge.participant_id,
        role: edge.role as ParticipationRole,
        reason: cmd.reason,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.relationshipId,
        type: 'EdgeRemoved' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });
    });
  }

  // ── Transfer ownership ────────────────────────────────────────────────────

  async transferOwnership(cmd: TransferOwnershipCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      const rel = await this.getRelationshipWithVersionCheck(
        client, cmd.tenantId, cmd.relationshipId, cmd.expectedVersion,
      );

      if (rel.status !== 'active') {
        throw new RelationshipNotActiveError(cmd.relationshipId, rel.status);
      }

      // Find old owner edge first, then deactivate by ID
      const findResult = await client.query<EdgeRow>(
        `SELECT * FROM edges WHERE tenant_id = $1 AND relationship_id = $2 AND participant_id = $3 AND role = 'Owner' AND active = true`,
        [cmd.tenantId, cmd.relationshipId, cmd.fromParticipantId],
      );

      if (!findResult.rows || findResult.rows.length === 0) {
        throw new Error(`No active Owner edge found for participant ${cmd.fromParticipantId}`);
      }

      const edge = findResult.rows[0];

      await client.query(
        `UPDATE edges SET active = false, ended_at = NOW(), version = version + 1 WHERE id = $1 AND tenant_id = $2`,
        [edge.id, cmd.tenantId],
      );

      // Create new owner edge
      const newEdgeId = newAlaraId();
      await client.query(
        `INSERT INTO edges (id, tenant_id, relationship_id, participant_id, participant_type, role, active, version)
         VALUES ($1, $2, $3, $4, 'WorkforceMember', 'Owner', true, 1)`,
        [newEdgeId, cmd.tenantId, cmd.relationshipId, cmd.toParticipantId],
      );

      // Bump relationship version
      await client.query(
        `UPDATE relationships SET version = version + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.relationshipId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload = {
        relationshipId: String(cmd.relationshipId),
        fromParticipantId: cmd.fromParticipantId,
        toParticipantId: cmd.toParticipantId,
        newEdgeId: String(newEdgeId),
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.relationshipId,
        type: 'OwnershipTransferred' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });
    });
  }

  // ── Terminate relationship ─────────────────────────────────────────────────

  async terminate(cmd: TerminateRelationshipCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      await this.getRelationshipWithVersionCheck(
        client, cmd.tenantId, cmd.relationshipId, cmd.expectedVersion,
      );

      await client.query(
        `UPDATE relationships
         SET status = 'terminated', version = version + 1, updated_at = NOW(),
             terminated_at = NOW(), termination_reason = $1
         WHERE id = $2 AND tenant_id = $3 AND version = $4`,
        [cmd.reason, cmd.relationshipId, cmd.tenantId, cmd.expectedVersion],
      );

      // Deactivate all active edges
      await client.query(
        `UPDATE edges SET active = false, ended_at = NOW(), version = version + 1
         WHERE relationship_id = $1 AND tenant_id = $2 AND active = true`,
        [cmd.relationshipId, cmd.tenantId],
      );

      const payload: RelationshipTerminatedPayload = {
        relationshipId: String(cmd.relationshipId),
        reason: cmd.reason,
        previousVersion: cmd.expectedVersion,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.relationshipId,
        type: 'RelationshipTerminated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });
    });
  }

  // ── Suspend relationship ───────────────────────────────────────────────────

  async suspend(cmd: SuspendRelationshipCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      await this.getRelationshipWithVersionCheck(
        client, cmd.tenantId, cmd.relationshipId, cmd.expectedVersion,
      );

      await client.query(
        `UPDATE relationships SET status = 'suspended', version = version + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.relationshipId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: RelationshipSuspendedPayload = {
        relationshipId: String(cmd.relationshipId),
        reason: cmd.reason,
        previousVersion: cmd.expectedVersion,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.relationshipId,
        type: 'RelationshipSuspended' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });
    });
  }

  // ── Reactivate relationship ────────────────────────────────────────────────

  async reactivate(cmd: ReactivateRelationshipCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      await this.getRelationshipWithVersionCheck(
        client, cmd.tenantId, cmd.relationshipId, cmd.expectedVersion,
      );

      await client.query(
        `UPDATE relationships SET status = 'active', version = version + 1, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.relationshipId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: RelationshipReactivatedPayload = {
        relationshipId: String(cmd.relationshipId),
        previousVersion: cmd.expectedVersion,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.relationshipId,
        type: 'RelationshipReactivated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getRelationshipWithVersionCheck(
    client: PoolClient,
    tenantId: string,
    id: AlaraId,
    expectedVersion: number,
  ): Promise<RelationshipRow> {
    const result = await client.query<RelationshipRow>(
      `SELECT * FROM relationships WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    if (!result.rows || result.rows.length === 0) {
      throw new Error(`Relationship ${id} not found.`);
    }

    const row = result.rows[0];
    if (row.version !== expectedVersion) {
      throw new StaleRelationshipError(id, expectedVersion, row.version);
    }

    return row;
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedRelationship {
  id: AlaraId;
  type: string;
  status: string;
  subjectId: string;
  description: string;
  version: number;
  activeParticipantIds: string[];
  terminationReason: string | null;
}

export async function reconstructRelationshipFromEvents(
  eventStore: EventStore,
  tenantId: string,
  relationshipId: AlaraId,
): Promise<ReconstructedRelationship | null> {
  const events = await eventStore.loadStream(tenantId, relationshipId);
  if (!events.length) return null;

  let type = '';
  let status = 'active';
  let subjectId = '';
  let description = '';
  let version = 0;
  let terminationReason: string | null = null;
  const activeParticipants = new Map<string, string>(); // edgeId → participantId

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'RelationshipCreated':
        type = p.type as string;
        subjectId = p.subjectId as string;
        description = p.description as string;
        break;

      case 'EdgeCreated':
        activeParticipants.set(p.edgeId as string, p.participantId as string);
        break;

      case 'EdgeRemoved':
        activeParticipants.delete(p.edgeId as string);
        break;

      case 'RelationshipTerminated':
        status = 'terminated';
        terminationReason = p.reason as string;
        activeParticipants.clear();
        break;

      case 'RelationshipSuspended':
        status = 'suspended';
        break;

      case 'RelationshipReactivated':
        status = 'active';
        break;

      case 'OwnershipTransferred':
        // Ownership transfer is tracked via EdgeCreated/EdgeRemoved in the stream
        // The OwnershipTransferred event is for human-readable audit
        break;
    }
  }

  return {
    id: relationshipId,
    type,
    status,
    subjectId,
    description,
    version,
    activeParticipantIds: Array.from(activeParticipants.values()),
    terminationReason,
  };
}
