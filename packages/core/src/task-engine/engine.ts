/**
 * Alara OS — Task Engine
 *
 * Creates, owns, and tracks atomic units of work.
 * Every state transition appends an event — full audit trail always present.
 * Stale-version updates are rejected (optimistic concurrency from M0).
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import {
  CompleteTaskCommand, CreateTaskCommand, EscalateTaskCommand,
  ReassignTaskCommand, Task, TaskStatus,
  TaskCreatedPayload, TaskCompletedPayload, TaskAssignedPayload, TaskEscalatedPayload, TaskOverduePayload,
} from './types';

interface TaskRow {
  id: string; tenant_id: string; task_type: string; title: string; description: string;
  workflow_id: string | null; workflow_step_id: string | null; owner_id: string;
  status: string; due_at: string | null; completed_at: string | null; escalated_at: string | null; version: number;
}

export class TaskEngine {
  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
  ) {}

  async create(cmd: CreateTaskCommand): Promise<Task> {
    return this.db.transaction(async (client) => {
      const id = newAlaraId();
      await client.query(
        `INSERT INTO tasks (id,tenant_id,task_type,title,description,workflow_id,workflow_step_id,owner_id,status,due_at,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,1)`,
        [id, cmd.tenantId, cmd.taskType, cmd.title, cmd.description,
         cmd.workflowId, cmd.workflowStepId, cmd.ownerId,
         cmd.dueAt?.toISOString() ?? null],
      );

      const payload: TaskCreatedPayload = {
        taskId: String(id), taskType: cmd.taskType, title: cmd.title,
        workflowId: cmd.workflowId ? String(cmd.workflowId) : null,
        workflowStepId: cmd.workflowStepId,
        ownerId: cmd.ownerId, dueAt: cmd.dueAt?.toISOString() ?? null,
      };
      await this.eventStore.append({
        tenantId: cmd.tenantId, streamId: id,
        type: 'TaskCreated' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor, client,
      });

      return (await this.getById(cmd.tenantId, id))!;
    });
  }

  async complete(cmd: CompleteTaskCommand): Promise<Task> {
    return this.db.transaction(async (client) => {
      const task = await this.getById(cmd.tenantId, cmd.taskId);
      if (!task) throw new Error(`Task ${cmd.taskId} not found.`);
      if (task.version !== cmd.expectedVersion) throw new StaleTaskError(cmd.taskId, cmd.expectedVersion, task.version);

      await client.query(
        `UPDATE tasks SET status='completed', completed_at=NOW(), version=version+1
         WHERE id=$1 AND tenant_id=$2 AND version=$3`,
        [cmd.taskId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: TaskCompletedPayload = { taskId: String(cmd.taskId), ownerId: task.ownerId, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.taskId, type: 'TaskCompleted' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.taskId))!;
    });
  }

  async reassign(cmd: ReassignTaskCommand): Promise<Task> {
    return this.db.transaction(async (client) => {
      const task = await this.getById(cmd.tenantId, cmd.taskId);
      if (!task) throw new Error(`Task ${cmd.taskId} not found.`);
      if (task.version !== cmd.expectedVersion) throw new StaleTaskError(cmd.taskId, cmd.expectedVersion, task.version);

      await client.query(
        `UPDATE tasks SET owner_id=$1, version=version+1 WHERE id=$2 AND tenant_id=$3 AND version=$4`,
        [cmd.newOwnerId, cmd.taskId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: TaskAssignedPayload = { taskId: String(cmd.taskId), previousOwnerId: task.ownerId, newOwnerId: cmd.newOwnerId };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.taskId, type: 'TaskAssigned' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.taskId))!;
    });
  }

  async escalate(cmd: EscalateTaskCommand): Promise<Task> {
    return this.db.transaction(async (client) => {
      const task = await this.getById(cmd.tenantId, cmd.taskId);
      if (!task) throw new Error(`Task ${cmd.taskId} not found.`);
      if (task.version !== cmd.expectedVersion) throw new StaleTaskError(cmd.taskId, cmd.expectedVersion, task.version);

      await client.query(
        `UPDATE tasks SET status='escalated', escalated_at=NOW(), version=version+1 WHERE id=$1 AND tenant_id=$2 AND version=$3`,
        [cmd.taskId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: TaskEscalatedPayload = { taskId: String(cmd.taskId), ownerId: task.ownerId, reason: cmd.reason, previousVersion: cmd.expectedVersion };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.taskId, type: 'TaskEscalated' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });

      return (await this.getById(cmd.tenantId, cmd.taskId))!;
    });
  }

  async getById(tenantId: string, id: AlaraId): Promise<Task | null> {
    const row = await this.db.queryOne<TaskRow>(`SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return row ? rowToTask(row) : null;
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedTask {
  id: AlaraId; status: TaskStatus; ownerId: string; version: number;
}

export async function reconstructTaskFromEvents(
  eventStore: EventStore, tenantId: string, taskId: AlaraId,
): Promise<ReconstructedTask | null> {
  const events = await eventStore.loadStream(tenantId, taskId);
  if (!events.length) return null;

  let status: TaskStatus = 'open';
  let ownerId = '';
  let version = 0;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'TaskCreated': ownerId = p.ownerId as string; break;
      case 'TaskAssigned': ownerId = p.newOwnerId as string; break;
      case 'TaskCompleted': status = 'completed'; break;
      case 'TaskEscalated': status = 'escalated'; break;
      case 'TaskOverdue': status = 'overdue'; break;
    }
  }

  return { id: taskId, status, ownerId, version };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StaleTaskError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale task version for ${id}: expected ${expected}, got ${actual}`);
    this.name = 'StaleTaskError';
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, taskType: row.task_type,
    title: row.title, description: row.description,
    workflowId: row.workflow_id as AlaraId | null,
    workflowStepId: row.workflow_step_id,
    ownerId: row.owner_id, status: row.status as TaskStatus,
    dueAt: row.due_at ? new Date(row.due_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    escalatedAt: row.escalated_at ? new Date(row.escalated_at) : null,
    version: row.version,
  };
}
