/**
 * Alara OS — Task Engine Types
 *
 * Tasks are the atomic units of owned work.
 * Every task has: owner · due date · status · audit trail.
 * "No task becomes lost." (Part XI Promise / Workflow doctrine)
 */

import { AlaraId } from '../shared/types';

export type TaskStatus =
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'escalated'
  | 'cancelled';

export interface Task {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly taskType: string;
  readonly title: string;
  readonly description: string;
  /** Alara UUID of the workflow this task belongs to */
  readonly workflowId: AlaraId | null;
  /** Step ID within the workflow */
  readonly workflowStepId: string | null;
  /** Alara UUID of the workforce member who owns this task */
  readonly ownerId: string;
  readonly status: TaskStatus;
  readonly dueAt: Date | null;
  readonly completedAt: Date | null;
  readonly escalatedAt: Date | null;
  readonly version: number;
}

export interface CreateTaskCommand {
  readonly tenantId: string;
  readonly taskType: string;
  readonly title: string;
  readonly description: string;
  readonly workflowId: AlaraId | null;
  readonly workflowStepId: string | null;
  readonly ownerId: string;
  readonly dueAt: Date | null;
  readonly actor: string;
}

export interface CompleteTaskCommand {
  readonly tenantId: string;
  readonly taskId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface ReassignTaskCommand {
  readonly tenantId: string;
  readonly taskId: AlaraId;
  readonly newOwnerId: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface EscalateTaskCommand {
  readonly tenantId: string;
  readonly taskId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface TaskCreatedPayload {
  taskId: string; taskType: string; title: string;
  workflowId: string | null; workflowStepId: string | null;
  ownerId: string; dueAt: string | null;
}

export interface TaskAssignedPayload {
  taskId: string; previousOwnerId: string; newOwnerId: string;
}

export interface TaskCompletedPayload {
  taskId: string; ownerId: string; previousVersion: number;
}

export interface TaskOverduePayload {
  taskId: string; ownerId: string; dueAt: string;
}

export interface TaskEscalatedPayload {
  taskId: string; ownerId: string; reason: string; previousVersion: number;
}
