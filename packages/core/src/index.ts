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

// M6 — Relationship Engine
export { RelationshipRepository } from './relationship-engine/repository';
export { RelationshipEngine, reconstructRelationshipFromEvents } from './relationship-engine/engine';
export type { ReconstructedRelationship } from './relationship-engine/engine';
export type {
  Relationship, RelationshipType, RelationshipStatus,
  ParticipationEdge,
  ParticipationRole as RelationshipParticipationRole,
  CareTeamMember, CareTeamView,
  CreateRelationshipCommand, AddParticipantCommand, RemoveParticipantCommand,
  TransferOwnershipCommand, TerminateRelationshipCommand,
  SuspendRelationshipCommand, ReactivateRelationshipCommand,
} from './relationship-engine/types';
export {
  StaleRelationshipError, InvalidParticipationRoleError,
  CoverageExpiredError, RelationshipNotActiveError,
} from './relationship-engine/types';
export { RelationshipHealthProjectionV2Definition } from './projection-engine/projections/relationship-health-v2';
export type { RelationshipHealthInputV2 } from './projection-engine/projections/relationship-health-v2';

// M7 — Knowledge Engine
export { KnowledgeRepository } from './knowledge-engine/repository';
export { KnowledgeEngine, reconstructKnowledgeEntryFromEvents, reconstructObservationFromEvents } from './knowledge-engine/engine';
export type { ReconstructedKnowledgeEntry } from './knowledge-engine/engine';
export type {
  Observation, ObservationTopic, ObservationSource, ObservationConfidence,
  KnowledgeEntry, KnowledgeEntryKind, KnowledgeEntryStatus,
  KnowledgeQuery, KnowledgeQueryResult,
  RecordObservationCommand, AssertKnowledgeCommand,
  SupersedeKnowledgeCommand, RetractKnowledgeCommand,
  CONFIDENCE_RANK,
} from './knowledge-engine/types';
export {
  StaleKnowledgeEntryError, KnowledgeEntryNotFoundError,
  ObservationNotFoundError, ClinicalContentViolationError,
} from './knowledge-engine/types';
export { KnowledgeSummaryProjectionDefinition } from './projection-engine/projections/knowledge-summary';
export type { KnowledgeSummaryInput, KnowledgeSummaryValue } from './projection-engine/projections/knowledge-summary';

// M8 — Organizational Brain
export { OrganizationalBrainRepository } from './organizational-brain/repository';
export { OrganizationalBrainEngine, reconstructPatternFromEvents } from './organizational-brain/engine';
export type { BrainAnalysisResult, ReconstructedPattern } from './organizational-brain/engine';
export { PatternDetectorRegistry } from './organizational-brain/pattern-detectors/registry';
export { ALL_PATTERN_DETECTORS } from './organizational-brain/pattern-detectors/index';
export type {
  DetectedPattern, PatternCategory, PatternStatus, PatternSeverity,
  PatternConfidence, PatternEvidence, PatternDetector, DetectorInput, DetectorResult,
  RunBrainAnalysisCommand, ResolvePatternCommand, DismissPatternCommand,
  OrganizationalHealthValue,
} from './organizational-brain/types';
export { StalePatternError, PatternNotFoundError } from './organizational-brain/types';
export { OrganizationalHealthProjectionDefinition } from './projection-engine/projections/organizational-health';
export type { OrganizationalHealthInput } from './projection-engine/projections/organizational-health';

// M9 — Reasoning Engine
export { ReasoningEngine, ReasoningRepository } from './reasoning-engine/engine';
export type { ReasoningResult } from './reasoning-engine/engine';
export { StubReasoningProvider, OpenAIProvider, AnthropicProvider } from './reasoning-engine/providers';
export type { ReasoningProvider } from './reasoning-engine/providers';
export { assembleContext, buildEvidenceChain } from './reasoning-engine/prompt-assembler';
export type { AssemblerInput } from './reasoning-engine/prompt-assembler';
export type {
  Hypothesis, HypothesisStatus, Recommendation, RecommendationStatus,
  RecommendationPriority, RecommendationActionType, MissingInformation,
  Narrative, NarrativeType, NarrativeSection, EvidenceChain,
  ConfidenceAssessment, ReasoningConfidence, ReasoningContext,
  GenerateHypothesesCommand, GenerateRecommendationsCommand,
  GenerateNarrativeCommand, IdentifyMissingInformationCommand,
} from './reasoning-engine/types';
export { InsufficientEvidenceError, ReasoningProviderError } from './reasoning-engine/types';
export { ReasoningSummaryProjectionDefinition } from './projection-engine/projections/reasoning-summary';
export type { ReasoningSummaryInput, ReasoningSummaryValue } from './projection-engine/projections/reasoning-summary';

// M9 — Read Authorization Boundary (Permission Gate for Reality Understanding reads)
export { assembleAuthorizedContext } from './reasoning-engine/authorized-context';
export type { AuthorizedContextOptions, AuthorizedContextResult } from './reasoning-engine/authorized-context';
export {
  ConsentReadPolicy, ParticipationReadPolicy, AIActReadPolicy,
  READ_AUTHORIZATION_POLICIES, registerReadAuthorizationPolicies, AUTHZ_REQUIRES_KEY,
} from './reasoning-engine/read-authorization-policies';
export type { AuthorizationRequirements } from './reasoning-engine/read-authorization-policies';
export { GraphFactResolver } from './reasoning-engine/fact-resolver';
export type {
  FactResolver, FactResolveInput, AuthorizationFacts, ConsentFactSource, RelationshipReadPort,
} from './reasoning-engine/fact-resolver';

// Consent Store — canonical query path backing ConsentFactSource (BD-014)
export { ConsentRepository } from './consent-store/repository';
export { GraphConsentFactSource } from './consent-store/consent-fact-source';

// M10 — Workforce Engine
export { WorkforceRepository } from './workforce-engine/repository';
export { WorkforceEngine, reconstructAssignmentFromEvents } from './workforce-engine/engine';
export type { RegisterMemberResult, RecommendAssignmentResult, AssignmentActionResult, ReconstructedAssignment } from './workforce-engine/engine';
export { scoreMember, rankCandidates } from './workforce-engine/recommender';
export type { ScoringInput } from './workforce-engine/recommender';
export type {
  WorkforceMember, WorkforceMemberStatus, WorkforceRole,
  Team, SkillProfile, SkillEntry, SkillLevel, CoverageArea,
  Availability, AvailabilityStatus, CapacitySnapshot,
  EscalationPath, EscalationLevel, EscalationTrigger,
  Assignment, AssignmentStatus, AssignmentPriority, AssignmentConfidence,
  AssignmentEvidence, AssignmentRecommendation, CandidateScore,
  RegisterWorkforceMemberCommand, UpdateAvailabilityCommand,
  RecommendAssignmentCommand, AcceptAssignmentCommand,
  DeclineAssignmentCommand, TransferAssignmentCommand,
  CompleteAssignmentCommand, TriggerEscalationCommand,
} from './workforce-engine/types';
export {
  WorkforceMemberNotFoundError, AssignmentNotFoundError,
  StaleAssignmentError, NoEligibleAssigneeError,
} from './workforce-engine/types';
export { WorkforceHealthProjectionDefinition } from './projection-engine/projections/workforce-health';
export type { WorkforceHealthInput, WorkforceHealthValue, MemberLoadSummary } from './projection-engine/projections/workforce-health';

// M11 — Retrieval & Query Engine (read-only View under ADR-016; adds no ProjectionType)
export * from './retrieval-engine';
