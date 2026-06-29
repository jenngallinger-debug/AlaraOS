/**
 * Alara OS — Knowledge Repository
 *
 * Read layer for the Knowledge Engine.
 * All writes go through the KnowledgeEngine (event-sourced).
 */

import { DatabaseClient } from '../shared/database';
import type { PoolClient } from '../shared/database';
import { withTenantTransaction } from '../shared/tenant-scope';
import { AlaraId } from '../shared/types';
import {
  CONFIDENCE_RANK,
  KnowledgeEntry,
  KnowledgeEntryKind,
  KnowledgeEntryStatus,
  KnowledgeQuery,
  KnowledgeQueryResult,
  Observation,
  ObservationConfidence,
  ObservationSource,
  ObservationTopic,
} from './types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface ObservationRow {
  id: string;
  tenant_id: string;
  subject_id: string;
  subject_type: string;
  topic: string;
  statement: string;
  facts: unknown;
  source: string;
  confidence: string;
  ai_involved: boolean;
  source_event_ids: string[];
  source_observation_ids: string[];
  observed_at: string;
  actor: string;
  version: number;
}

interface KnowledgeEntryRow {
  id: string;
  tenant_id: string;
  subject_id: string;
  subject_type: string;
  topic: string;
  kind: string;
  status: string;
  statement: string;
  content: unknown;
  confidence: string;
  ai_involved: boolean;
  supporting_observation_ids: string[];
  superseded_by_id: string | null;
  asserted_at: string;
  asserted_by: string;
  expires_at: string | null;
  version: number;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class KnowledgeRepository {
  constructor(private readonly db: DatabaseClient) {}

  // ── Observations ──────────────────────────────────────────────────────────

  // RLS step 2 (Batch A): single-statement, tenant-filtered reads run inside a tenant-scoped
  // transaction (carries `app.tenant_id`). Behavior-preserving today (RLS inert → same rows);
  // identical SQL/params/ordering/mapping. The `query` aggregate now runs its two reads inside ONE
  // tenant-scoped transaction via the private `…On(client, …)` helpers (Slice 35).
  async getObservationById(tenantId: string, id: AlaraId): Promise<Observation | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<ObservationRow>(
        `SELECT * FROM observations WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToObservation(row) : null;
    });
  }

  async getObservationsForSubject(
    tenantId: string,
    subjectId: string,
    topic?: ObservationTopic,
  ): Promise<Observation[]> {
    return withTenantTransaction(this.db, tenantId, (client) =>
      this.observationsForSubjectOn(client, tenantId, subjectId, topic),
    );
  }

  /**
   * Observations for a subject, run on a CALLER-SUPPLIED transaction client. Shared by
   * `getObservationsForSubject` (which wraps it in a tenant-scoped transaction) and `query`
   * (which runs it on its single transaction client) so the aggregate never opens a nested
   * transaction. Identical SQL/params/ordering/mapping to the original `getObservationsForSubject`.
   */
  private async observationsForSubjectOn(
    client: PoolClient,
    tenantId: string,
    subjectId: string,
    topic?: ObservationTopic,
  ): Promise<Observation[]> {
    if (topic) {
      const r = await client.query<ObservationRow>(
        `SELECT * FROM observations WHERE tenant_id = $1 AND subject_id = $2 AND topic = $3 ORDER BY observed_at DESC`,
        [tenantId, subjectId, topic],
      );
      return r.rows.map(rowToObservation);
    }
    const r = await client.query<ObservationRow>(
      `SELECT * FROM observations WHERE tenant_id = $1 AND subject_id = $2 ORDER BY observed_at DESC`,
      [tenantId, subjectId],
    );
    return r.rows.map(rowToObservation);
  }

  // ── Knowledge Entries ─────────────────────────────────────────────────────

  async getEntryById(tenantId: string, id: AlaraId): Promise<KnowledgeEntry | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<KnowledgeEntryRow>(
        `SELECT * FROM knowledge_entries WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToEntry(row) : null;
    });
  }

  async getActiveEntriesForSubject(
    tenantId: string,
    subjectId: string,
    topic?: ObservationTopic,
  ): Promise<KnowledgeEntry[]> {
    return withTenantTransaction(this.db, tenantId, (client) =>
      this.activeEntriesForSubjectOn(client, tenantId, subjectId, topic),
    );
  }

  /**
   * Active knowledge entries for a subject, run on a CALLER-SUPPLIED transaction client. Shared by
   * `getActiveEntriesForSubject` (which wraps it in a tenant-scoped transaction) and `query`
   * (which runs it on its single transaction client) so the aggregate never opens a nested
   * transaction. Identical SQL/params/ordering/mapping to the original `getActiveEntriesForSubject`.
   */
  private async activeEntriesForSubjectOn(
    client: PoolClient,
    tenantId: string,
    subjectId: string,
    topic?: ObservationTopic,
  ): Promise<KnowledgeEntry[]> {
    if (topic) {
      const r = await client.query<KnowledgeEntryRow>(
        `SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND topic = $3 AND status = 'active' ORDER BY asserted_at DESC`,
        [tenantId, subjectId, topic],
      );
      return r.rows.map(rowToEntry);
    }
    const r = await client.query<KnowledgeEntryRow>(
      `SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY asserted_at DESC`,
      [tenantId, subjectId],
    );
    return r.rows.map(rowToEntry);
  }

  async getAllEntriesForSubject(
    tenantId: string,
    subjectId: string,
  ): Promise<KnowledgeEntry[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<KnowledgeEntryRow>(
        `SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 ORDER BY asserted_at DESC`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToEntry);
    });
  }

  // ── Knowledge Query (the primary interface) ───────────────────────────────

  async query(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    // RLS step 2 (final KnowledgeRepository adoption): the entire query runs inside ONE
    // tenant-scoped transaction — both the entries read and the observations read run on the
    // SAME client with a single `app.tenant_id`. Same SQL/params/ordering/in-memory filtering/
    // returns as before; the two reads are inlined via their `…On` helpers (same order:
    // entries first, then observations) to avoid nested transactions.
    const { entries, observations } = await withTenantTransaction(this.db, q.tenantId, async (client) => ({
      entries: await this.activeEntriesForSubjectOn(client, q.tenantId, q.subjectId, q.topic),
      observations: await this.observationsForSubjectOn(client, q.tenantId, q.subjectId, q.topic),
    }));

    // Apply filters
    const filteredEntries = entries.filter(e => {
      if (q.kind && e.kind !== q.kind) return false;
      if (q.status && e.status !== q.status) return false;
      if (q.minConfidence && CONFIDENCE_RANK[e.confidence] < CONFIDENCE_RANK[q.minConfidence]) return false;
      if (q.activeOnly && e.expiresAt && e.expiresAt < new Date()) return false;
      return true;
    });

    const filteredObs = observations.filter(o => {
      if (q.minConfidence && CONFIDENCE_RANK[o.confidence] < CONFIDENCE_RANK[q.minConfidence]) return false;
      return true;
    });

    return {
      subjectId: q.subjectId,
      entries: filteredEntries,
      observations: filteredObs,
      totalEntries: filteredEntries.length,
      totalObservations: filteredObs.length,
      queriedAt: new Date().toISOString(),
    };
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToObservation(row: ObservationRow): Observation {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    topic: row.topic as ObservationTopic,
    statement: row.statement,
    facts: row.facts as Record<string, unknown>,
    source: row.source as ObservationSource,
    confidence: row.confidence as ObservationConfidence,
    aiInvolved: row.ai_involved,
    sourceEventIds: row.source_event_ids ?? [],
    sourceObservationIds: row.source_observation_ids ?? [],
    observedAt: new Date(row.observed_at),
    actor: row.actor,
    version: row.version,
  };
}

function rowToEntry(row: KnowledgeEntryRow): KnowledgeEntry {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    topic: row.topic as ObservationTopic,
    kind: row.kind as KnowledgeEntryKind,
    status: row.status as KnowledgeEntryStatus,
    statement: row.statement,
    content: row.content as Record<string, unknown>,
    confidence: row.confidence as ObservationConfidence,
    aiInvolved: row.ai_involved,
    supportingObservationIds: row.supporting_observation_ids ?? [],
    supersededById: row.superseded_by_id as AlaraId | null,
    assertedAt: new Date(row.asserted_at),
    assertedBy: row.asserted_by,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    version: row.version,
  };
}
