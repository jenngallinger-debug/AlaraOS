/**
 * Alara OS — Journey Engine Repository (M10.5)
 * Read/write layer for Journey objects.
 * All writes are event-sourced through JourneyEngine.
 */

import { DatabaseClient } from '../shared/database';
import { withTenantTransaction } from '../shared/tenant-scope';
import { AlaraId, makeAlaraId } from '../shared/types';
import {
  CapabilityToken,
  Journey,
  JourneyCoordinationState,
  JourneyEvent,
  JourneyEventType,
  JourneyLifecycle,
  JourneyProjection,
  JourneyReference,
  JourneyReferenceKind,
  HumanHandoff,
  NextStep,
  WorkItem,
} from './types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface JourneyRow {
  id: string; tenant_id: string;
  intent: string | null; intent_inferred_at: string | null;
  lifecycle: string; lifecycle_changed_at: string;
  coordination_state: unknown;
  identity_resolved: boolean;
  merged_from: string[]; split_from: string | null;
  created_at: string; updated_at: string;
}

interface JourneyReferenceRow {
  id: string; journey_id: string; tenant_id: string;
  kind: string; ref_id: string; role: string | null;
  linked_at: string; linked_by: string | null; meta: unknown;
}

interface JourneyEventRow {
  id: string; journey_id: string; tenant_id: string;
  event_type: string; payload: unknown;
  ref_kind: string | null; ref_id: string | null;
  occurred_at: string; caused_by: string | null;
}

interface JourneyProjectionRow {
  journey_id: string; tenant_id: string; projection_type: string;
  lifecycle: string; intent: string | null; obstacle: string | null; actor: string | null;
  work_summary: unknown; next_step: unknown; human_handoff: unknown;
  last_event_id: string | null; projected_at: string;
}

interface CapabilityTokenRow {
  token: string; journey_id: string; tenant_id: string;
  issued_at: string; expires_at: string | null; revoked: boolean;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToJourney(r: JourneyRow): Journey {
  const cs = (typeof r.coordination_state === 'string'
    ? JSON.parse(r.coordination_state)
    : r.coordination_state ?? {}) as JourneyCoordinationState;
  return {
    id: makeAlaraId(r.id),
    tenantId: r.tenant_id,
    intent: r.intent,
    intentInferredAt: r.intent_inferred_at ? new Date(r.intent_inferred_at) : null,
    lifecycle: r.lifecycle as JourneyLifecycle,
    lifecycleChangedAt: new Date(r.lifecycle_changed_at),
    coordinationState: cs,
    identityResolved: r.identity_resolved,
    mergedFrom: (r.merged_from ?? []).map(makeAlaraId),
    splitFrom: r.split_from ? makeAlaraId(r.split_from) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function rowToReference(r: JourneyReferenceRow): JourneyReference {
  return {
    id: makeAlaraId(r.id),
    journeyId: makeAlaraId(r.journey_id),
    tenantId: r.tenant_id,
    kind: r.kind as JourneyReferenceKind,
    refId: makeAlaraId(r.ref_id),
    role: r.role,
    linkedAt: new Date(r.linked_at),
    linkedBy: r.linked_by ? makeAlaraId(r.linked_by) : null,
    meta: (typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta ?? {}) as Record<string, unknown>,
  };
}

function rowToEvent(r: JourneyEventRow): JourneyEvent {
  return {
    id: r.id,
    journeyId: makeAlaraId(r.journey_id),
    tenantId: r.tenant_id,
    eventType: r.event_type as JourneyEventType,
    payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload ?? {}) as Record<string, unknown>,
    refKind: r.ref_kind ? r.ref_kind as JourneyReferenceKind : null,
    refId: r.ref_id ? makeAlaraId(r.ref_id) : null,
    occurredAt: new Date(r.occurred_at),
    causedBy: r.caused_by,
  };
}

function rowToProjection(r: JourneyProjectionRow): JourneyProjection {
  const rawWork = (typeof r.work_summary === 'string'
    ? JSON.parse(r.work_summary)
    : r.work_summary ?? []) as WorkItem[];
  const rawNs = (typeof r.next_step === 'string'
    ? JSON.parse(r.next_step)
    : r.next_step) as NextStep | null;
  const rawHh = (typeof r.human_handoff === 'string'
    ? JSON.parse(r.human_handoff)
    : r.human_handoff) as HumanHandoff | null;
  return {
    PROJECTION_TYPE: 'journey_state',
    journeyId: makeAlaraId(r.journey_id),
    tenantId: r.tenant_id,
    lifecycle: r.lifecycle as JourneyLifecycle,
    intent: r.intent,
    obstacle: r.obstacle,
    actor: r.actor,
    workSummary: rawWork ?? [],
    nextStep: rawNs ?? null,
    humanHandoff: rawHh ?? null,
    lastEventId: r.last_event_id,
    projectedAt: new Date(r.projected_at),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class JourneyRepository {
  constructor(private readonly db: DatabaseClient) {}

  // ── Journeys ──────────────────────────────────────────────────────────────

  // RLS step 2 (write phase, Journey adoption): each write runs inside a per-method tenant-scoped
  // transaction (carries `app.tenant_id` = the row's own tenant). Behavior-preserving today — RLS is
  // inert (no policy on journey_* tables); identical SQL/params/returns. Each write stays a single
  // statement, so multi-write engine commands remain non-atomic exactly as before (no engine-level
  // transaction introduced). No policy / FORCE / WITH CHECK added; forward-compatible with a future
  // WITH CHECK because the GUC equals the written/filtered tenant_id.
  async insert(j: Journey): Promise<void> {
    await withTenantTransaction(this.db, j.tenantId, async (client) => {
      await client.query(
        `INSERT INTO journeys
        (id, tenant_id, intent, intent_inferred_at, lifecycle, lifecycle_changed_at,
         coordination_state, identity_resolved, merged_from, split_from, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          j.id, j.tenantId, j.intent, j.intentInferredAt?.toISOString() ?? null,
          j.lifecycle, j.lifecycleChangedAt.toISOString(),
          JSON.stringify(j.coordinationState), j.identityResolved,
          j.mergedFrom, j.splitFrom ?? null,
          j.createdAt.toISOString(), j.updatedAt.toISOString(),
        ],
      );
    });
  }

  async findById(id: AlaraId, tenantId: string): Promise<Journey | null> {
    const rows = await this.db.query<JourneyRow>(
      `SELECT * FROM journeys WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return rows[0] ? rowToJourney(rows[0]) : null;
  }

  async updateLifecycle(
    id: AlaraId, tenantId: string, lifecycle: JourneyLifecycle, now: Date,
  ): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `UPDATE journeys SET lifecycle=$1, lifecycle_changed_at=$2, updated_at=$3
       WHERE id=$4 AND tenant_id=$5`,
        [lifecycle, now.toISOString(), now.toISOString(), id, tenantId],
      );
    });
  }

  async updateIntent(
    id: AlaraId, tenantId: string, intent: string, now: Date,
  ): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `UPDATE journeys SET intent=$1, intent_inferred_at=$2, updated_at=$3
       WHERE id=$4 AND tenant_id=$5`,
        [intent, now.toISOString(), now.toISOString(), id, tenantId],
      );
    });
  }

  async updateCoordinationState(
    id: AlaraId, tenantId: string, state: JourneyCoordinationState, now: Date,
  ): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `UPDATE journeys SET coordination_state=$1, updated_at=$2
       WHERE id=$3 AND tenant_id=$4`,
        [JSON.stringify(state), now.toISOString(), id, tenantId],
      );
    });
  }

  async updateMergedFrom(
    id: AlaraId, tenantId: string, mergedFrom: readonly AlaraId[], now: Date,
  ): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `UPDATE journeys SET merged_from=$1, updated_at=$2 WHERE id=$3 AND tenant_id=$4`,
        [mergedFrom, now.toISOString(), id, tenantId],
      );
    });
  }

  async markIdentityResolved(id: AlaraId, tenantId: string, now: Date): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `UPDATE journeys SET identity_resolved=true, updated_at=$1 WHERE id=$2 AND tenant_id=$3`,
        [now.toISOString(), id, tenantId],
      );
    });
  }

  async listByLifecycle(
    lifecycle: JourneyLifecycle, tenantId: string, limit = 100,
  ): Promise<Journey[]> {
    const rows = await this.db.query<JourneyRow>(
      `SELECT * FROM journeys WHERE lifecycle=$1 AND tenant_id=$2
       ORDER BY created_at LIMIT $3`,
      [lifecycle, tenantId, limit],
    );
    return rows.map(rowToJourney);
  }

  // ── References ────────────────────────────────────────────────────────────

  async insertReference(ref: JourneyReference): Promise<void> {
    await withTenantTransaction(this.db, ref.tenantId, async (client) => {
      await client.query(
        `INSERT INTO journey_references
        (id, tenant_id, journey_id, kind, ref_id, role, linked_at, linked_by, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, journey_id, kind, ref_id) DO NOTHING`,
        [
          ref.id, ref.tenantId, ref.journeyId, ref.kind, ref.refId,
          ref.role, ref.linkedAt.toISOString(), ref.linkedBy ?? null,
          JSON.stringify(ref.meta),
        ],
      );
    });
  }

  async getReferences(
    journeyId: AlaraId, tenantId: string, kind?: JourneyReferenceKind,
  ): Promise<JourneyReference[]> {
    const rows = kind
      ? await this.db.query<JourneyReferenceRow>(
          `SELECT * FROM journey_references
           WHERE journey_id=$1 AND tenant_id=$2 AND kind=$3 ORDER BY linked_at`,
          [journeyId, tenantId, kind],
        )
      : await this.db.query<JourneyReferenceRow>(
          `SELECT * FROM journey_references
           WHERE journey_id=$1 AND tenant_id=$2 ORDER BY linked_at`,
          [journeyId, tenantId],
        );
    return rows.map(rowToReference);
  }

  async findJourneysReferencing(
    kind: JourneyReferenceKind, refId: AlaraId, tenantId: string,
  ): Promise<AlaraId[]> {
    const rows = await this.db.query<{ journey_id: string }>(
      `SELECT journey_id FROM journey_references
       WHERE kind=$1 AND ref_id=$2 AND tenant_id=$3 ORDER BY linked_at`,
      [kind, refId, tenantId],
    );
    return rows.map(r => makeAlaraId(r.journey_id));
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async appendEvent(evt: JourneyEvent): Promise<void> {
    await withTenantTransaction(this.db, evt.tenantId, async (client) => {
      await client.query(
        `INSERT INTO journey_events
        (id, tenant_id, journey_id, event_type, payload, ref_kind, ref_id, occurred_at, caused_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          evt.id, evt.tenantId, evt.journeyId, evt.eventType,
          JSON.stringify(evt.payload),
          evt.refKind ?? null, evt.refId ?? null,
          evt.occurredAt.toISOString(), evt.causedBy ?? null,
        ],
      );
    });
  }

  async getEvents(
    journeyId: AlaraId, tenantId: string, afterId?: string,
  ): Promise<JourneyEvent[]> {
    const rows = afterId
      ? await this.db.query<JourneyEventRow>(
          `SELECT * FROM journey_events
           WHERE journey_id=$1 AND tenant_id=$2
             AND occurred_at > (SELECT occurred_at FROM journey_events WHERE id=$3)
           ORDER BY occurred_at, id`,
          [journeyId, tenantId, afterId],
        )
      : await this.db.query<JourneyEventRow>(
          `SELECT * FROM journey_events
           WHERE journey_id=$1 AND tenant_id=$2
           ORDER BY occurred_at, id`,
          [journeyId, tenantId],
        );
    return rows.map(rowToEvent);
  }

  // ── Projection ────────────────────────────────────────────────────────────

  async upsertProjection(proj: JourneyProjection): Promise<void> {
    await withTenantTransaction(this.db, proj.tenantId, async (client) => {
      await client.query(
        `INSERT INTO journey_projections
        (journey_id, tenant_id, projection_type, lifecycle, intent, obstacle, actor,
         work_summary, next_step, human_handoff, last_event_id, projected_at)
       VALUES ($1,$2,'journey_state',$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (journey_id)
       DO UPDATE SET
         lifecycle=$3, intent=$4, obstacle=$5, actor=$6,
         work_summary=$7, next_step=$8, human_handoff=$9,
         last_event_id=$10, projected_at=$11`,
        [
          proj.journeyId, proj.tenantId,
          proj.lifecycle, proj.intent, proj.obstacle, proj.actor,
          JSON.stringify(proj.workSummary),
          proj.nextStep ? JSON.stringify(proj.nextStep) : null,
          proj.humanHandoff ? JSON.stringify(proj.humanHandoff) : null,
          proj.lastEventId, proj.projectedAt.toISOString(),
        ],
      );
    });
  }

  async getProjection(
    journeyId: AlaraId, tenantId: string,
  ): Promise<JourneyProjection | null> {
    const rows = await this.db.query<JourneyProjectionRow>(
      `SELECT * FROM journey_projections WHERE journey_id=$1 AND tenant_id=$2`,
      [journeyId, tenantId],
    );
    return rows[0] ? rowToProjection(rows[0]) : null;
  }

  // ── Capability tokens ─────────────────────────────────────────────────────

  async storeToken(
    token: string, journeyId: AlaraId, tenantId: string,
    expiresAt: Date | null, now: Date,
  ): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `INSERT INTO journey_capability_tokens (token, journey_id, tenant_id, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
        [token, journeyId, tenantId, now.toISOString(), expiresAt?.toISOString() ?? null],
      );
    });
  }

  async resolveToken(token: string, tenantId: string): Promise<AlaraId | null> {
    const rows = await this.db.query<{ journey_id: string }>(
      `SELECT journey_id FROM journey_capability_tokens
       WHERE token=$1 AND tenant_id=$2 AND revoked=false
         AND (expires_at IS NULL OR expires_at > $3)`,
      [token, tenantId, new Date().toISOString()],
    );
    return rows[0] ? makeAlaraId(rows[0].journey_id) : null;
  }

  async revokeToken(token: string, tenantId: string, now: Date): Promise<void> {
    await withTenantTransaction(this.db, tenantId, async (client) => {
      await client.query(
        `UPDATE journey_capability_tokens SET revoked=true, revoked_at=$1
       WHERE token=$2 AND tenant_id=$3`,
        [now.toISOString(), token, tenantId],
      );
    });
  }
}
