/**
 * Alara OS — M11 Retrieval & Query Engine — Types (query contract)
 *
 * Planning anchor: docs/M11-retrieval-spec.md. Built on v0.4 canon.
 *
 * Retrieval is a VIEW under ADR-016: it SELECTS and JOINS across the existing
 * canonical stores (Object Graph, Event Log, Relationship Edges, Computed
 * Projections). It NEVER computes new authoritative truth and NEVER creates a
 * ProjectionType. It is READ-ONLY and emits no domain events.
 *
 * Non-binding vision context (pending constitutional ratification): retrieval is
 * one mechanism of Boundary-Transparency / Law I — Perception. This mapping is
 * explanatory only; the engine is justified entirely by ADR-001/003/016.
 */

import { AlaraId } from '../shared/types';

// ─── Sources ──────────────────────────────────────────────────────────────────

/**
 * The four canonical stores retrieval may read. Each maps to an existing
 * repository/store. Retrieval owns none of them; it only selects from them.
 */
export type QuerySource = 'object' | 'event' | 'edge' | 'projection';

// ─── Filters ──────────────────────────────────────────────────────────────────

/**
 * A deterministic, value-based filter. Retrieval filters and joins existing
 * values; it never computes a new derived value. Operators are intentionally
 * minimal (equality / presence) — no scoring, no aggregation that would produce
 * new authoritative meaning.
 */
export type FilterOperator = 'eq' | 'neq' | 'exists' | 'in';

export interface QueryFilter {
  /** Dotted path into the source record (e.g. 'type', 'attributes.dob', 'state'). */
  readonly field: string;
  readonly operator: FilterOperator;
  /** Comparison value. Omitted for 'exists'. For 'in', an array. */
  readonly value?: unknown;
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * A single-source selection. A cross-boundary query is a list of these whose
 * results are returned together (and may be correlated by the caller via the
 * shared subject/id values present in provenance).
 */
export interface SourceQuery {
  readonly source: QuerySource;
  /**
   * For 'object': restrict to these object types (optional).
   * For 'event': restrict to a stream (subjectId) — events are stream-ordered.
   * For 'edge': the subjectId whose relationships/edges to read.
   * For 'projection': the ProjectionType name + subjectId to read.
   */
  readonly objectTypes?: readonly string[];
  readonly streamId?: AlaraId;
  readonly subjectId?: AlaraId;
  readonly projectionType?: string;
  readonly filters?: readonly QueryFilter[];
}

/**
 * The retrieval request. `actor` is mandatory — every result is scoped to what
 * this actor may see (permission/consent enforced INSIDE the query boundary).
 */
export interface RetrievalQuery {
  readonly tenantId: string;
  readonly actor: string;
  /** One or more single-source selections composed into one cross-boundary read. */
  readonly sources: readonly SourceQuery[];
  /** Rule set the permission gate evaluates against (defaults to a read gate). */
  readonly ruleSetId?: string;
}

// ─── Results + provenance ───────────────────────────────────────────────────────

/**
 * Provenance: which canonical store + record produced this result. Every result
 * carries it (success criterion #6). Provenance is descriptive, not new truth.
 */
export interface Provenance {
  readonly source: QuerySource;
  /** The id of the contributing record (object id, event id, edge id, projection id). */
  readonly recordId: string;
  /** For events: the stream + seq that orders it. For projections: the type. */
  readonly streamId?: AlaraId;
  readonly seq?: number;
  readonly projectionType?: string;
}

/** A single returned item: the selected value plus where it came from. */
export interface RetrievalResult<T = Record<string, unknown>> {
  readonly source: QuerySource;
  readonly value: T;
  readonly provenance: Provenance;
}

/**
 * The full result set for a query. `admitted` are the results the actor may see;
 * `deniedCount` records how many candidate records were filtered out by the
 * permission gate (for leak-testing and observability — NOT the denied content).
 */
export interface RetrievalResultSet {
  readonly results: readonly RetrievalResult[];
  /** Count of candidate records suppressed by the permission gate. */
  readonly deniedCount: number;
  /** Echo of the actor the results were scoped to. */
  readonly actor: string;
}

// ─── Errors ─────────────────────────────────────────────────────────────────────

/** Raised if a query asks for a source/shape the engine cannot serve read-only. */
export class RetrievalQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalQueryError';
  }
}
