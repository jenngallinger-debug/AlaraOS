/**
 * Alara OS — Knowledge Engine
 *
 * Manages the organizational knowledge lifecycle:
 *   Observations (perceived facts) → KnowledgeEntries (asserted knowledge)
 *
 * Every write is event-sourced. State is reconstructable from the event stream.
 *
 * ADR-001: No clinical content (visit notes, assessments, POC, orders).
 *   The engine enforces this at write time.
 *
 * ADR-015: AI may read, not write directly. If aiInvolved=true, the entry
 *   is flagged — humans remain accountable for all AI-assisted knowledge.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import {
  AssertKnowledgeCommand,
  ClinicalContentViolationError,
  KnowledgeAssertedPayload,
  KnowledgeEntry,
  KnowledgeEntryNotFoundError,
  KnowledgeRetractedPayload,
  KnowledgeRetractedPayload as RetractedPayload,
  KnowledgeSupersededPayload,
  Observation,
  ObservationRecordedPayload,
  RecordObservationCommand,
  RetractKnowledgeCommand,
  StaleKnowledgeEntryError,
  SupersedeKnowledgeCommand,
} from './types';
import { KnowledgeRepository } from './repository';

// ─── ADR-001: Clinical content guard ─────────────────────────────────────────

const CLINICAL_CONTENT_KEYS = new Set([
  'visitNotes', 'clinicalNotes', 'assessmentText', 'planOfCare', 'orderContent',
  'diagnosisCode', 'icd10', 'procedureCode', 'cpt', 'medications_full',
  'oasis', '485', 'clinicalDocs', 'soapNote', 'progressNote',
]);

function enforceClinicalBoundary(content: Record<string, unknown>): void {
  for (const key of Object.keys(content)) {
    if (CLINICAL_CONTENT_KEYS.has(key)) {
      throw new ClinicalContentViolationError(key);
    }
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class KnowledgeEngine {
  readonly repo: KnowledgeRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
  ) {
    this.repo = new KnowledgeRepository(db);
  }

  // ── Record Observation ─────────────────────────────────────────────────────

  async recordObservation(cmd: RecordObservationCommand): Promise<Observation> {
    // ADR-001: no clinical content
    enforceClinicalBoundary(cmd.facts);

    return this.db.transaction(async (client) => {
      const id = newAlaraId();

      await client.query(
        `INSERT INTO observations
           (id, tenant_id, subject_id, subject_type, topic, statement, facts,
            source, confidence, ai_involved, source_event_ids, source_observation_ids, actor, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)`,
        [
          id, cmd.tenantId, cmd.subjectId, cmd.subjectType, cmd.topic,
          cmd.statement, JSON.stringify(cmd.facts), cmd.source, cmd.confidence,
          cmd.aiInvolved, JSON.stringify(cmd.sourceEventIds),
          JSON.stringify(cmd.sourceObservationIds), cmd.actor,
        ],
      );

      const payload: ObservationRecordedPayload = {
        observationId: String(id),
        subjectId: cmd.subjectId,
        subjectType: cmd.subjectType,
        topic: cmd.topic,
        source: cmd.source,
        confidence: cmd.confidence,
        aiInvolved: cmd.aiInvolved,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: id,
        type: 'ObservationRecorded' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });

      return (await this.repo.getObservationById(cmd.tenantId, id))!;
    });
  }

  // ── Assert Knowledge Entry ─────────────────────────────────────────────────

  async assertKnowledge(cmd: AssertKnowledgeCommand): Promise<KnowledgeEntry> {
    // ADR-001: no clinical content
    enforceClinicalBoundary(cmd.content);

    return this.db.transaction(async (client) => {
      const id = newAlaraId();

      await client.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, subject_id, subject_type, topic, kind, status,
            statement, content, confidence, ai_involved, supporting_observation_ids,
            asserted_by, expires_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,1)`,
        [
          id, cmd.tenantId, cmd.subjectId, cmd.subjectType, cmd.topic, cmd.kind,
          cmd.statement, JSON.stringify(cmd.content), cmd.confidence, cmd.aiInvolved,
          JSON.stringify(cmd.supportingObservationIds), cmd.actor,
          cmd.expiresAt?.toISOString() ?? null,
        ],
      );

      const payload: KnowledgeAssertedPayload = {
        entryId: String(id),
        subjectId: cmd.subjectId,
        topic: cmd.topic,
        kind: cmd.kind,
        confidence: cmd.confidence,
        aiInvolved: cmd.aiInvolved,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: id,
        type: 'KnowledgeAsserted' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });

      return (await this.repo.getEntryById(cmd.tenantId, id))!;
    });
  }

  // ── Supersede Knowledge Entry ──────────────────────────────────────────────

  async supersedeKnowledge(cmd: SupersedeKnowledgeCommand): Promise<KnowledgeEntry> {
    enforceClinicalBoundary(cmd.newContent);

    return this.db.transaction(async (client) => {
      // Fetch and version-check existing entry
      const existing = await this.repo.getEntryById(cmd.tenantId, cmd.entryId);
      if (!existing) throw new KnowledgeEntryNotFoundError(cmd.entryId);
      if (existing.version !== cmd.expectedVersion) {
        throw new StaleKnowledgeEntryError(cmd.entryId, cmd.expectedVersion, existing.version);
      }

      // Create new entry
      const newId = newAlaraId();
      await client.query(
        `INSERT INTO knowledge_entries
           (id, tenant_id, subject_id, subject_type, topic, kind, status,
            statement, content, confidence, ai_involved, supporting_observation_ids,
            asserted_by, expires_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,1)`,
        [
          newId, cmd.tenantId, existing.subjectId, existing.subjectType,
          existing.topic, existing.kind, cmd.newStatement,
          JSON.stringify(cmd.newContent), existing.confidence, existing.aiInvolved,
          JSON.stringify(existing.supportingObservationIds), cmd.actor, null,
        ],
      );

      // Mark old entry as superseded
      await client.query(
        `UPDATE knowledge_entries SET status = 'superseded', superseded_by_id = $1, version = version + 1
         WHERE id = $2 AND tenant_id = $3 AND version = $4`,
        [newId, cmd.entryId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: KnowledgeSupersededPayload = {
        oldEntryId: String(cmd.entryId),
        newEntryId: String(newId),
        reason: cmd.reason,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.entryId,
        type: 'KnowledgeSuperseded' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });

      return (await this.repo.getEntryById(cmd.tenantId, newId))!;
    });
  }

  // ── Retract Knowledge Entry ────────────────────────────────────────────────

  async retractKnowledge(cmd: RetractKnowledgeCommand): Promise<void> {
    return this.db.transaction(async (client) => {
      const existing = await this.repo.getEntryById(cmd.tenantId, cmd.entryId);
      if (!existing) throw new KnowledgeEntryNotFoundError(cmd.entryId);
      if (existing.version !== cmd.expectedVersion) {
        throw new StaleKnowledgeEntryError(cmd.entryId, cmd.expectedVersion, existing.version);
      }

      await client.query(
        `UPDATE knowledge_entries SET status = 'retracted', version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.entryId, cmd.tenantId, cmd.expectedVersion],
      );

      const payload: RetractedPayload = {
        entryId: String(cmd.entryId),
        reason: cmd.reason,
      };

      await this.eventStore.append({
        tenantId: cmd.tenantId,
        streamId: cmd.entryId,
        type: 'KnowledgeRetracted' as EventType,
        payload: payload as unknown as Record<string, unknown>,
        actor: cmd.actor,
        client,
      });
    });
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedKnowledgeEntry {
  id: AlaraId;
  status: string;
  topic: string;
  kind: string;
  statement: string;
  version: number;
  supersededById: string | null;
}

export async function reconstructKnowledgeEntryFromEvents(
  eventStore: EventStore,
  tenantId: string,
  entryId: AlaraId,
): Promise<ReconstructedKnowledgeEntry | null> {
  const events = await eventStore.loadStream(tenantId, entryId);
  if (!events.length) return null;

  let status = 'active';
  let topic = '';
  let kind = '';
  let statement = '';
  let version = 0;
  let supersededById: string | null = null;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'KnowledgeAsserted':
        topic = p.topic as string;
        kind = p.kind as string;
        break;
      case 'KnowledgeSuperseded':
        status = 'superseded';
        supersededById = p.newEntryId as string;
        break;
      case 'KnowledgeRetracted':
        status = 'retracted';
        break;
    }
  }

  return { id: entryId, status, topic, kind, statement, version, supersededById };
}

export async function reconstructObservationFromEvents(
  eventStore: EventStore,
  tenantId: string,
  observationId: AlaraId,
): Promise<{ id: AlaraId; topic: string; source: string; confidence: string } | null> {
  const events = await eventStore.loadStream(tenantId, observationId);
  if (!events.length) return null;

  const first = events[0];
  const p = first.payload as Record<string, unknown>;
  return {
    id: observationId,
    topic: p.topic as string,
    source: p.source as string,
    confidence: p.confidence as string,
  };
}
