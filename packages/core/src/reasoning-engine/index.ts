export * from './types';
export { StubReasoningProvider, OpenAIProvider, AnthropicProvider } from './providers';
export type { ReasoningProvider, ProviderHypothesisResult, ProviderRecommendationResult, ProviderNarrativeResult, ProviderMissingInformationResult } from './providers';
export { ReasoningEngine, ReasoningRepository } from './engine';
export type { ReasoningResult } from './engine';
export { assembleContext, buildEvidenceChain } from './prompt-assembler';
export type { AssemblerInput } from './prompt-assembler';

// Read Authorization Boundary (completes the Permission Gate for Reality Understanding)
export { assembleAuthorizedContext } from './authorized-context';
export type { AuthorizedContextOptions, AuthorizedContextResult } from './authorized-context';
export {
  ConsentReadPolicy,
  ParticipationReadPolicy,
  AIActReadPolicy,
  READ_AUTHORIZATION_POLICIES,
  registerReadAuthorizationPolicies,
  AUTHZ_REQUIRES_KEY,
} from './read-authorization-policies';
export type { AuthorizationRequirements } from './read-authorization-policies';

// Fact Resolution for read authorization
export { GraphFactResolver } from './fact-resolver';
export type {
  FactResolver,
  FactResolveInput,
  AuthorizationFacts,
  ConsentFactSource,
  RelationshipReadPort,
} from './fact-resolver';
