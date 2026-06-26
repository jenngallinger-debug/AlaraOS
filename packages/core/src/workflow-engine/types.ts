/**
 * Alara OS — Workflow Engine Types
 *
 * Workflows are living objects — not templates, not passive records.
 * Every workflow knows: purpose · owner · stage · status · participants ·
 * timeline · communications · outcome · learning.
 *
 * Constitutional alignment (Part XI): "No workflow becomes lost."
 * Every state transition appends an event. State is always reconstructable
 * from the event stream.
 */

import { AlaraId } from '../shared/types';

// ─── Workflow status ───────────────────────────────────────────────────────────

export type WorkflowStatus =
  | 'pending'       // created, not yet started
  | 'active'        // in progress
  | 'paused'        // temporarily halted
  | 'completed'     // all steps done
  | 'suppressed'    // blocked by data integrity / consent issue
  | 'failed';       // terminal failure

// ─── Workflow step ────────────────────────────────────────────────────────────

export type WorkflowStepStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface WorkflowStep {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly order: number;
  readonly required: boolean;
  /** Alara UUID of the workforce member responsible for this step */
  readonly ownerId?: string;
  /** SLA in hours from step activation */
  readonly slaHours?: number;
  /** Task type to create when this step activates */
  readonly taskType?: string;
  /** Whether the step creates a Promise */
  readonly createsPromise?: boolean;
  readonly promiseDescription?: string;
}

// ─── Workflow template ────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly ruleSetId: string; // Rules Engine rule set to invoke before starting
  readonly steps: readonly WorkflowStep[];
  readonly defaultOwnerPool: string; // e.g. 'care-guide-pool'
}

// ─── Workflow instance ────────────────────────────────────────────────────────

export interface WorkflowInstance {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly name: string;
  /** Alara UUID of the object this workflow serves (e.g. Patient) */
  readonly forObjectId: AlaraId;
  readonly forObjectType: string;
  readonly status: WorkflowStatus;
  readonly currentStepId: string | null;
  /** Alara UUID of the workforce member who owns this workflow */
  readonly ownerId: string;
  readonly steps: readonly WorkflowStepState[];
  readonly version: number;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly suppressionReason: string | null;
}

export interface WorkflowStepState {
  readonly stepId: string;
  readonly stepName: string;
  readonly status: WorkflowStepStatus;
  readonly activatedAt: Date | null;
  readonly completedAt: Date | null;
  /** Alara UUID of task created for this step */
  readonly taskId: AlaraId | null;
  /** Alara UUID of promise created for this step */
  readonly promiseId: AlaraId | null;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface StartWorkflowCommand {
  readonly tenantId: string;
  readonly templateId: string;
  readonly forObjectId: AlaraId;
  readonly forObjectType: string;
  readonly ownerId: string;
  readonly actor: string;
  readonly triggerEventId?: string;
  readonly correlationId?: string;
}

export interface AdvanceWorkflowCommand {
  readonly tenantId: string;
  readonly workflowId: AlaraId;
  readonly completedStepId: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface SuppressWorkflowCommand {
  readonly tenantId: string;
  readonly workflowId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface WorkflowStartedPayload {
  readonly workflowId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly name: string;
  readonly forObjectId: string;
  readonly forObjectType: string;
  readonly ownerId: string;
  readonly firstStepId: string;
  readonly steps: readonly { stepId: string; stepName: string }[];
}

export interface WorkflowStepActivatedPayload {
  readonly workflowId: string;
  readonly stepId: string;
  readonly stepName: string;
  readonly ownerId: string;
  readonly slaHours: number | null;
  readonly taskType: string | null;
  readonly createsPromise: boolean;
  readonly promiseDescription: string | null;
}

export interface WorkflowAdvancedPayload {
  readonly workflowId: string;
  readonly completedStepId: string;
  readonly nextStepId: string | null;
  readonly previousVersion: number;
}

export interface WorkflowCompletedPayload {
  readonly workflowId: string;
  readonly completedStepId: string;
  readonly previousVersion: number;
}

export interface WorkflowSuppressedPayload {
  readonly workflowId: string;
  readonly reason: string;
  readonly previousVersion: number;
}

// ─── Denial result ────────────────────────────────────────────────────────────

export interface WorkflowDenied {
  readonly started: false;
  readonly reason: string;
  readonly explanation: import('../rules-engine/types').Explanation;
  readonly auditId: string;
}

export interface WorkflowStarted {
  readonly started: true;
  readonly workflow: WorkflowInstance;
  readonly startedEventId: string;
  readonly stepActivatedEventId: string;
}

export type StartWorkflowResult = WorkflowStarted | WorkflowDenied;
