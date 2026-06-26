/**
 * Alara OS — Workflow Engine
 *
 * Turns authorized events into owned, tracked work.
 * "The first place Alara OS acts together."
 *
 * INVARIANTS:
 *   1. Rules Engine is invoked before any workflow side effect.
 *   2. Denied commands produce no state mutation and no events.
 *   3. Every state change appends an event to the stream.
 *   4. All state is reconstructable from the event stream.
 *   5. No workflow disappears silently — suppressed workflows emit events.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId, newEventId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { RulesEngine } from '../rules-engine/engine';
import { RuleContext } from '../rules-engine/types';
import { WorkflowTemplateRegistry } from './template-registry';
import {
  AdvanceWorkflowCommand,
  StartWorkflowCommand,
  StartWorkflowResult,
  SuppressWorkflowCommand,
  WorkflowAdvancedPayload,
  WorkflowCompletedPayload,
  WorkflowDenied,
  WorkflowInstance,
  WorkflowStartedPayload,
  WorkflowStepActivatedPayload,
  WorkflowStepState,
  WorkflowSuppressedPayload,
} from './types';

// ─── Row shapes ───────────────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  tenant_id: string;
  template_id: string;
  template_version: string;
  name: string;
  for_object_id: string;
  for_object_type: string;
  status: string;
  current_step_id: string | null;
  owner_id: string;
  steps: WorkflowStepState[];
  version: number;
  started_at: string | null;
  completed_at: string | null;
  suppression_reason: string | null;
}

// ─── Workflow Engine ──────────────────────────────────────────────────────────

export class WorkflowEngine {
  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
    private readonly templates: WorkflowTemplateRegistry,
    private readonly rules: RulesEngine,
  ) {}

  /**
   * Start a workflow for a given object.
   * Invokes the Rules Engine first — denied commands produce no mutation.
   */
  async start(cmd: StartWorkflowCommand): Promise<StartWorkflowResult> {
    const template = this.templates.getById(cmd.templateId);
    if (!template) {
      return this.deny(
        `Workflow template "${cmd.templateId}" not found.`,
        { summary: 'Unknown template', reasoning: [`Template "${cmd.templateId}" is not registered.`], appliedRules: [], skippedRules: [] },
        newEventId(),
      );
    }

    // ── Rules Engine check ─────────────────────────────────────────────────────
    const ruleContext: RuleContext = {
      tenantId: cmd.tenantId,
      actor: cmd.actor,
      eventType: 'WorkflowStartRequested',
      eventPayload: {
        templateId: cmd.templateId,
        forObjectId: cmd.forObjectId,
        forObjectType: cmd.forObjectType,
      },
      ruleSetId: template.ruleSetId,
      objects: {},
      metadata: { accessType: 'write' },
    };

    const decision = await this.rules.evaluate(ruleContext);

    if (decision.outcome === 'DENY') {
      return this.deny(
        `Workflow start denied: ${decision.explanation.summary}`,
        decision.explanation,
        newEventId(),
      );
    }

    // ── Create the workflow instance ───────────────────────────────────────────
    return this.db.transaction(async (client) => {
      const workflowId = newAlaraId();
      const firstStep = template.steps.find(s => s.order === 1)!;

      const steps: WorkflowStepState[] = template.steps.map(s => ({
        stepId: s.id,
        stepName: s.name,
        status: s.order === 1 ? 'active' : 'pending',
        activatedAt: s.order === 1 ? new Date() : null,
        completedAt: null,
        taskId: null,
        promiseId: null,
      }));

      // Insert the workflow row
      await client.query(
        `INSERT INTO workflows
           (id, tenant_id, template_id, template_version, name, for_object_id,
            for_object_type, status, current_step_id, owner_id, steps, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,1)`,
        [
          workflowId, cmd.tenantId, template.id, template.version,
          template.name, cmd.forObjectId, cmd.forObjectType,
          firstStep.id, cmd.ownerId, JSON.stringify(steps),
        ],
      );

      // Append WorkflowStarted
      const startPayload: WorkflowStartedPayload = {
        workflowId: String(workflowId),
        templateId: template.id,
        templateVersion: template.version,
        name: template.name,
        forObjectId: String(cmd.forObjectId),
        forObjectType: cmd.forObjectType,
        ownerId: cmd.ownerId,
        firstStepId: firstStep.id,
        steps: template.steps.map(s => ({ stepId: s.id, stepName: s.name })),
      };

      const startEvt = await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: workflowId,
        type: 'WorkflowStarted' as EventType,
        payload: startPayload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        correlationId: cmd.correlationId,
        client,
      });

      // Append WorkflowStepActivated for first step
      const stepPayload: WorkflowStepActivatedPayload = {
        workflowId: String(workflowId),
        stepId: firstStep.id,
        stepName: firstStep.name,
        ownerId: cmd.ownerId,
        slaHours: firstStep.slaHours ?? null,
        taskType: firstStep.taskType ?? null,
        createsPromise: firstStep.createsPromise ?? false,
        promiseDescription: firstStep.promiseDescription ?? null,
      };

      const stepEvt = await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: workflowId,
        type: 'WorkflowStepActivated' as EventType,
        payload: stepPayload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        causationId: startEvt.id,
        correlationId: cmd.correlationId,
        client,
      });

      const workflow = await this.getById(cmd.tenantId, workflowId);

      return {
        started: true,
        workflow: workflow!,
        startedEventId: startEvt.id,
        stepActivatedEventId: stepEvt.id,
      };
    });
  }

  /**
   * Mark a step complete and activate the next one (or complete the workflow).
   */
  async advance(cmd: AdvanceWorkflowCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      const wf = await this.getById(cmd.tenantId, cmd.workflowId);
      if (!wf) throw new Error(`Workflow ${cmd.workflowId} not found.`);
      if (wf.version !== cmd.expectedVersion) {
        throw new StaleWorkflowError(cmd.workflowId, cmd.expectedVersion, wf.version);
      }

      const steps = [...wf.steps];
      const currentIdx = steps.findIndex(s => s.stepId === cmd.completedStepId);
      if (currentIdx < 0) throw new Error(`Step ${cmd.completedStepId} not found on workflow ${cmd.workflowId}.`);

      steps[currentIdx] = { ...steps[currentIdx], status: 'completed', completedAt: new Date() };

      const nextStep = steps.find(s => s.status === 'pending');
      const isComplete = !nextStep;

      if (nextStep) {
        steps[steps.indexOf(nextStep)] = { ...nextStep, status: 'active', activatedAt: new Date() };
      }

      const newStatus = isComplete ? 'completed' : 'active';
      await client.query(
        `UPDATE workflows SET status=$1, current_step_id=$2, steps=$3, version=version+1,
          completed_at=$4 WHERE id=$5 AND tenant_id=$6 AND version=$7`,
        [newStatus, nextStep?.stepId ?? null, JSON.stringify(steps),
          isComplete ? new Date() : null, cmd.workflowId, cmd.tenantId, cmd.expectedVersion],
      );

      if (isComplete) {
        const payload: WorkflowCompletedPayload = {
          workflowId: String(cmd.workflowId), completedStepId: cmd.completedStepId, previousVersion: cmd.expectedVersion,
        };
        await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.workflowId, type: 'WorkflowCompleted' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });
      } else {
        const advPayload: WorkflowAdvancedPayload = {
          workflowId: String(cmd.workflowId), completedStepId: cmd.completedStepId, nextStepId: nextStep!.stepId, previousVersion: cmd.expectedVersion,
        };
        await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.workflowId, type: 'WorkflowAdvanced' as EventType, payload: advPayload as unknown as Record<string, unknown>, actor: cmd.actor, client });

        const template = this.templates.getById(wf.templateId);
        const nextTemplateDef = template?.steps.find(s => s.id === nextStep!.stepId);
        if (nextTemplateDef) {
          const stepPayload: WorkflowStepActivatedPayload = {
            workflowId: String(cmd.workflowId), stepId: nextTemplateDef.id, stepName: nextTemplateDef.name,
            ownerId: cmd.actor, slaHours: nextTemplateDef.slaHours ?? null,
            taskType: nextTemplateDef.taskType ?? null, createsPromise: nextTemplateDef.createsPromise ?? false,
            promiseDescription: nextTemplateDef.promiseDescription ?? null,
          };
          await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.workflowId, type: 'WorkflowStepActivated' as EventType, payload: stepPayload as unknown as Record<string, unknown>, actor: cmd.actor, client });
        }
      }
    });
  }

  /**
   * Suppress a workflow (data integrity conflict, consent revoked, etc.).
   * The workflow emits a WorkflowSuppressed event — it never disappears silently.
   */
  async suppress(cmd: SuppressWorkflowCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      await client.query(
        `UPDATE workflows SET status='suppressed', suppression_reason=$1, version=version+1
          WHERE id=$2 AND tenant_id=$3 AND version=$4`,
        [cmd.reason, cmd.workflowId, cmd.tenantId, cmd.expectedVersion],
      );
      const payload: WorkflowSuppressedPayload = {
        workflowId: String(cmd.workflowId), reason: cmd.reason, previousVersion: cmd.expectedVersion,
      };
      await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.workflowId, type: 'WorkflowSuppressed' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor, client });
    });
  }

  async getById(tenantId: string, id: AlaraId): Promise<WorkflowInstance | null> {
    const row = await this.db.queryOne<WorkflowRow>(
      `SELECT * FROM workflows WHERE id=$1 AND tenant_id=$2`, [id, tenantId],
    );
    return row ? rowToInstance(row) : null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private deny(reason: string, explanation: import('../rules-engine/types').Explanation, auditId: string): WorkflowDenied {
    return { started: false, reason, explanation, auditId };
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedWorkflow {
  id: AlaraId;
  templateId: string;
  status: string;
  currentStepId: string | null;
  ownerId: string;
  steps: WorkflowStepState[];
  version: number;
  suppressionReason: string | null;
}

export async function reconstructWorkflowFromEvents(
  eventStore: EventStore,
  tenantId: string,
  workflowId: AlaraId,
): Promise<ReconstructedWorkflow | null> {
  const events = await eventStore.loadStream(tenantId, workflowId);
  if (!events.length) return null;

  let templateId = '';
  let status = 'pending';
  let currentStepId: string | null = null;
  let ownerId = '';
  let steps: WorkflowStepState[] = [];
  let version = 0;
  let suppressionReason: string | null = null;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'WorkflowStarted': {
        templateId = p.templateId as string;
        status = 'active';
        ownerId = p.ownerId as string;
        currentStepId = p.firstStepId as string;
        steps = (p.steps as { stepId: string; stepName: string }[]).map(s => ({
          stepId: s.stepId, stepName: s.stepName, status: 'pending',
          activatedAt: null, completedAt: null, taskId: null, promiseId: null,
        }));
        break;
      }
      case 'WorkflowStepActivated': {
        currentStepId = p.stepId as string;
        steps = steps.map(s => s.stepId === p.stepId
          ? { ...s, status: 'active', activatedAt: new Date() }
          : s);
        break;
      }
      case 'WorkflowAdvanced': {
        steps = steps.map(s => s.stepId === p.completedStepId
          ? { ...s, status: 'completed', completedAt: new Date() }
          : s);
        currentStepId = (p.nextStepId as string) ?? null;
        break;
      }
      case 'WorkflowCompleted': {
        steps = steps.map(s => s.stepId === p.completedStepId
          ? { ...s, status: 'completed', completedAt: new Date() }
          : s);
        status = 'completed';
        currentStepId = null;
        break;
      }
      case 'WorkflowSuppressed': {
        status = 'suppressed';
        suppressionReason = p.reason as string;
        break;
      }
      case 'TaskLinkedToStep': {
        steps = steps.map(s => s.stepId === p.stepId
          ? { ...s, taskId: p.taskId as AlaraId }
          : s);
        break;
      }
      case 'PromiseLinkedToStep': {
        steps = steps.map(s => s.stepId === p.stepId
          ? { ...s, promiseId: p.promiseId as AlaraId }
          : s);
        break;
      }
    }
  }

  return { id: workflowId, templateId, status, currentStepId, ownerId, steps, version, suppressionReason };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StaleWorkflowError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(`Stale workflow version for ${id}: expected ${expected}, got ${actual}`);
    this.name = 'StaleWorkflowError';
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function rowToInstance(row: WorkflowRow): WorkflowInstance {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    name: row.name,
    forObjectId: row.for_object_id as AlaraId,
    forObjectType: row.for_object_type,
    status: row.status as WorkflowInstance['status'],
    currentStepId: row.current_step_id,
    ownerId: row.owner_id,
    steps: row.steps,
    version: row.version,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    suppressionReason: row.suppression_reason,
  };
}
