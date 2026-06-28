/**
 * Alara OS API — Engine Container
 *
 * Composes all @alara-os/core engines into a single container
 * that the API routes use. Nothing in the API writes directly
 * to any store — all writes go through engines and orchestrators.
 *
 * In production this connects to a real PostgreSQL 16 instance.
 * In tests it uses the InMemoryStore double.
 */

import { DatabaseClient } from '@alara-os/core';
import { EventStore } from '@alara-os/core';
import { ObjectGraphRepository } from '@alara-os/core';
import { ObjectCommandHandler } from '@alara-os/core';
import { RulesEngine, NoopAuditSink } from '@alara-os/core';
import { RulesRegistry } from '@alara-os/core';
import { BUILT_IN_RULE_SETS, BUILT_IN_POLICY_MODULES } from '@alara-os/core';
import { TriggerEngine } from '@alara-os/core';
import { TriggerRegistry, BUILT_IN_TRIGGERS } from '@alara-os/core';
import { WorkflowEngine } from '@alara-os/core';
import { WorkflowTemplateRegistry, BUILT_IN_WORKFLOW_TEMPLATES } from '@alara-os/core';
import { TaskEngine } from '@alara-os/core';
import { PromiseEngine } from '@alara-os/core';
import { CommunicationEngine } from '@alara-os/core';
import { StubDeliveryAdapter } from '@alara-os/core';
import { ProjectionEngine } from '@alara-os/core';
import { ProjectionRegistry } from '@alara-os/core';
import { InMemoryProjectionStore } from '@alara-os/core';
import { registerAllProjections } from '@alara-os/core';
import { IntakeOrchestrator } from '@alara-os/core';
import { ConsentEngine, ConsentCaptureService, ConsentAuthorizer } from '@alara-os/core';
import { ConsentAuthorityPolicyModule, ConsentRepository, RelationshipRepository } from '@alara-os/core';

export interface EngineContainer {
  db: DatabaseClient;
  eventStore: EventStore;
  objectRepo: ObjectGraphRepository;
  objectHandler: ObjectCommandHandler;
  rules: RulesEngine;
  triggers: TriggerEngine;
  workflowEngine: WorkflowEngine;
  taskEngine: TaskEngine;
  promiseEngine: PromiseEngine;
  commEngine: CommunicationEngine;
  projectionEngine: ProjectionEngine;
  projectionStore: InMemoryProjectionStore;
  orchestrator: IntakeOrchestrator;
  consentCapture: ConsentCaptureService;
}

export function buildContainer(db: DatabaseClient): EngineContainer {
  const eventStore = new EventStore(db);

  // Object Graph
  const objectRepo = new ObjectGraphRepository(db);
  const objectHandler = new ObjectCommandHandler(db, objectRepo, eventStore);

  // Rules Engine (M1b policies loaded)
  const rulesRegistry = new RulesRegistry();
  for (const rs of BUILT_IN_RULE_SETS) rulesRegistry.registerRuleSet(rs);
  for (const m of BUILT_IN_POLICY_MODULES) rulesRegistry.registerPolicyModule(m);
  const rules = new RulesEngine(rulesRegistry, new NoopAuditSink());

  // Trigger Engine
  const triggerRegistry = new TriggerRegistry();
  for (const t of BUILT_IN_TRIGGERS) triggerRegistry.register(t);
  const triggers = new TriggerEngine(triggerRegistry);

  // Workflow Engine
  const templates = new WorkflowTemplateRegistry();
  for (const t of BUILT_IN_WORKFLOW_TEMPLATES) templates.register(t);
  const workflowEngine = new WorkflowEngine(db, eventStore, templates, rules);

  // Task + Promise
  const taskEngine = new TaskEngine(db, eventStore);
  const promiseEngine = new PromiseEngine(db, eventStore);

  // Communication Engine
  const commEngine = new CommunicationEngine(db, eventStore);
  commEngine.registerAdapter(new StubDeliveryAdapter());

  // Projection Engine
  const projRegistry = new ProjectionRegistry();
  registerAllProjections(projRegistry);
  const projectionStore = new InMemoryProjectionStore();
  const projectionEngine = new ProjectionEngine(projRegistry, projectionStore, eventStore);

  // Intake Orchestrator
  const orchestrator = new IntakeOrchestrator(
    db, eventStore, rules, workflowEngine, taskEngine, promiseEngine, commEngine, projectionEngine,
  );

  // Consent capture (intake/portal boundary → canonical ConsentEngine) with caller
  // authorization (who may grant/withdraw) decided by the RulesEngine + policy.
  const consentAuthRegistry = new RulesRegistry();
  consentAuthRegistry.registerPolicyModule(ConsentAuthorityPolicyModule);
  const consentAuthRules = new RulesEngine(consentAuthRegistry, new NoopAuditSink());
  const consentAuthorizer = new ConsentAuthorizer(consentAuthRules, {
    relationships: new RelationshipRepository(db),
    consents: new ConsentRepository(db),
  });
  // eventStore enables capture idempotency (duplicate submit → safe replay, not a 2nd Consent).
  const consentCapture = new ConsentCaptureService(new ConsentEngine(db), consentAuthorizer, eventStore);

  return {
    db, eventStore, objectRepo, objectHandler, rules, triggers,
    workflowEngine, taskEngine, promiseEngine, commEngine,
    projectionEngine, projectionStore, orchestrator, consentCapture,
  };
}
