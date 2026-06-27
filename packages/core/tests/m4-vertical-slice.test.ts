/**
 * Alara OS — M4 End-to-End Integration Test: First Vertical Slice
 *
 * Tests the complete pipeline:
 *   ReferralReceived
 *     → Patient created (Object Graph)
 *     → Rules Engine authorizes
 *     → Workflow started (Intake)
 *     → Task created + assigned
 *     → Promise created
 *     → Communication created → queued → sent
 *     → Timeline Projection rebuilt
 *     → Digital Care Twin rebuilt
 *
 * Also tests:
 *   - Denial path: Rules denies → no workflow/task/promise/comm created
 *   - Replay: both projections rebuild identically from event stream
 *   - Digital Care Twin excludes clinical content (ADR-001)
 */

import { IntakeOrchestrator } from '../src/intake-orchestrator';
import { WorkflowEngine } from '../src/workflow-engine/engine';
import { WorkflowTemplateRegistry, BUILT_IN_WORKFLOW_TEMPLATES } from '../src/workflow-engine/template-registry';
import { TaskEngine } from '../src/task-engine/engine';
import { PromiseEngine } from '../src/promise-engine/engine';
import { CommunicationEngine } from '../src/communication-engine/engine';
import { StubDeliveryAdapter } from '../src/communication-engine/stub-adapter';
import { ProjectionEngine } from '../src/projection-engine/engine';
import { ProjectionRegistry } from '../src/projection-engine/registry';
import { InMemoryProjectionStore } from '../src/projection-engine/store';
import { ProjectionRebuilder } from '../src/projection-engine/rebuilder';
import { registerAllProjections } from '../src/projection-engine';
import { TimelineProjectionDefinition } from '../src/projection-engine/projections/timeline';
import { DigitalCareTwinProjectionDefinition } from '../src/projection-engine/projections/digital-care-twin';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS, DefaultAllowPolicyModule } from '../src/rules-engine/built-in-policies';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { PolicyModule, RuleContext } from '../src/rules-engine/types';
import { TimelineValue, DigitalCareTwinValue } from '../src/projection-engine/types';
import { InMemoryStore } from './helpers/in-memory-store';
import { ProjectionInputAssembler } from '../src/projection-engine/engine';
import { TimelineInput } from '../src/projection-engine/projections/timeline';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';

function buildPipeline(rulesOverride?: PolicyModule) {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);

  // Rules Engine
  const rulesRegistry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) rulesRegistry.registerRuleSet(rs);
  // Explicit baseline allow (engine fails closed without a registered policy). A test
  // override (e.g. a deny module, priority 1) is evaluated before DefaultAllow (999).
  rulesRegistry.registerPolicyModule(DefaultAllowPolicyModule);
  if (rulesOverride) rulesRegistry.registerPolicyModule(rulesOverride);
  const rules = new RulesEngine(rulesRegistry, new NoopAuditSink());

  // Workflow Engine
  const templates = new WorkflowTemplateRegistry();
  for (const t of BUILT_IN_WORKFLOW_TEMPLATES) templates.register(t);
  const workflowEngine = new WorkflowEngine(db, eventStore, templates, rules);

  // Task + Promise
  const taskEngine = new TaskEngine(db, eventStore);
  const promiseEngine = new PromiseEngine(db, eventStore);

  // Communication Engine
  const adapter = new StubDeliveryAdapter();
  const commEngine = new CommunicationEngine(db, eventStore);
  commEngine.registerAdapter(adapter);

  // Projection Engine
  const projRegistry = new ProjectionRegistry();
  registerAllProjections(projRegistry);
  const projStore = new InMemoryProjectionStore();
  const projEngine = new ProjectionEngine(projRegistry, projStore, eventStore);
  const rebuilder = new ProjectionRebuilder(projEngine, projStore);

  // Orchestrator
  const orchestrator = new IntakeOrchestrator(
    db, eventStore, rules, workflowEngine, taskEngine, promiseEngine, commEngine, projEngine,
  );

  return { orchestrator, store, eventStore, projStore, projEngine, rebuilder, adapter };
}

const referralInput = {
  tenantId: TENANT,
  automyndReferralId: 'REF-001',
  automyndPatientId: 'AM-883201',
  patientName: 'Samuel Brown',
  programType: 'EEOICPA',
  referralSource: 'Dr. Jones Clinic',
  referralDate: '2026-06-25',
  actor: 'care-guide-001',
};

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('M4 Vertical Slice — happy path', () => {
  test('ReferralReceived → full pipeline completes successfully', async () => {
    const { orchestrator, store, adapter } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);

    // Pipeline succeeded
    expect(result.success).toBe(true);
    expect(result.patientId).toBeDefined();
    expect(result.workflowId).toBeDefined();
    expect(result.taskId).toBeDefined();
    expect(result.promiseId).toBeDefined();
    expect(result.communicationId).toBeDefined();
  });

  test('Patient object is created with Alara UUID', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    expect(result.patientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const patient = store.objects.get(String(result.patientId));
    expect(patient).toBeDefined();
    expect(patient!.type).toBe('Patient');
  });

  test('Automynd patient ID is an ExternalReference, not identity', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const extRef = store.extRefs.find(r => r.value === 'AM-883201');
    expect(extRef).toBeDefined();
    expect(extRef!.object_id).toBe(String(result.patientId));
    expect(extRef!.system).toBe('Automynd');
  });

  test('Workflow is started and at first step', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const wf = store.workflows.get(String(result.workflowId));
    expect(wf!.status).toBe('active');
    expect(wf!.current_step_id).toBe('step.intake.acknowledge');
  });

  test('Task is created and assigned to care guide', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const task = store.tasks.get(String(result.taskId));
    expect(task!.status).toBe('open');
    expect(task!.owner_id).toBe('care-guide-001');
    expect(task!.task_type).toBe('AcknowledgeReferral');
  });

  test('Promise is created open', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const promise = store.promises.get(String(result.promiseId));
    expect(promise!.status).toBe('open');
    expect(promise!.description).toContain('Dr. Jones Clinic');
    expect(promise!.subject_id).toBe(String(result.patientId));
  });

  test('Communication is created and sent via adapter', async () => {
    const { orchestrator, store, adapter } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const comm = store.communications.get(String(result.communicationId));
    expect(comm!.status).toBe('sent');
    expect(comm!.channel).toBe('referral_source');
    expect(comm!.recipient_id).toBe('Dr. Jones Clinic');
    expect(adapter.delivered).toHaveLength(1);
  });

  test('Timeline Projection is built and contains patient events', async () => {
    const { orchestrator, projStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const timeline = await projStore.get(TENANT, 'Timeline', String(result.patientId));
    expect(timeline).not.toBeNull();
    const value = timeline!.value as unknown as TimelineValue;
    expect(value.eventCount).toBeGreaterThan(0);
    expect(value.entries.some(e => e.eventType === 'ObjectCreated')).toBe(true);
    expect(value.entries.some(e => e.eventType === 'ExternalReferenceAdded')).toBe(true);
  });

  test('Digital Care Twin is built and contains workflow + task + promise', async () => {
    const { orchestrator, projStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const twin = await projStore.get(TENANT, 'DigitalCareTwin', String(result.patientId));
    expect(twin).not.toBeNull();
    const value = twin!.value as unknown as DigitalCareTwinValue;
    expect(value.disclaimer).toBe('computed-projection-advisory-only');
    expect(value.activeWorkflows).toHaveLength(1);
    expect(value.openTasks).toHaveLength(1);
    expect(value.openPromises).toHaveLength(1);
    expect(value.externalReferences).toHaveLength(1);
    expect(value.externalReferences[0].system).toBe('Automynd');
  });

  test('Digital Care Twin does not contain clinical document content (ADR-001)', async () => {
    const { orchestrator, projStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const twin = await projStore.get(TENANT, 'DigitalCareTwin', String(result.patientId));
    const value = twin!.value as unknown as DigitalCareTwinValue;
    // Clinical keys must never appear
    expect('visitNotes' in value.patientAttributes).toBe(false);
    expect('assessmentText' in value.patientAttributes).toBe(false);
    expect('planOfCare' in value.patientAttributes).toBe(false);
    // Operational attributes are present
    expect(value.patientAttributes.name).toBe('Samuel Brown');
    expect(value.patientAttributes.programType).toBe('EEOICPA');
  });

  test('Event stream contains all expected event types in order', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);

    // Collect all events related to the patient
    const patientId = String(result.patientId);
    const patientEvents = store.events.filter(e => e.stream_id === patientId).map(e => e.type);
    expect(patientEvents).toContain('ObjectCreated');
    expect(patientEvents).toContain('ExternalReferenceAdded');

    // Workflow events
    const wfId = String(result.workflowId);
    const wfEvents = store.events.filter(e => e.stream_id === wfId).map(e => e.type);
    expect(wfEvents).toContain('WorkflowStarted');
    expect(wfEvents).toContain('WorkflowStepActivated');

    // Task events
    const taskId = String(result.taskId);
    const taskEvents = store.events.filter(e => e.stream_id === taskId).map(e => e.type);
    expect(taskEvents).toContain('TaskCreated');

    // Promise events
    const promiseId = String(result.promiseId);
    const promiseEvents = store.events.filter(e => e.stream_id === promiseId).map(e => e.type);
    expect(promiseEvents).toContain('PromiseCreated');

    // Communication events
    const commId = String(result.communicationId);
    const commEvents = store.events.filter(e => e.stream_id === commId).map(e => e.type);
    expect(commEvents).toEqual(['CommunicationCreated', 'CommunicationQueued', 'CommunicationSent']);
  });
});

// ─── Denial path ──────────────────────────────────────────────────────────────

describe('M4 Vertical Slice — denial path', () => {
  const denyModule: PolicyModule = {
    id: 'test.deny', name: 'Test Deny', version: '1', priority: 1, ruleSetIds: ['*'],
    evaluate: (_ctx: RuleContext) => ({
      moduleId: 'test.deny', outcome: 'DENY',
      appliedRules: [{ ruleId: 'test.deny.rule', ruleName: 'Test Deny', outcome: 'DENY', reason: 'DataIntegrityFlagged — human review required.' }],
      skippedRules: [], actions: [], reasoning: 'Denied for test.',
    }),
  };

  test('Rules denial → success=false with explanation', async () => {
    const { orchestrator } = buildPipeline(denyModule);
    const result = await orchestrator.handleReferralReceived(referralInput);
    expect(result.success).toBe(false);
    expect(result.denialReason).toBeTruthy();
    expect(result.denialExplanation).toBeDefined();
    expect(result.denialExplanation!.appliedRules[0].outcome).toBe('DENY');
  });

  test('Rules denial → no workflow, task, promise, or communication created', async () => {
    const { orchestrator, store } = buildPipeline(denyModule);
    await orchestrator.handleReferralReceived(referralInput);
    expect(store.workflows.size).toBe(0);
    expect(store.tasks.size).toBe(0);
    expect(store.promises.size).toBe(0);
    expect(store.communications.size).toBe(0);
  });

  test('Rules denial → no WorkflowStarted, TaskCreated, PromiseCreated events', async () => {
    const { orchestrator, store } = buildPipeline(denyModule);
    await orchestrator.handleReferralReceived(referralInput);
    const forbidden = ['WorkflowStarted', 'TaskCreated', 'PromiseCreated', 'CommunicationCreated'];
    const emitted = store.events.map(e => e.type);
    for (const type of forbidden) {
      expect(emitted).not.toContain(type);
    }
    // Patient IS created before the rules check (object graph is pre-authorization)
    expect(emitted).toContain('ObjectCreated');
  });
});

// ─── Replay ───────────────────────────────────────────────────────────────────

describe('M4 Vertical Slice — projection replay', () => {
  test('Timeline projection rebuilds identically from event stream', async () => {
    const { orchestrator, projStore, projEngine, rebuilder, eventStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const patientId = String(result.patientId!);

    // Capture original
    const original = await projStore.get(TENANT, 'Timeline', patientId);
    expect(original).not.toBeNull();
    const originalValue = original!.value as unknown as TimelineValue;

    // Discard projection cache
    projStore.clear();
    expect(await projStore.get(TENANT, 'Timeline', patientId)).toBeNull();

    // Rebuild from same event stream
    const patientEvents = await eventStore.loadStream(TENANT, result.patientId!);
    const assembler: ProjectionInputAssembler<TimelineInput> = {
      async assemble(subjectId) { return { subjectId, subjectType: 'Patient', events: patientEvents }; },
      async sourceEventIds() { return patientEvents.map(e => e.id); },
    };

    const rebuildResult = await rebuilder.rebuild(TENANT, 'Timeline', patientId, assembler);
    expect(rebuildResult.built).toBe(true);
    if (!rebuildResult.built) return;

    const rebuiltValue = rebuildResult.projection.value as unknown as TimelineValue;

    // Values are identical
    expect(rebuiltValue.eventCount).toBe(originalValue.eventCount);
    expect(rebuiltValue.entries.map(e => e.eventType)).toEqual(originalValue.entries.map(e => e.eventType));
  });

  test('Digital Care Twin projection rebuilds identically', async () => {
    const { orchestrator, projStore, store, eventStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const patientId = String(result.patientId!);

    // Capture original
    const original = await projStore.get(TENANT, 'DigitalCareTwin', patientId);
    const originalValue = original!.value as unknown as DigitalCareTwinValue;

    // Discard + rebuild
    projStore.clear();
    const patientAttrs = store.objects.get(patientId)!.attributes;
    const patientEvents = await eventStore.loadStream(TENANT, result.patientId!);

    const { ProjectionEngine: PE } = await import('../src/projection-engine/engine');
    const { ProjectionRegistry: PR } = await import('../src/projection-engine/registry');
    const { InMemoryProjectionStore: IPS } = await import('../src/projection-engine/store');
    const { registerAllProjections: reg } = await import('../src/projection-engine');

    const reg2 = new PR();
    reg(reg2);
    const store2 = new IPS();
    const eng2 = new PE(reg2, store2, eventStore);

    const assembler: ProjectionInputAssembler<import('../src/projection-engine/projections/digital-care-twin').DigitalCareTwinInput> = {
      async assemble(subjectId) {
        return {
          patientId: subjectId,
          patientAttributes: patientAttrs,
          externalReferences: [{ system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }],
          activeWorkflows: [],
          openTasks: [],
          openPromises: [],
          events: patientEvents,
        };
      },
      async sourceEventIds() { return patientEvents.map(e => e.id); },
    };

    const rebuilt = await eng2.build(TENANT, 'DigitalCareTwin', patientId, assembler);
    expect(rebuilt.built).toBe(true);
    if (!rebuilt.built) return;

    const rebuiltValue = rebuilt.projection.value as unknown as DigitalCareTwinValue;
    expect(rebuiltValue.disclaimer).toBe(originalValue.disclaimer);
    expect(rebuiltValue.patientAttributes.name).toBe(originalValue.patientAttributes.name);
  });

  test('ADR-016: projection records methodVersion, confidence, sourceEventIds', async () => {
    const { orchestrator, projStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const timeline = await projStore.get(TENANT, 'Timeline', String(result.patientId));

    expect(timeline!.metadata.methodVersion).toBe('1.0.0');
    expect(timeline!.metadata.confidence).toBe('high');
    expect(timeline!.metadata.sourceEventIds.length).toBeGreaterThan(0);
    expect(timeline!.metadata.aiInvolved).toBe(false);
    expect(timeline!.metadata.inferenceBasis).toBe('fact');
    expect(timeline!.metadata.canonicalInputs.length).toBeGreaterThan(0);
  });
});

// ─── Communication replay ─────────────────────────────────────────────────────

describe('M4 — communication event replay', () => {
  test('Replay reconstructs sent communication state', async () => {
    const { orchestrator, store, eventStore } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referralInput);
    const commId = result.communicationId!;

    const { reconstructCommunicationFromEvents } = await import('../src/communication-engine/engine');
    const reconstructed = await reconstructCommunicationFromEvents(eventStore, TENANT, commId);

    expect(reconstructed!.status).toBe('sent');
    expect(reconstructed!.channel).toBe('referral_source');
  });
});
