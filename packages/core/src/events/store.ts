/**
 * Alara OS — Event Store
 *
 * Append-only, immutable event log. Source of truth for the operating layer.
 *
 * KEY PROPERTIES:
 *   - Append-only: no UPDATE, no DELETE on the events table.
 *   - Idempotent append: re-appending an event with the same ID is a no-op.
 *   - Ordered per stream: seq is monotonically increasing per streamId.
 *   - Replayable: loadStream returns events in seq order for state reconstruction.
 *   - Transactional: append and object-state update happen in one transaction.
 */

import { PoolClient } from 'pg';
import { DatabaseClient } from '../shared/database';
import { newEventId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { DomainEvent, EventType } from './types';

// ─── Row shape from Postgres ──────────────────────────────────────────────────

interface EventRow {
  id: string;
  tenant_id: string;
  stream_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  actor: string;
  occurred_at: Date;
  causation_id: string | null;
  correlation_id: string | null;
}

// ─── Append options ───────────────────────────────────────────────────────────

export interface AppendEventOptions<TPayload = Record<string, unknown>> {
  tenantId: string;
  streamId: AlaraId;
  type: EventType;
  payload: TPayload;
  actor: string;
  causationId?: string;
  correlationId?: string;
  /** If provided, append runs inside this transaction */
  client?: PoolClient;
}

// ─── Event Store ─────────────────────────────────────────────────────────────

export class EventStore {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Append an event to a stream.
   *
   * Concurrency: the next seq is MAX(seq)+1 for the stream. To make the
   * read-then-insert race-free under concurrent appends to the SAME stream, the
   * transaction first takes a transaction-scoped advisory lock keyed on
   * (tenant_id, stream_id). The lock is held until COMMIT/ROLLBACK, so two
   * concurrent appends to one stream are serialized and receive contiguous seqs;
   * appends to DIFFERENT streams take different locks and proceed concurrently.
   * The UNIQUE(stream_id, seq) constraint remains as a correctness backstop.
   *
   * Idempotency: if eventId already exists, returns the stored event
   * without inserting (caller can pass a deterministic ID for idempotency).
   */
  async append<TPayload = Record<string, unknown>>(
    opts: AppendEventOptions<TPayload>,
  ): Promise<DomainEvent<TPayload>> {
    const eventId = newEventId();

    const insert = async (client: PoolClient): Promise<DomainEvent<TPayload>> => {
      // Serialize concurrent appends to the SAME stream. pg_advisory_xact_lock is
      // transaction-scoped (auto-released at COMMIT/ROLLBACK); the two int4 keys are
      // hashtext(tenant_id), hashtext(stream_id) so different streams never block here.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [opts.tenantId, opts.streamId],
      );

      // Idempotency check
      const existing = await client.query<EventRow>(
        `SELECT * FROM events WHERE id = $1`,
        [eventId],
      );
      if (existing.rows.length > 0) {
        return rowToEvent<TPayload>(existing.rows[0]);
      }

      // Next seq — race-free under the advisory lock held above.
      const seqResult = await client.query<{ next_seq: number }>(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
           FROM events
          WHERE stream_id = $1 AND tenant_id = $2`,
        [opts.streamId, opts.tenantId],
      );
      const seq = seqResult.rows[0].next_seq;

      const row = await client.query<EventRow>(
        `INSERT INTO events
           (id, tenant_id, stream_id, seq, type, payload, actor,
            causation_id, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          eventId,
          opts.tenantId,
          opts.streamId,
          seq,
          opts.type,
          JSON.stringify(opts.payload),
          opts.actor,
          opts.causationId ?? null,
          opts.correlationId ?? null,
        ],
      );

      return rowToEvent<TPayload>(row.rows[0]);
    };

    if (opts.client) {
      return insert(opts.client);
    }

    return this.db.transaction(insert);
  }

  /**
   * Load all events for a stream in seq order.
   * This is the replay path — fold these to reconstruct object state.
   */
  async loadStream(
    tenantId: string,
    streamId: AlaraId,
    fromSeq = 1,
  ): Promise<DomainEvent[]> {
    const rows = await this.db.query<EventRow>(
      `SELECT *
         FROM events
        WHERE stream_id = $1
          AND tenant_id = $2
          AND seq >= $3
        ORDER BY seq ASC`,
      [streamId, tenantId, fromSeq],
    );

    return rows.map((r) => rowToEvent(r));
  }

  /**
   * Load all events across all streams for a tenant.
   * Used for Org Brain / projection rebuilds — not for normal queries.
   */
  async loadAll(
    tenantId: string,
    afterEventId?: string,
  ): Promise<DomainEvent[]> {
    if (afterEventId) {
      const rows = await this.db.query<EventRow>(
        `SELECT e.*
           FROM events e
           JOIN events pivot ON pivot.id = $2
          WHERE e.tenant_id = $1
            AND e.occurred_at >= pivot.occurred_at
            AND e.id != $2
          ORDER BY e.occurred_at ASC, e.seq ASC`,
        [tenantId, afterEventId],
      );
      return rows.map(rowToEvent);
    }

    const rows = await this.db.query<EventRow>(
      `SELECT * FROM events WHERE tenant_id = $1 ORDER BY occurred_at ASC, seq ASC`,
      [tenantId],
    );
    return rows.map(rowToEvent);
  }

  /**
   * Count events in a stream (for diagnostics / tests).
   */
  async countInStream(tenantId: string, streamId: AlaraId): Promise<number> {
    const result = await this.db.queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM events WHERE stream_id = $1 AND tenant_id = $2`,
      [streamId, tenantId],
    );
    return parseInt(result?.cnt ?? '0', 10);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToEvent<TPayload = Record<string, unknown>>(
  row: EventRow,
): DomainEvent<TPayload> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    streamId: row.stream_id as AlaraId,
    seq: row.seq,
    type: row.type as EventType,
    payload: row.payload as TPayload,
    actor: row.actor,
    occurredAt: new Date(row.occurred_at),
    causationId: row.causation_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
  };
}
