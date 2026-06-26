/**
 * Alara OS — Promise Engine
 *
 * Tracks every organizational commitment from open → kept/missed/voided.
 * No promise is silently dropped. Every terminal state emits an event.
 *
 * JV-004 alignment: consent revocation produces PromiseVoided events
 * with voidReason='consent-revoked'. The engine accepts this void reason
 * without requiring the full Consent Engine to be integrated.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import {
  AlaraPromise, CreatePromiseCommand, KeepPromiseCommand,
  MissPromiseCommand, PromiseCreatedPayload, PromiseKeptPayload,
  PromiseMissedPayload, PromiseVoidedPayload, PromiseStatus, VoidPromiseCommand, VoidReason,
} from './types';

interface PromiseRow {
  id: string; tenant_id: string; description: string; subject_id: string;
  recipient_id: string; owner_id: string; status: string;
  due_at: string; kept_at: string | null; missed_at: string | null;
  voided_at: string | null; void_reason: string | null;
  workflow_id: string | null; workflow_step_id: string | null; version: number;
}

export class PromiseEngine {
  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
  ) {}

  async create(cmd: CreatePromiseCommand): Promise<AlaraPromise> {
    return this.db.transaction(async (client) => {
      const id = newAlaraId();
      await client.query(
        `INSERT INTO promises
           (id,tenant_id,description,subject_id,recipient_id,owner_id,status,due_at,workflow_id,workflow_step_id,version)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,1)`,
        [id, cmd.tenantId, cmd.description, cmd.subjectId, cmd.recipientId,
         cmd.ownerId, cmd.dueAt.toISOString(), cmd.workflowId, cmd.workflowStepId],
      );

      const payload: PromiseCreatedPayload = {
        promiseId: String(id), description: cmd.description,
        subjectId: String(cmd.subjectId), recipientId: cmd.recipientId,
        ownerId: cmd.ownerId, dueAt: cmd.dueAt.toISOString(),
        workflowId: cmd.workflowId ? String(cmd.workflowId) : null,
        workflowStepId: cmd.workflowStepId,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId, streamId: id,
        type: 'PromiseCreated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor, client,
      });

      return (await this.getById(cmd.tenantId, id))!;
    });
  }

  async keep(cmd: KeepPromiseCommand): Promise<AlaraPromise> {
    return this.db.transaction(async (client) => {
      const p = await this.getById(cmd.tenantId, cmd.promiseId);
      if (!p) throw new Error(`Promise ${cmd.promiseId} not found.`);
      if (p.version !== cmd.expectedVersion) throw new StalePromiseError(cmd.promiseId, cmd.expectedVersion, p.version);
      if (p.status !== 'open') throw new Error(`Cannot keep a promise in status "${p.status}".`);

      await client.query(
        `UPDATE promises SET status='kept', kept_at=NOW(), version=version+1 WHERE id=$1 AND tenant_id=$2 AND version=$3`,
        [cmd.promiseId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: PromiseKeptPayload = { promiseId: String(cmd.promiseId), description: p.description, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.promiseId, type: 'PromiseKept' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.promiseId))!;
    });
  }

  async miss(cmd: MissPromiseCommand): Promise<AlaraPromise> {
    return this.db.transaction(async (client) => {
      const p = await this.getById(cmd.tenantId, cmd.promiseId);
      if (!p) throw new Error(`Promise ${cmd.promiseId} not found.`);
      if (p.version !== cmd.expectedVersion) throw new StalePromiseError(cmd.promiseId, cmd.expectedVersion, p.version);
      if (p.status !== 'open') throw new Error(`Cannot mark a promise missed from status "${p.status}".`);

      await client.query(
        `UPDATE promises SET status='missed', missed_at=NOW(), version=version+1 WHERE id=$1 AND tenant_id=$2 AND version=$3`,
        [cmd.promiseId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: PromiseMissedPayload = { promiseId: String(cmd.promiseId), description: p.description, dueAt: p.dueAt.toISOString(), previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.promiseId, type: 'PromiseMissed' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.promiseId))!;
    });
  }

  async void(cmd: VoidPromiseCommand): Promise<AlaraPromise> {
    return this.db.transaction(async (client) => {
      const p = await this.getById(cmd.tenantId, cmd.promiseId);
      if (!p) throw new Error(`Promise ${cmd.promiseId} not found.`);
      if (p.version !== cmd.expectedVersion) throw new StalePromiseError(cmd.promiseId, cmd.expectedVersion, p.version);
      if (p.status !== 'open') throw new Error(`Cannot void a promise in status "${p.status}".`);

      await client.query(
        `UPDATE promises SET status='voided', voided_at=NOW(), void_reason=$1, version=version+1 WHERE id=$2 AND tenant_id=$3 AND version=$4`,
        [cmd.reason, cmd.promiseId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: PromiseVoidedPayload = { promiseId: String(cmd.promiseId), description: p.description, reason: cmd.reason, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.promiseId, type: 'PromiseVoided' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.promiseId))!;
    });
  }

  async getById(tenantId: string, id: AlaraId): Promise<AlaraPromise | null> {
    const row = await this.db.queryOne<PromiseRow>(`SELECT * FROM promises WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return row ? rowToPromise(row) : null;
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedPromise {
  id: AlaraId; status: PromiseStatus; description: string;
  ownerId: string; voidReason: VoidReason | null; version: number;
}

export async function reconstructPromiseFromEvents(
  eventStore: EventStore, tenantId: string, promiseId: AlaraId,
): Promise<ReconstructedPromise | null> {
  const events = await eventStore.loadStream(tenantId, promiseId);
  if (!events.length) return null;

  let status: PromiseStatus = 'open';
  let description = '';
  let ownerId = '';
  let voidReason: VoidReason | null = null;
  let version = 0;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'PromiseCreated': description = p.description as string; ownerId = p.ownerId as string; break;
      case 'PromiseKept': status = 'kept'; break;
      case 'PromiseMissed': status = 'missed'; break;
      case 'PromiseVoided': status = 'voided'; voidReason = p.reason as VoidReason; break;
    }
  }

  return { id: promiseId, status, description, ownerId, voidReason, version };
}

export class StalePromiseError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale promise version for ${id}: expected ${expected}, got ${actual}`);
    this.name = 'StalePromiseError';
  }
}

function rowToPromise(row: PromiseRow): AlaraPromise {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, description: row.description,
    subjectId: row.subject_id as AlaraId, recipientId: row.recipient_id,
    ownerId: row.owner_id, status: row.status as PromiseStatus,
    dueAt: new Date(row.due_at), keptAt: row.kept_at ? new Date(row.kept_at) : null,
    missedAt: row.missed_at ? new Date(row.missed_at) : null,
    voidedAt: row.voided_at ? new Date(row.voided_at) : null,
    voidReason: row.void_reason as VoidReason | null,
    workflowId: row.workflow_id as AlaraId | null,
    workflowStepId: row.workflow_step_id, version: row.version,
  };
}
