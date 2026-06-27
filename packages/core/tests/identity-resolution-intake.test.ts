/**
 * Alara OS — Identity Resolution Phase 6: resolve-or-create during intake
 *
 * Proves IntakeOrchestrator resolves identity before creating a Patient
 * (docs/architecture/identity-resolution-spec.md §12 phase 7), using Phases 1–2 only:
 *   - referral with an existing external reference REUSES the existing Patient
 *   - referral without a match CREATES a Patient
 *   - duplicate external reference does NOT create a duplicate Patient
 *   - an ambiguous (id-collision) case does NOT auto-merge and does NOT create a Patient
 *   - no destructive behavior (a reused Patient is not overwritten)
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
import { ObjectCommandHandler } from '../src/object-graph/command-handler';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore } from './helpers/in-memory-store';

const TENANT = 'alara-home-care';

function buildPipeline() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);

  const rulesRegistry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) rulesRegistry.registerRuleSet(rs);
  // Engine fails closed for rule sets with no registered policy; intake intentionally
  // allows, so register the explicit DefaultAllow baseline.
  rulesRegistry.registerPolicyModule(DefaultAllowPolicyModule);
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

  // A direct handler to seed/inspect Patients independent of the orchestrator.
  const objectHandler = new ObjectCommandHandler(db, new ObjectGraphRepository(db), eventStore);
  return { orchestrator, store, objectHandler };
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

describe('Identity Resolution — resolve-or-create during intake (Phase 6)', () => {
  test('referral without a match CREATES a Patient', async () => {
    const { orchestrator, store } = buildPipeline();
    const result = await orchestrator.handleReferralReceived(referral());
    expect(result.success).toBe(true);
    expect(result.patientId).toBeDefined();
    expect(patientCount(store)).toBe(1);
  });

  test('referral with an existing external reference REUSES the existing Patient', async () => {
    const { orchestrator, store, objectHandler } = buildPipeline();
    // Seed an existing Patient carrying the Automynd reference.
    const { object: existing } = await objectHandler.createObject({
      tenantId: TENANT, type: 'Patient', actor: 'system', attributes: { name: 'Samuel Brown' },
    });
    await objectHandler.addExternalReference(
      TENANT, existing.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }, 'system',
    );
    expect(patientCount(store)).toBe(1);

    const result = await orchestrator.handleReferralReceived(referral());
    expect(result.success).toBe(true);
    expect(result.patientId).toBe(existing.id); // reused, not a new id
    expect(patientCount(store)).toBe(1);        // no duplicate created
  });

  test('duplicate external reference does NOT create a duplicate Patient', async () => {
    const { orchestrator, store } = buildPipeline();
    const first = await orchestrator.handleReferralReceived(referral({ automyndReferralId: 'REF-001' }));
    const second = await orchestrator.handleReferralReceived(referral({ automyndReferralId: 'REF-002' }));
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.patientId).toBe(first.patientId); // same Patient reused
    expect(patientCount(store)).toBe(1);            // still exactly one Patient
  });

  test('ambiguous (id-collision) case does NOT auto-merge and does NOT create a Patient', async () => {
    const { orchestrator, store, objectHandler } = buildPipeline();
    // Two existing Patients share the same Automynd reference → ambiguous identity.
    for (const name of ['Patient A', 'Patient B']) {
      const { object } = await objectHandler.createObject({
        tenantId: TENANT, type: 'Patient', actor: 'system', attributes: { name },
      });
      await objectHandler.addExternalReference(
        TENANT, object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }, 'system',
      );
    }
    expect(patientCount(store)).toBe(2);

    const result = await orchestrator.handleReferralReceived(referral());
    expect(result.success).toBe(false);                       // stopped for review
    expect(result.denialReason).toMatch(/Identity review required/i);
    expect(result.patientId).toBeUndefined();                 // nothing created
    expect(patientCount(store)).toBe(2);                       // no third Patient, no merge
  });

  test('reused Patient is not overwritten (no destructive update)', async () => {
    const { orchestrator, store, objectHandler } = buildPipeline();
    const { object: existing } = await objectHandler.createObject({
      tenantId: TENANT, type: 'Patient', actor: 'system',
      attributes: { name: 'Original Name', programType: 'VA' },
    });
    await objectHandler.addExternalReference(
      TENANT, existing.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }, 'system',
    );

    await orchestrator.handleReferralReceived(referral({ patientName: 'Different Name', programType: 'EEOICPA' }));
    const after = store.objects.get(String(existing.id))!;
    expect(after.attributes.name).toBe('Original Name'); // not overwritten by the referral
    expect(after.attributes.programType).toBe('VA');
  });
});
