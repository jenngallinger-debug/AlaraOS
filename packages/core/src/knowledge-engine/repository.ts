/**
 * Alara OS — Knowledge Repository
 *
 * Read layer for the Knowledge Engine.
 * All writes go through the KnowledgeEngine (event-sourced).
 */

import { DatabaseClient } from '../shared/database';
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

  async getObservationById(tenantId: string, id: AlaraId): Promise<Observation | null> {
    const row = await this.db.queryOne<ObservationRow>(
      `SELECT * FROM observations WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return row ? rowToObservation(row) : null;
  }

  async getObservationsForSubject(
    tenantId: string,
    subjectId: string,
    topic?: ObservationTopic,
  ): Promise<Observation[]> {
    if (topic) {
      const rows = await this.db.query<ObservationRow>(
        `SELECT * FROM observations WHERE tenant_id = $1 AND subject_id = $2 AND topic = $3 ORDER BY observed_at DESC`,
        [tenantId, subjectId, topic],
      );
      return rows.map(rowToObservation);
    }
    const rows = await this.db.query<ObservationRow>(
      `SELECT * FROM observations WHERE tenant_id = $1 AND subject_id = $2 ORDER BY observed_at DESC`,
      [tenantId, subjectId],
    );
    return rows.map(rowToObservation);
  }

  // ── Knowledge Entries ─────────────────────────────────────────────────────

  async getEntryById(tenantId: string, id: AlaraId): Promise<KnowledgeEntry | null> {
    const row = await this.db.queryOne<KnowledgeEntryRow>(
      `SELECT * FROM knowledge_entries WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return row ? rowToEntry(row) : null;
  }

  async getActiveEntriesForSubject(
    tenantId: string,
    subjectId: string,
    topic?: ObservationTopic,
  ): Promise<KnowledgeEntry[]> {
    if (topic) {
      const rows = await this.db.query<KnowledgeEntryRow>(
        `SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND topic = $3 AND status = 'active' ORDER BY asserted_at DESC`,
        [tenantId, subjectId, topic],
      );
      return rows.map(rowToEntry);
    }
    const rows = await this.db.query<KnowledgeEntryRow>(
      `SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active' ORDER BY asserted_at DESC`,
      [tenantId, subjectId],
    );
    return rows.map(rowToEntry);
  }

  async getAllEntriesForSubject(
    tenantId: string,
    subjectId: string,
  ): Promise<KnowledgeEntry[]> {
    const rows = await this.db.query<KnowledgeEntryRow>(
      `SELECT * FROM knowledge_entries WHERE tenant_id = $1 AND subject_id = $2 ORDER BY asserted_at DESC`,
      [tenantId, subjectId],
    );
    return rows.map(rowToEntry);
  }

  // ── Knowledge Query (the primary interface) ───────────────────────────────

  async query(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    const entries = await this.getActiveEntriesForSubject(q.tenantId, q.subjectId, q.topic);
    const observations = await this.getObservationsForSubject(q.tenantId, q.subjectId, q.topic);

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
