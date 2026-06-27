/**
 * Alara OS — M2 Tests: Workflow / Task / Promise Spine
 *
 * Acceptance criteria:
 *   AC-1:  Authorized referral → workflow + task + promise created.
 *   AC-2:  Denied referral → no workflow/task/promise created.
 *   AC-3:  Every state transition appends events.
 *   AC-4:  Replay reconstructs workflow state.
 *   AC-5:  Replay reconstructs task state.
 *   AC-6:  Replay reconstructs promise state.
 *   AC-7:  Promise cannot disappear silently.
 *   AC-8:  Task stale-version update fails.
 *   AC-9:  Rules Engine explanations appear on denial.
 *   AC-10: All tests pass.
 */

import { WorkflowEngine, reconstructWorkflowFromEvents, StaleWorkflowError, INTAKE_WORKFLOW_TEMPLATE } from '../src/workflow-engine';
import { WorkflowTemplateRegistry } from '../src/workflow-engine/template-registry';
import { TaskEngine, reconstructTaskFromEvents, StaleTaskError } from '../src/task-engine';
import { PromiseEngine, reconstructPromiseFromEvents, StalePromiseError } from '../src/promise-engine';
import { EventStore } from '../src/events/store';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS, DefaultAllowPolicyModule } from '../src/rules-engine/built-in-policies';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { AlaraId } from '../src/shared/types';
import { PolicyModule, RuleContext } from '../src/rules-engine/types';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup helpers ─────────────────────────────────────────────────────────────

const TENANT = 'alara-home-care';
const PATIENT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');
const CARE_GUIDE = 'care-guide-001';

function makeAllowEngine(): RulesEngine {
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  // Intentional allow must be EXPLICIT: the engine now fails closed for rule sets with
  // no registered policy, so register DefaultAllowPolicyModule ('*') to permit.
  registry.registerPolicyModule(DefaultAllowPolicyModule);
  return new RulesEngine(registry, new NoopAuditSink());
}

function makeDenyEngine(reason: string): RulesEngine {
  const denyModule: PolicyModule = {
    id: 'test.deny', name: 'Test Deny', version: '1', priority: 1, ruleSetIds: ['*'],
    evaluate: (ctx: RuleContext) => ({
      moduleId: 'test.deny', outcome: 'DENY',
      appliedRules: [{ ruleId: 'test.deny.rule', ruleName: 'Test Deny', outcome: 'DENY', reason }],
      skippedRules: [], actions: [], reasoning: reason,
    }),
  };
  const registry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) registry.registerRuleSet(rs);
  registry.registerPolicyModule(denyModule);
  return new RulesEngine(registry, new NoopAuditSink());
}

function makeEngines(rulesEngine?: RulesEngine) {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const templates = new WorkflowTemplateRegistry();
  templates.register(INTAKE_WORKFLOW_TEMPLATE);
  const rules = rulesEngine ?? makeAllowEngine();
  const workflow = new WorkflowEngine(db, eventStore, templates, rules);
  const task = new TaskEngine(db, eventStore);
  const promise = new PromiseEngine(db, eventStore);
  return { store, db, eventStore, workflow, task, promise };
}

// ─── AC-1: Authorized referral → workflow + task + promise ────────────────────

describe('AC-1: Authorized referral creates workflow + task + promise', () => {
  test('WorkflowStarted + WorkflowStepActivated events emitted', async () => {
    const { workflow, eventStore } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });

    expect(result.started).toBe(true);
    if (!result.started) return;

    const events = await eventStore.loadStream(TENANT, result.workflow.id);
    expect(events.map(e => e.type)).toEqual(['WorkflowStarted', 'WorkflowStepActivated']);
    expect(result.workflow.status).toBe('active');
    expect(result.workflow.currentStepId).toBe('step.intake.acknowledge');
  });

  test('Task created for first step', async () => {
    const { workflow, task } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    expect(result.started).toBe(true);
    if (!result.started) return;

    const t = await task.create({
      tenantId: TENANT, taskType: 'AcknowledgeReferral',
      title: 'Acknowledge Referral', description: 'Contact referral source',
      workflowId: result.workflow.id, workflowStepId: 'step.intake.acknowledge',
      ownerId: CARE_GUIDE, dueAt: new Date(Date.now() + 4 * 3600_000),
      actor: CARE_GUIDE,
    });

    expect(t.id).toBeDefined();
    expect(t.status).toBe('open');
    expect(t.ownerId).toBe(CARE_GUIDE);
    expect(t.workflowId).toBe(result.workflow.id);
  });

  test('Promise created for first step', async () => {
    const { workflow, promise } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    expect(result.started).toBe(true);
    if (!result.started) return;

    const p = await promise.create({
      tenantId: TENANT,
      description: 'Alara will respond to the referral source within 4 hours.',
      subjectId: PATIENT_ID, recipientId: 'referral-source-001',
      ownerId: CARE_GUIDE, dueAt: new Date(Date.now() + 4 * 3600_000),
      workflowId: result.workflow.id, workflowStepId: 'step.intake.acknowledge',
      actor: CARE_GUIDE,
    });

    expect(p.id).toBeDefined();
    expect(p.status).toBe('open');
    expect(p.description).toContain('respond to the referral source');
  });
});

// ─── AC-2: Denied referral → nothing created ──────────────────────────────────

describe('AC-2: Denied referral creates no workflow / task / promise', () => {
  test('Denied start returns started=false with explanation', async () => {
    const { workflow, store } = makeEngines(makeDenyEngine('DataIntegrityFlagged — human review required.'));

    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });

    expect(result.started).toBe(false);
    if (result.started) return;

    // AC-9: explanation present on denial
    expect(result.explanation.summary).toBeTruthy();
    expect(result.explanation.appliedRules.length).toBeGreaterThan(0);
    expect(result.reason).toContain('denied');

    // No workflow created in store
    expect(store.workflows.size).toBe(0);
  });

  test('No events appended when workflow denied', async () => {
    const { workflow, store } = makeEngines(makeDenyEngine('Deny for test.'));
    await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    // No workflow events in the store at all
    expect(store.events.filter(e => e.type === 'WorkflowStarted')).toHaveLength(0);
  });
});

// ─── AC-3: Every state transition appends events ──────────────────────────────

describe('AC-3: Every state transition appends events', () => {
  test('WorkflowAdvanced event on step completion', async () => {
    const { workflow, eventStore } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    expect(result.started).toBe(true);
    if (!result.started) return;

    await workflow.advance({
      tenantId: TENANT, workflowId: result.workflow.id,
      completedStepId: 'step.intake.acknowledge',
      actor: CARE_GUIDE, expectedVersion: result.workflow.version,
    });

    const events = await eventStore.loadStream(TENANT, result.workflow.id);
    expect(events.some(e => e.type === 'WorkflowAdvanced')).toBe(true);
    expect(events.some(e => e.type === 'WorkflowStepActivated')).toBe(true);
  });

  test('WorkflowCompleted event when all steps done', async () => {
    const { workflow, eventStore } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    expect(result.started).toBe(true);
    if (!result.started) return;

    let wf = result.workflow;
    for (const step of INTAKE_WORKFLOW_TEMPLATE.steps) {
      await workflow.advance({ tenantId: TENANT, workflowId: wf.id, completedStepId: step.id, actor: CARE_GUIDE, expectedVersion: wf.version });
      wf = (await workflow.getById(TENANT, wf.id))!;
    }

    const events = await eventStore.loadStream(TENANT, result.workflow.id);
    expect(events.some(e => e.type === 'WorkflowCompleted')).toBe(true);
    expect(wf.status).toBe('completed');
  });

  test('TaskCompleted appends event', async () => {
    const { task, eventStore } = makeEngines();
    const t = await task.create({ tenantId: TENANT, taskType: 'Test', title: 'Test task', description: '', workflowId: null, workflowStepId: null, ownerId: CARE_GUIDE, dueAt: null, actor: CARE_GUIDE });
    await task.complete({ tenantId: TENANT, taskId: t.id, actor: CARE_GUIDE, expectedVersion: 1 });
    const events = await eventStore.loadStream(TENANT, t.id);
    expect(events.map(e => e.type)).toContain('TaskCompleted');
  });

  test('PromiseKept appends event', async () => {
    const { promise, eventStore } = makeEngines();
    const p = await promise.create({ tenantId: TENANT, description: 'test', subjectId: PATIENT_ID, recipientId: 'r-1', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.keep({ tenantId: TENANT, promiseId: p.id, actor: CARE_GUIDE, expectedVersion: 1 });
    const events = await eventStore.loadStream(TENANT, p.id);
    expect(events.map(e => e.type)).toContain('PromiseKept');
  });
});

// ─── AC-4: Replay reconstructs workflow state ─────────────────────────────────

describe('AC-4: Replay reconstructs workflow state', () => {
  test('Reconstructed workflow matches live state after advance', async () => {
    const { workflow, eventStore } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    expect(result.started).toBe(true);
    if (!result.started) return;

    await workflow.advance({ tenantId: TENANT, workflowId: result.workflow.id, completedStepId: 'step.intake.acknowledge', actor: CARE_GUIDE, expectedVersion: result.workflow.version });

    const reconstructed = await reconstructWorkflowFromEvents(eventStore, TENANT, result.workflow.id);
    const live = await workflow.getById(TENANT, result.workflow.id);

    expect(reconstructed!.status).toBe(live!.status);
    expect(reconstructed!.currentStepId).toBe(live!.currentStepId);
    expect(reconstructed!.templateId).toBe(live!.templateId);
  });

  test('Suppressed workflow reconstructs suppression reason', async () => {
    const { workflow, eventStore } = makeEngines();
    const result = await workflow.start({
      tenantId: TENANT, templateId: 'template.intake',
      forObjectId: PATIENT_ID, forObjectType: 'Patient',
      ownerId: CARE_GUIDE, actor: CARE_GUIDE,
    });
    expect(result.started).toBe(true);
    if (!result.started) return;

    await workflow.suppress({ tenantId: TENANT, workflowId: result.workflow.id, reason: 'DataIntegrityFlagged', actor: 'system', expectedVersion: result.workflow.version });

    const reconstructed = await reconstructWorkflowFromEvents(eventStore, TENANT, result.workflow.id);
    expect(reconstructed!.status).toBe('suppressed');
    expect(reconstructed!.suppressionReason).toBe('DataIntegrityFlagged');
  });
});

// ─── AC-5: Replay reconstructs task state ────────────────────────────────────

describe('AC-5: Replay reconstructs task state', () => {
  test('Created → reassigned → completed reconstructed from events', async () => {
    const { task, eventStore } = makeEngines();
    const t = await task.create({ tenantId: TENANT, taskType: 'T', title: 'T', description: '', workflowId: null, workflowStepId: null, ownerId: CARE_GUIDE, dueAt: null, actor: CARE_GUIDE });
    await task.reassign({ tenantId: TENANT, taskId: t.id, newOwnerId: 'care-guide-002', actor: 'manager', expectedVersion: 1 });
    await task.complete({ tenantId: TENANT, taskId: t.id, actor: 'care-guide-002', expectedVersion: 2 });

    const reconstructed = await reconstructTaskFromEvents(eventStore, TENANT, t.id);
    expect(reconstructed!.status).toBe('completed');
    expect(reconstructed!.ownerId).toBe('care-guide-002');
    expect(reconstructed!.version).toBe(3);
  });
});

// ─── AC-6: Replay reconstructs promise state ─────────────────────────────────

describe('AC-6: Replay reconstructs promise state', () => {
  test('Open → kept reconstructed', async () => {
    const { promise, eventStore } = makeEngines();
    const p = await promise.create({ tenantId: TENANT, description: 'call tomorrow', subjectId: PATIENT_ID, recipientId: 'family-001', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.keep({ tenantId: TENANT, promiseId: p.id, actor: CARE_GUIDE, expectedVersion: 1 });

    const r = await reconstructPromiseFromEvents(eventStore, TENANT, p.id);
    expect(r!.status).toBe('kept');
    expect(r!.description).toBe('call tomorrow');
  });

  test('Open → voided with consent-revoked reason reconstructed', async () => {
    const { promise, eventStore } = makeEngines();
    const p = await promise.create({ tenantId: TENANT, description: 'send guide', subjectId: PATIENT_ID, recipientId: 'family-001', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.void({ tenantId: TENANT, promiseId: p.id, reason: 'consent-revoked', actor: 'system', expectedVersion: 1 });

    const r = await reconstructPromiseFromEvents(eventStore, TENANT, p.id);
    expect(r!.status).toBe('voided');
    expect(r!.voidReason).toBe('consent-revoked');
  });
});

// ─── AC-7: Promise cannot disappear silently ──────────────────────────────────

describe('AC-7: Promise cannot disappear silently', () => {
  test('Every terminal state emits an event', async () => {
    const { promise, eventStore } = makeEngines();

    // kept
    const p1 = await promise.create({ tenantId: TENANT, description: 'p1', subjectId: PATIENT_ID, recipientId: 'r', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.keep({ tenantId: TENANT, promiseId: p1.id, actor: CARE_GUIDE, expectedVersion: 1 });
    const e1 = await eventStore.loadStream(TENANT, p1.id);
    expect(e1.some(e => e.type === 'PromiseKept')).toBe(true);

    // missed
    const p2 = await promise.create({ tenantId: TENANT, description: 'p2', subjectId: PATIENT_ID, recipientId: 'r', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.miss({ tenantId: TENANT, promiseId: p2.id, actor: 'system', expectedVersion: 1 });
    const e2 = await eventStore.loadStream(TENANT, p2.id);
    expect(e2.some(e => e.type === 'PromiseMissed')).toBe(true);

    // voided
    const p3 = await promise.create({ tenantId: TENANT, description: 'p3', subjectId: PATIENT_ID, recipientId: 'r', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.void({ tenantId: TENANT, promiseId: p3.id, reason: 'workflow-suppressed', actor: 'system', expectedVersion: 1 });
    const e3 = await eventStore.loadStream(TENANT, p3.id);
    expect(e3.some(e => e.type === 'PromiseVoided')).toBe(true);
  });

  test('Voiding an already-kept promise throws — cannot re-terminal', async () => {
    const { promise } = makeEngines();
    const p = await promise.create({ tenantId: TENANT, description: 'p', subjectId: PATIENT_ID, recipientId: 'r', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.keep({ tenantId: TENANT, promiseId: p.id, actor: CARE_GUIDE, expectedVersion: 1 });
    await expect(promise.void({ tenantId: TENANT, promiseId: p.id, reason: 'manual', actor: 'system', expectedVersion: 2 })).rejects.toThrow('Cannot void');
  });

  test('consent-revoked void reason is accepted without Consent Engine', async () => {
    const { promise } = makeEngines();
    const p = await promise.create({ tenantId: TENANT, description: 'p', subjectId: PATIENT_ID, recipientId: 'r', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    const voided = await promise.void({ tenantId: TENANT, promiseId: p.id, reason: 'consent-revoked', actor: 'system', expectedVersion: 1 });
    expect(voided.status).toBe('voided');
    expect(voided.voidReason).toBe('consent-revoked');
  });
});

// ─── AC-8: Task stale-version update fails ────────────────────────────────────

describe('AC-8: Task stale-version update fails', () => {
  test('Completing task with wrong version throws StaleTaskError', async () => {
    const { task } = makeEngines();
    const t = await task.create({ tenantId: TENANT, taskType: 'T', title: 'T', description: '', workflowId: null, workflowStepId: null, ownerId: CARE_GUIDE, dueAt: null, actor: CARE_GUIDE });
    // First completion succeeds
    await task.complete({ tenantId: TENANT, taskId: t.id, actor: CARE_GUIDE, expectedVersion: 1 });
    // Second attempt with stale version 1 should fail
    await expect(task.complete({ tenantId: TENANT, taskId: t.id, actor: CARE_GUIDE, expectedVersion: 1 })).rejects.toThrow(StaleTaskError);
  });

  test('Stale workflow advance throws StaleWorkflowError', async () => {
    const { workflow } = makeEngines();
    const result = await workflow.start({ tenantId: TENANT, templateId: 'template.intake', forObjectId: PATIENT_ID, forObjectType: 'Patient', ownerId: CARE_GUIDE, actor: CARE_GUIDE });
    expect(result.started).toBe(true);
    if (!result.started) return;
    await workflow.advance({ tenantId: TENANT, workflowId: result.workflow.id, completedStepId: 'step.intake.acknowledge', actor: CARE_GUIDE, expectedVersion: result.workflow.version });
    await expect(workflow.advance({ tenantId: TENANT, workflowId: result.workflow.id, completedStepId: 'step.intake.acknowledge', actor: CARE_GUIDE, expectedVersion: result.workflow.version })).rejects.toThrow(StaleWorkflowError);
  });

  test('Stale promise keep throws StalePromiseError', async () => {
    const { promise } = makeEngines();
    const p = await promise.create({ tenantId: TENANT, description: 'p', subjectId: PATIENT_ID, recipientId: 'r', ownerId: CARE_GUIDE, dueAt: new Date(), workflowId: null, workflowStepId: null, actor: CARE_GUIDE });
    await promise.keep({ tenantId: TENANT, promiseId: p.id, actor: CARE_GUIDE, expectedVersion: 1 });
    await expect(promise.keep({ tenantId: TENANT, promiseId: p.id, actor: CARE_GUIDE, expectedVersion: 1 })).rejects.toThrow(StalePromiseError);
  });
});

// ─── AC-9: Rules Engine explanation on denial ─────────────────────────────────

describe('AC-9: Rules Engine explanation on denial', () => {
  test('Denial includes explanation with applied rules and reasoning', async () => {
    const { workflow } = makeEngines(makeDenyEngine('DataIntegrityFlagged: DOB mismatch requires human review.'));
    const result = await workflow.start({ tenantId: TENANT, templateId: 'template.intake', forObjectId: PATIENT_ID, forObjectType: 'Patient', ownerId: CARE_GUIDE, actor: CARE_GUIDE });

    expect(result.started).toBe(false);
    if (result.started) return;

    expect(result.explanation.appliedRules.length).toBeGreaterThan(0);
    expect(result.explanation.appliedRules[0].outcome).toBe('DENY');
    expect(result.explanation.appliedRules[0].reason).toContain('DataIntegrityFlagged');
    expect(result.explanation.reasoning.join(' ')).toBeTruthy();
  });

  test('Unknown template returns denial with explanation', async () => {
    const { workflow } = makeEngines();
    const result = await workflow.start({ tenantId: TENANT, templateId: 'template.does-not-exist', forObjectId: PATIENT_ID, forObjectType: 'Patient', ownerId: CARE_GUIDE, actor: CARE_GUIDE });

    expect(result.started).toBe(false);
    if (result.started) return;
    expect(result.explanation.reasoning.some(r => r.includes('template'))).toBe(true);
  });
});

// ─── Full end-to-end scenario: Referral → Task → Promise kept ────────────────

describe('Full E2E: Referral received → intake workflow → task → promise kept', () => {
  test('Complete happy-path intake flow', async () => {
    const { workflow, task, promise, eventStore } = makeEngines();

    // 1. Start intake workflow (authorized)
    const wfResult = await workflow.start({ tenantId: TENANT, templateId: 'template.intake', forObjectId: PATIENT_ID, forObjectType: 'Patient', ownerId: CARE_GUIDE, actor: CARE_GUIDE });
    expect(wfResult.started).toBe(true);
    if (!wfResult.started) return;
    const wf = wfResult.workflow;

    // 2. Create task for step 1
    const t = await task.create({ tenantId: TENANT, taskType: 'AcknowledgeReferral', title: 'Acknowledge Referral', description: 'Contact referral source within 4h', workflowId: wf.id, workflowStepId: 'step.intake.acknowledge', ownerId: CARE_GUIDE, dueAt: new Date(Date.now() + 4 * 3600_000), actor: CARE_GUIDE });

    // 3. Create promise
    const p = await promise.create({ tenantId: TENANT, description: 'Alara will respond to the referral source within 4 hours.', subjectId: PATIENT_ID, recipientId: 'referral-source-001', ownerId: CARE_GUIDE, dueAt: new Date(Date.now() + 4 * 3600_000), workflowId: wf.id, workflowStepId: 'step.intake.acknowledge', actor: CARE_GUIDE });

    // 4. Complete task
    const completedTask = await task.complete({ tenantId: TENANT, taskId: t.id, actor: CARE_GUIDE, expectedVersion: 1 });
    expect(completedTask.status).toBe('completed');

    // 5. Advance workflow
    await workflow.advance({ tenantId: TENANT, workflowId: wf.id, completedStepId: 'step.intake.acknowledge', actor: CARE_GUIDE, expectedVersion: wf.version });

    // 6. Keep promise
    const keptPromise = await promise.keep({ tenantId: TENANT, promiseId: p.id, actor: CARE_GUIDE, expectedVersion: 1 });
    expect(keptPromise.status).toBe('kept');

    // 7. Verify event streams
    const wfEvents = await eventStore.loadStream(TENANT, wf.id);
    expect(wfEvents.map(e => e.type)).toEqual(['WorkflowStarted', 'WorkflowStepActivated', 'WorkflowAdvanced', 'WorkflowStepActivated']);

    const taskEvents = await eventStore.loadStream(TENANT, t.id);
    expect(taskEvents.map(e => e.type)).toEqual(['TaskCreated', 'TaskCompleted']);

    const promiseEvents = await eventStore.loadStream(TENANT, p.id);
    expect(promiseEvents.map(e => e.type)).toEqual(['PromiseCreated', 'PromiseKept']);

    // 8. Reconstruct all three from events
    const rWf = await reconstructWorkflowFromEvents(eventStore, TENANT, wf.id);
    const rTask = await reconstructTaskFromEvents(eventStore, TENANT, t.id);
    const rPromise = await reconstructPromiseFromEvents(eventStore, TENANT, p.id);

    expect(rWf!.status).toBe('active'); // still going (more steps remain)
    expect(rTask!.status).toBe('completed');
    expect(rPromise!.status).toBe('kept');
  });

  test('Denial scenario: DataIntegrity blocks workflow — no side effects', async () => {
    const { workflow, store } = makeEngines(makeDenyEngine('DataIntegrityFlagged — DOB mismatch — human review required.'));

    const result = await workflow.start({ tenantId: TENANT, templateId: 'template.intake', forObjectId: PATIENT_ID, forObjectType: 'Patient', ownerId: CARE_GUIDE, actor: CARE_GUIDE });

    expect(result.started).toBe(false);
    expect(store.workflows.size).toBe(0);
    expect(store.tasks.size).toBe(0);
    expect(store.promises.size).toBe(0);
    expect(store.events.filter(e => ['WorkflowStarted','TaskCreated','PromiseCreated'].includes(e.type))).toHaveLength(0);
  });
});
