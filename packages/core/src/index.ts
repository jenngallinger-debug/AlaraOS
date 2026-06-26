/**
 * @alara-os/core — Public API
 * M0 Spine + M1a Trigger Engine + Rules Engine + Automynd Adapter
 */

// Shared types
export * from './shared/types';
export * from './shared/ids';
export { DatabaseClient } from './shared/database';

// Events
export * from './events/types';
export { EventStore } from './events/store';

// Object Graph
export { ObjectGraphRepository } from './object-graph/repository';
export type { CreateObjectCommand, UpdateObjectCommand } from './object-graph/repository';
export { ObjectNotFoundError, StaleVersionError, InvalidObjectTypeError } from './object-graph/repository';
export { ObjectCommandHandler, reconstructFromEvents } from './object-graph/command-handler';
export type { CreateObjectResult, UpdateObjectResult, ReconstructedState } from './object-graph/command-handler';

// Trigger Engine
export * from './trigger-engine';

// Rules Engine
export * from './rules-engine';

// Automynd Adapter
export * from './automynd-adapter';

// M2 — Workflow, Task, Promise Engines
export * from './workflow-engine';
export * from './task-engine';
export * from './promise-engine';

// M3 — Projection Engine
export * from './projection-engine';

// M4 — Communication Engine + Intake Orchestrator
export * from './communication-engine';
export { IntakeOrchestrator } from './intake-orchestrator';
export type { ReferralReceivedInput, IntakeOrchestratorResult } from './intake-orchestrator';
