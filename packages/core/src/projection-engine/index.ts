export * from './types';
export { ProjectionRegistry } from './registry';
export { InMemoryProjectionStore, DatabaseProjectionStore } from './store';
export { ProjectionEngine } from './engine';
export type { ProjectionInputAssembler, BuildResult, ProjectionBuildSuccess, ProjectionBuildFailure } from './engine';
export { ProjectionRebuilder } from './rebuilder';

// Projection implementations
export { TimelineProjectionDefinition } from './projections/timeline';
export type { TimelineInput } from './projections/timeline';
export { DigitalCareTwinProjectionDefinition } from './projections/digital-care-twin';
export type { DigitalCareTwinInput } from './projections/digital-care-twin';
export {
  ReferralSourceStrengthProjectionDefinition,
  RelationshipHealthProjectionDefinition,
} from './projections/referral-and-relationship';
export type {
  ReferralSourceStrengthInput,
  RelationshipHealthInput,
} from './projections/referral-and-relationship';

// Registration helper
import { ProjectionRegistry } from './registry';
import { TimelineProjectionDefinition } from './projections/timeline';
import { DigitalCareTwinProjectionDefinition } from './projections/digital-care-twin';
import { ReferralSourceStrengthProjectionDefinition, RelationshipHealthProjectionDefinition } from './projections/referral-and-relationship';

export function registerAllProjections(registry: ProjectionRegistry): void {
  registry.register(TimelineProjectionDefinition);
  registry.register(DigitalCareTwinProjectionDefinition);
  registry.register(ReferralSourceStrengthProjectionDefinition);
  registry.register(RelationshipHealthProjectionDefinition);
}
