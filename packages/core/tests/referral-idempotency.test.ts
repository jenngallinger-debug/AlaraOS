/**
 * Alara OS — Referral command idempotency (orchestrator-level)
 *
 * Proves IntakeOrchestrator.handleReferralReceived is idempotent by external referral id
 * (a per-referral receipt stream keyed by tenant + automynd + referralId):
 *   - first referral creates the full intake
 *   - a duplicate referral returns the original result and creates no extra artifacts
 *   - a reused referral id with a different payload is a conflict (no duplicate)
 *   - the same referral id in a different tenant is independent
 *   - a missing referral id is rejected before any work
 * Idempotency lives in the orchestrator so it protects the canonical operation for any
 * caller (API, webhook, tests, future job runners).
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
import { registerAllProjections } from '../src/projection-engine';
import { RulesEngine, NoopAuditSink } from '../src/rules-engine/engine';
import { RulesRegistry } from '../src/rules-engine/registry';
import { BUILT_IN_RULE_SETS, DefaultAllowPolicyModule } from '../src/rules-engine/built-in-policies';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore } from './helpers/in-memory-store';

const TENANT = 'alara-home-care';

function buildPipeline() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);

  const rulesRegistry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) rulesRegistry.registerRuleSet(rs);
  rulesRegistry.registerPolicyModule(DefaultAllowPolicyModule); // explicit allow (engine fails closed)
  const rules = new RulesEngine(rulesRegistry, new NoopAuditSink());

  const templates = new WorkflowTemplateRegistry();
  for (const t of BUILT_IN_WORKFLOW_TEMPLATES) templates.register(t);
  const workflowEngine = new WorkflowEngine(db, eventStore, templates, rules);

  const taskEngine = new TaskEngine(db, eventStore);
  const promiseEngine = new PromiseEngine(db, eventStore);
  const commEngine = new CommunicationEngine(db, eventStore);
  commEngine.registerAdapter(new StubDeliveryAdapter());

  const projRegistry = new ProjectionRegistry();
  registerAllProjections(projRegistry);
  const projEngine = new ProjectionEngine(projRegistry, new InMemoryProjectionStore(), eventStore);

  const orchestrator = new IntakeOrchestrator(
    db, eventStore, rules, workflowEngine, taskEngine, promiseEngine, commEngine, projEngine,
  );
  return { orchestrator, store };
}

const referral = (over: Partial<Parameters<IntakeOrchestrator['handleReferralReceived']>[0]> = {}) => ({
  tenantId: TENANT,
  automyndReferralId: 'REF-001',
  automyndPatientId: 'AM-883201',
  patientName: 'Samuel Brown',
  programType: 'EEOICPA',
  referralSource: 'Dr. Jones Clinic',
  referralDate: '2026-06-25',
  actor: 'care-guide-001',
  ...over,
});

const patientCount = (store: InMemoryStore) =>
  Array.from(store.objects.values()).filter(o => o.type === 'Patient').length;

describe('Referral command idempotency (Phase 3)', () => {
  test('1. first referral creates the full intake', async () => {
    const { orchestrator, store } = buildPipeline();
    const r = await orchestrator.handleReferralReceived(referral());
    expect(r.success).toBe(true);
    expect(r.idempotentReplay).toBeUndefined();
    expect(patientCount(store)).toBe(1);
    expect(store.workflows.size).toBe(1);
    expect(store.tasks.size).toBe(1);
    expect(store.promises.size).toBe(1);
    expect(store.communications.size).toBe(1);
  });

  test('2 + 3. duplicate referral returns the same result and creates no extra artifacts', async () => {
    const { orchestrator, store } = buildPipeline();
    const first = await orchestrator.handleReferralReceived(referral());
    const second = await orchestrator.handleReferralReceived(referral());

    expect(second.success).toBe(true);
    expect(second.idempotentReplay).toBe(true);
    expect(second.patientId).toBe(first.patientId);
    expect(second.workflowId).toBe(first.workflowId);
    expect(second.taskId).toBe(first.taskId);
    expect(second.promiseId).toBe(first.promiseId);
    expect(second.communicationId).toBe(first.communicationId);

    expect(patientCount(store)).toBe(1);
    expect(store.workflows.size).toBe(1);
    expect(store.tasks.size).toBe(1);
    expect(store.promises.size).toBe(1);
    expect(store.communications.size).toBe(1);
  });

  test('4. same referral id + different payload → conflict, no duplicate', async () => {
    const { orchestrator, store } = buildPipeline();
    const first = await orchestrator.handleReferralReceived(referral());
    const conflict = await orchestrator.handleReferralReceived(referral({ patientName: 'Different Name' }));

    expect(first.success).toBe(true);
    expect(conflict.success).toBe(false);
    expect(conflict.conflict).toBe(true);
    expect(conflict.denialReason).toMatch(/idempotency conflict/i);
    // No second intake created.
    expect(patientCount(store)).toBe(1);
    expect(store.workflows.size).toBe(1);
    expect(store.tasks.size).toBe(1);
    expect(store.promises.size).toBe(1);
    expect(store.communications.size).toBe(1);
  });

  test('5. same referral id in a different tenant is independent', async () => {
    const { orchestrator, store } = buildPipeline();
    const a = await orchestrator.handleReferralReceived(referral({ tenantId: 'tenant-A' }));
    const b = await orchestrator.handleReferralReceived(referral({ tenantId: 'tenant-B' }));

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(b.patientId).not.toBe(a.patientId);
    expect(patientCount(store)).toBe(2);
    expect(store.workflows.size).toBe(2);
  });

  test('6. missing referral id is rejected before any work', async () => {
    const { orchestrator, store } = buildPipeline();
    const r = await orchestrator.handleReferralReceived(referral({ automyndReferralId: '' }));
    expect(r.success).toBe(false);
    expect(r.denialReason).toMatch(/automyndReferralId/);
    expect(patientCount(store)).toBe(0);
    expect(store.workflows.size).toBe(0);
  });
});
