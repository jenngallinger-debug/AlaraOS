export { ConsentRepository } from './repository';
export { GraphConsentFactSource } from './consent-fact-source';
export { ConsentEngine, ConsentNotFoundError } from './engine';
export type {
  GrantConsentCommand,
  ConsentChangeCommand,
  ConsentMutationResult,
} from './engine';
export { ConsentCaptureService, ConsentCaptureValidationError, ConsentIdempotencyConflictError } from './capture';
export type {
  CaptureConsentInput,
  CaptureConsentResult,
  WithdrawConsentInput,
  WithdrawConsentResult,
} from './capture';
export { ConsentAuthorizer, ConsentAuthorizationError } from './authorizer';
export type { ConsentAuthorizerDeps } from './authorizer';
