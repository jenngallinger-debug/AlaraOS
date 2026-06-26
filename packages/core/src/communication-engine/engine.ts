/**
 * Alara OS — Communication Engine
 *
 * Manages the full communication lifecycle:
 *   created → queued → sent → delivered / failed
 *
 * Every state transition appends an immutable event.
 * All state is reconstructable from the event stream.
 *
 * ADR-015: the engine sends communications on behalf of humans.
 * It does not make autonomous decisions about WHAT to communicate.
 * That belongs to the Intake Orchestrator + human approval chain.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import {
  Communication,
  CommunicationAudience,
  CommunicationCreatedPayload,
  CommunicationDeliveredPayload,
  CommunicationDeliveryAdapter,
  CommunicationFailedPayload,
  CommunicationQueuedPayload,
  CommunicationSentPayload,
  CommunicationStatus,
  CreateCommunicationCommand,
  MarkDeliveredCommand,
  MarkFailedCommand,
  QueueCommunicationCommand,
  SendCommunicationCommand,
} from './types';

// ─── Row shape ────────────────────────────────────────────────────────────────

interface CommunicationRow {
  id: string; tenant_id: string; channel: string; purpose: string;
  subject_id: string; workflow_id: string | null;
  recipient_type: string; recipient_id: string;
  subject: string; body: string; status: string;
  created_at: string; queued_at: string | null; sent_at: string | null;
  delivered_at: string | null; failed_at: string | null;
  failure_reason: string | null; adapter_used: string | null; version: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class CommunicationEngine {
  private readonly adapters = new Map<CommunicationAudience, CommunicationDeliveryAdapter>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
  ) {}

  registerAdapter(adapter: CommunicationDeliveryAdapter): void {
    for (const channel of adapter.supportedAudiences) {
      this.adapters.set(channel, adapter);
    }
  }

  async create(cmd: CreateCommunicationCommand): Promise<Communication> {
    return this.db.transaction(async (client) => {
      const id = newAlaraId();
      await client.query(
        `INSERT INTO communications
           (id,tenant_id,channel,purpose,subject_id,workflow_id,
            recipient_type,recipient_id,subject,body,status,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created',1)`,
        [id, cmd.tenantId, cmd.channel, cmd.purpose, cmd.subjectId,
         cmd.workflowId, cmd.recipientType, cmd.recipientId,
         cmd.subject, cmd.body],
      );

      const payload: CommunicationCreatedPayload = {
        communicationId: String(id), channel: cmd.channel, purpose: cmd.purpose,
        subjectId: String(cmd.subjectId), workflowId: cmd.workflowId ? String(cmd.workflowId) : null,
        recipientType: cmd.recipientType, recipientId: cmd.recipientId, subject: cmd.subject,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId, streamId: id,
        type: 'CommunicationCreated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor, client,
      });

      return (await this.getById(cmd.tenantId, id))!;
    });
  }

  async queue(cmd: QueueCommunicationCommand): Promise<Communication> {
    return this.db.transaction(async (client) => {
      const comm = await this.getById(cmd.tenantId, cmd.communicationId);
      if (!comm) throw new Error(`Communication ${cmd.communicationId} not found.`);
      if (comm.version !== cmd.expectedVersion) throw new StaleCommunicationError(cmd.communicationId, cmd.expectedVersion, comm.version);

      await client.query(
        `UPDATE communications SET status='queued', queued_at=NOW(), version=version+1
         WHERE id=$1 AND tenant_id=$2 AND version=$3`,
        [cmd.communicationId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: CommunicationQueuedPayload = { communicationId: String(cmd.communicationId), channel: comm.channel, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.communicationId, type: 'CommunicationQueued' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.communicationId))!;
    });
  }

  /**
   * Send a communication via its registered adapter.
   * Appends CommunicationSent on success, CommunicationFailed on failure.
   * Never throws — delivery failures are handled as events.
   */
  async send(cmd: SendCommunicationCommand): Promise<Communication> {
    const comm = await this.getById(cmd.tenantId, cmd.communicationId);
    if (!comm) throw new Error(`Communication ${cmd.communicationId} not found.`);
    if (comm.version !== cmd.expectedVersion) throw new StaleCommunicationError(cmd.communicationId, cmd.expectedVersion, comm.version);

    const adapter = this.adapters.get(comm.channel);
    if (!adapter) {
      return this.markFailed({
        tenantId: cmd.tenantId, communicationId: cmd.communicationId,
        reason: `No adapter registered for channel "${comm.channel}"`,
        actor: cmd.actor, expectedVersion: cmd.expectedVersion,
      });
    }

    const result = await adapter.deliver(comm);

    if (!result.success) {
      return this.markFailed({
        tenantId: cmd.tenantId, communicationId: cmd.communicationId,
        reason: result.failureReason ?? 'Unknown delivery failure',
        actor: cmd.actor, expectedVersion: cmd.expectedVersion,
      });
    }

    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE communications SET status='sent', sent_at=NOW(), adapter_used=$1, version=version+1
         WHERE id=$2 AND tenant_id=$3 AND version=$4`,
        [result.adapterName, cmd.communicationId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: CommunicationSentPayload = { communicationId: String(cmd.communicationId), channel: comm.channel, adapterUsed: result.adapterName, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.communicationId, type: 'CommunicationSent' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.communicationId))!;
    });
  }

  async markDelivered(cmd: MarkDeliveredCommand): Promise<Communication> {
    return this.db.transaction(async (client) => {
      const comm = await this.getById(cmd.tenantId, cmd.communicationId);
      if (!comm) throw new Error(`Communication ${cmd.communicationId} not found.`);
      if (comm.version !== cmd.expectedVersion) throw new StaleCommunicationError(cmd.communicationId, cmd.expectedVersion, comm.version);

      await client.query(
        `UPDATE communications SET status='delivered', delivered_at=NOW(), version=version+1
         WHERE id=$1 AND tenant_id=$2 AND version=$3`,
        [cmd.communicationId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: CommunicationDeliveredPayload = { communicationId: String(cmd.communicationId), channel: comm.channel, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.communicationId, type: 'CommunicationDelivered' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.communicationId))!;
    });
  }

  async markFailed(cmd: MarkFailedCommand): Promise<Communication> {
    return this.db.transaction(async (client) => {
      const comm = await this.getById(cmd.tenantId, cmd.communicationId);
      if (!comm) throw new Error(`Communication ${cmd.communicationId} not found.`);

      await client.query(
        `UPDATE communications SET status='failed', failed_at=NOW(), failure_reason=$1, version=version+1
         WHERE id=$2 AND tenant_id=$3 AND version=$4`,
        [cmd.reason, cmd.communicationId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: CommunicationFailedPayload = { communicationId: String(cmd.communicationId), channel: comm.channel, reason: cmd.reason, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.communicationId, type: 'CommunicationFailed' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.communicationId))!;
    });
  }

  async getById(tenantId: string, id: AlaraId): Promise<Communication | null> {
    const row = await this.db.queryOne<CommunicationRow>(
      `SELECT * FROM communications WHERE id=$1 AND tenant_id=$2`, [id, tenantId],
    );
    return row ? rowToComm(row) : null;
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedCommunication {
  id: AlaraId; status: CommunicationStatus; channel: CommunicationAudience;
  recipientId: string; version: number;
}

export async function reconstructCommunicationFromEvents(
  eventStore: EventStore, tenantId: string, commId: AlaraId,
): Promise<ReconstructedCommunication | null> {
  const events = await eventStore.loadStream(tenantId, commId);
  if (!events.length) return null;

  let status: CommunicationStatus = 'created';
  let channel: CommunicationAudience = 'internal';
  let recipientId = '';
  let version = 0;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'CommunicationCreated': channel = p.channel as CommunicationAudience; recipientId = p.recipientId as string; break;
      case 'CommunicationQueued':  status = 'queued'; break;
      case 'CommunicationSent':    status = 'sent'; break;
      case 'CommunicationDelivered': status = 'delivered'; break;
      case 'CommunicationFailed':  status = 'failed'; break;
    }
  }

  return { id: commId, status, channel, recipientId, version };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StaleCommunicationError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale communication version for ${id}: expected ${expected}, got ${actual}`);
    this.name = 'StaleCommunicationError';
  }
}

function rowToComm(row: CommunicationRow): Communication {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id,
    channel: row.channel as CommunicationAudience,
    purpose: row.purpose as Communication['purpose'],
    subjectId: row.subject_id as AlaraId,
    workflowId: row.workflow_id as AlaraId | null,
    recipientType: row.recipient_type as CommunicationAudience,
    recipientId: row.recipient_id,
    subject: row.subject, body: row.body,
    status: row.status as CommunicationStatus,
    createdAt: new Date(row.created_at),
    queuedAt: row.queued_at ? new Date(row.queued_at) : null,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
    failedAt: row.failed_at ? new Date(row.failed_at) : null,
    failureReason: row.failure_reason, adapterUsed: row.adapter_used,
    version: row.version,
  };
}
