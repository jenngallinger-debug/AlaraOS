/**
 * Alara OS — Intake Orchestrator
 *
 * Coordinates the engine pipeline for the referral intake flow.
 * The orchestrator owns ZERO business rules. It sequences commands only.
 *
 * Business rules live in:
 *   - Rules Engine (authorization, policy modules)
 *   - Workflow Templates (step definitions, SLAs)
 *   - Policy Modules (consent, participation, AI Act, EMR boundary)
 *
 * Pipeline:
 *   ReferralReceived
 *     → Object Graph (create/find Patient)
 *     → Rules Engine (authorize intake)
 *     → Workflow Engine (start IntakeWorkflow)
 *     → Task Engine (create first-step task)
 *     → Promise Engine (create referral response promise)
 *     → Communication Engine (queue + send referral acknowledgement)
 *     → Projection Engine (rebuild Timeline + Digital Care Twin)
 *
 * If Rules denies: no mutation, explanation returned, audit written.
 */

import { DatabaseClient } from '../shared/database';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { ObjectCommandHandler } from '../object-graph/command-handler';
import { ObjectGraphRepository } from '../object-graph/repository';
import { RulesEngine } from '../rules-engine/engine';
import { RuleContext } from '../rules-engine/types';
import { WorkflowEngine } from '../workflow-engine/engine';
import { WorkflowTemplateRegistry } from '../workflow-engine/template-registry';
import { TaskEngine } from '../task-engine/engine';
import { PromiseEngine } from '../promise-engine/engine';
import { CommunicationEngine } from '../communication-engine/engine';
import { ProjectionEngine } from '../projection-engine/engine';
import { ProjectionInputAssembler } from '../projection-engine/engine';
import { TimelineInput } from '../projection-engine/projections/timeline';
import { DigitalCareTwinInput } from '../projection-engine/projections/digital-care-twin';
import { DomainEvent } from '../events/types';
import { Explanation } from '../rules-engine/types';

// ─── Input / Result ───────────────────────────────────────────────────────────

export interface ReferralReceivedInput {
  readonly tenantId: string;
  readonly automyndReferralId: string;
  readonly automyndPatientId: string;
  readonly patientName: string;
  readonly programType: string;
  readonly referralSource: string;
  readonly referralDate: string;
  readonly actor: string;
}

export interface IntakeOrchestratorResult {
  readonly success: boolean;
  readonly patientId?: AlaraId;
  readonly workflowId?: AlaraId;
  readonly taskId?: AlaraId;
  readonly promiseId?: AlaraId;
  readonly communicationId?: AlaraId;
  readonly denialReason?: string;
  readonly denialExplanation?: Explanation;
  /** All event IDs emitted during this intake flow */
  readonly eventIds: readonly string[];
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class IntakeOrchestrator {
  private readonly objectHandler: ObjectCommandHandler;
  private readonly objectRepo: ObjectGraphRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
    private readonly rules: RulesEngine,
    private readonly workflowEngine: WorkflowEngine,
    private readonly taskEngine: TaskEngine,
    private readonly promiseEngine: PromiseEngine,
    private readonly commEngine: CommunicationEngine,
    private readonly projectionEngine: ProjectionEngine,
  ) {
    this.objectRepo = new ObjectGraphRepository(db);
    this.objectHandler = new ObjectCommandHandler(db, this.objectRepo, eventStore);
  }

  async handleReferralReceived(input: ReferralReceivedInput): Promise<IntakeOrchestratorResult> {
    const eventIds: string[] = [];

    // ── Step 1: Create Patient object ──────────────────────────────────────────
    const { object: patient, eventId: createEvtId } = await this.objectHandler.createObject({
      tenantId: input.tenantId,
      type: 'Patient',
      actor: input.actor,
      attributes: {
        name: input.patientName,
        programType: input.programType,
        referralDate: input.referralDate,
        intakeStatus: 'referral-received',
      },
    });
    eventIds.push(createEvtId);

    // Link Automynd external reference
    const { eventId: extRefEvtId } = await this.objectHandler.addExternalReference(
      input.tenantId, patient.id,
      { system: 'Automynd', extType: 'patient_id', value: input.automyndPatientId },
      input.actor,
    );
    eventIds.push(extRefEvtId);

    // ── Step 2: Rules Engine authorization ────────────────────────────────────
    const ruleContext: RuleContext = {
      tenantId: input.tenantId,
      actor: input.actor,
      eventType: 'AutomyndReferralObserved',
      eventPayload: {
        objectType: 'Patient',
        state: 'created',
        attributes: patient.attributes,
        automyndReferralId: input.automyndReferralId,
        programType: input.programType,
      },
      ruleSetId: 'ruleset.intake',
      objects: {},
      metadata: { accessType: 'write' },
    };

    const decision = await this.rules.evaluate(ruleContext);

    if (decision.outcome === 'DENY') {
      return {
        success: false,
        patientId: patient.id,
        denialReason: decision.explanation.summary,
        denialExplanation: decision.explanation,
        eventIds,
      };
    }

    // ── Step 3: Start Intake Workflow ──────────────────────────────────────────
    const wfResult = await this.workflowEngine.start({
      tenantId: input.tenantId,
      templateId: 'template.intake',
      forObjectId: patient.id,
      forObjectType: 'Patient',
      ownerId: input.actor,
      actor: input.actor,
      correlationId: input.automyndReferralId,
    });

    if (!wfResult.started) {
      return {
        success: false,
        patientId: patient.id,
        denialReason: wfResult.reason,
        denialExplanation: wfResult.explanation,
        eventIds,
      };
    }

    eventIds.push(wfResult.startedEventId, wfResult.stepActivatedEventId);
    const workflow = wfResult.workflow;

    // ── Step 4: Create Task for first step ────────────────────────────────────
    const dueAt = new Date(Date.now() + 4 * 3_600_000); // 4-hour SLA from template
    const task = await this.taskEngine.create({
      tenantId: input.tenantId,
      taskType: 'AcknowledgeReferral',
      title: `Acknowledge referral from ${input.referralSource}`,
      description: `Contact ${input.referralSource} to acknowledge receipt of referral for ${input.patientName}.`,
      workflowId: workflow.id,
      workflowStepId: 'step.intake.acknowledge',
      ownerId: input.actor,
      dueAt,
      actor: input.actor,
    });

    // ── Step 5: Create Promise ─────────────────────────────────────────────────
    const promise = await this.promiseEngine.create({
      tenantId: input.tenantId,
      description: `Alara will respond to ${input.referralSource} within 4 hours of receiving the referral for ${input.patientName}.`,
      subjectId: patient.id,
      recipientId: input.referralSource,
      ownerId: input.actor,
      dueAt,
      workflowId: workflow.id,
      workflowStepId: 'step.intake.acknowledge',
      actor: input.actor,
    });

    // ── Step 6: Create + Queue + Send Communication ───────────────────────────
    const comm = await this.commEngine.create({
      tenantId: input.tenantId,
      channel: 'referral_source',
      purpose: 'referral_acknowledgement',
      subjectId: patient.id,
      workflowId: workflow.id,
      recipientType: 'referral_source',
      recipientId: input.referralSource,
      subject: `Referral Acknowledged — ${input.patientName}`,
      body: [
        `Dear ${input.referralSource},`,
        ``,
        `We have received the referral for ${input.patientName} (Program: ${input.programType}).`,
        ``,
        `Our Care Guide will be in contact within 4 hours to discuss next steps.`,
        ``,
        `Reference: ${input.automyndReferralId}`,
        ``,
        `Thank you,`,
        `Alara Home Care`,
      ].join('\n'),
      actor: input.actor,
    });

    const queuedComm = await this.commEngine.queue({
      tenantId: input.tenantId, communicationId: comm.id,
      actor: input.actor, expectedVersion: comm.version,
    });

    const sentComm = await this.commEngine.send({
      tenantId: input.tenantId, communicationId: queuedComm.id,
      actor: input.actor, expectedVersion: queuedComm.version,
    });

    // ── Step 7: Rebuild Timeline Projection ───────────────────────────────────
    const patientEvents = await this.eventStore.loadStream(input.tenantId, patient.id);

    const timelineAssembler: ProjectionInputAssembler<TimelineInput> = {
      async assemble(subjectId) {
        return { subjectId, subjectType: 'Patient', events: patientEvents };
      },
      async sourceEventIds() { return patientEvents.map((e: DomainEvent) => e.id); },
    };

    await this.projectionEngine.build(
      input.tenantId, 'Timeline', String(patient.id), timelineAssembler,
    );

    // ── Step 8: Rebuild Digital Care Twin ─────────────────────────────────────
    const twinAssembler: ProjectionInputAssembler<DigitalCareTwinInput> = {
      async assemble(subjectId) {
        return {
          patientId: subjectId,
          patientAttributes: patient.attributes,
          externalReferences: [{ system: 'Automynd', extType: 'patient_id', value: input.automyndPatientId }],
          activeWorkflows: [{
            workflowId: String(workflow.id),
            templateId: workflow.templateId,
            status: workflow.status,
            currentStepId: workflow.currentStepId,
          }],
          openTasks: [{
            taskId: String(task.id),
            taskType: task.taskType,
            ownerId: task.ownerId,
            dueAt: task.dueAt?.toISOString() ?? null,
          }],
          openPromises: [{
            promiseId: String(promise.id),
            description: promise.description,
            dueAt: promise.dueAt.toISOString(),
          }],
          events: patientEvents,
        };
      },
      async sourceEventIds() { return patientEvents.map((e: DomainEvent) => e.id); },
    };

    await this.projectionEngine.build(
      input.tenantId, 'DigitalCareTwin', String(patient.id), twinAssembler,
    );

    return {
      success: true,
      patientId: patient.id,
      workflowId: workflow.id,
      taskId: task.id,
      promiseId: promise.id,
      communicationId: sentComm.id,
      eventIds,
    };
  }
}
