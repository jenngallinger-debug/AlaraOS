/**
 * Alara OS — M11 Retrieval & Query Engine — Public surface
 *
 * Read-only query substrate (View under ADR-016). Adds no ProjectionType.
 */

export { RetrievalEngine } from './engine';
export type { RetrievalSources } from './engine';
export {
  RetrievalPermissionGate,
  RETRIEVAL_READ_RULESET,
  RETRIEVAL_READ_EVENT,
} from './permission-gate';
export type { GateInput } from './permission-gate';
export type {
  QuerySource,
  FilterOperator,
  QueryFilter,
  SourceQuery,
  RetrievalQuery,
  Provenance,
  RetrievalResult,
  RetrievalResultSet,
} from './types';
export { RetrievalQueryError } from './types';
