/**
 * Alara OS — In-Memory Test Store (M0 + M1 + M2)
 * Matches DatabaseClient.query<T>() → T[] contract.
 */
import { PoolClient } from 'pg';

export interface ObjectRow {
  id: string; tenant_id: string; type: string; state: string;
  attributes: Record<string, unknown>; version: number; created_at: Date; updated_at: Date;
}
export interface EventRow {
  id: string; tenant_id: string; stream_id: string; seq: number; type: string;
  payload: Record<string, unknown>; actor: string; occurred_at: Date;
  causation_id: string | null; correlation_id: string | null;
}
export interface ExtRefRow { object_id: string; tenant_id: string; system: string; ext_type: string; value: string; }
export interface WorkflowRow {
  id: string; tenant_id: string; template_id: string; template_version: string; name: string;
  for_object_id: string; for_object_type: string; status: string; current_step_id: string | null;
  owner_id: string; steps: unknown[]; version: number; started_at: string | null;
  completed_at: string | null; suppression_reason: string | null;
}
export interface TaskRow {
  id: string; tenant_id: string; task_type: string; title: string; description: string;
  workflow_id: string | null; workflow_step_id: string | null; owner_id: string; status: string;
  due_at: string | null; completed_at: string | null; escalated_at: string | null; version: number;
}
export interface PromiseRow {
  id: string; tenant_id: string; description: string; subject_id: string;
  recipient_id: string; owner_id: string; status: string; due_at: string;
  kept_at: string | null; missed_at: string | null; voided_at: string | null;
  void_reason: string | null; workflow_id: string | null; workflow_step_id: string | null; version: number;
}

function makeTxClient(store: InMemoryStore): PoolClient {
  return {
    query: async (text: string, values?: unknown[]) => {
      const rows = await store.query(text, values ?? []);
      return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
    },
    release: () => {},
  } as unknown as PoolClient;
}

export class InMemoryStore {
  readonly objects = new Map<string, ObjectRow>();
  readonly events: EventRow[] = [];
  readonly extRefs: ExtRefRow[] = [];
  readonly workflows = new Map<string, WorkflowRow>();
  readonly tasks = new Map<string, TaskRow>();
  readonly promises = new Map<string, PromiseRow>();
  readonly communications = new Map<string, CommunicationRow>();

  async query<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
    const t = text.trim().replace(/\s+/g, ' ');

    // ── objects ────────────────────────────────────────────────────────────────
    if (t.startsWith('INSERT INTO objects')) {
      const [id, tenant_id, type, state, attrsStr] = values as string[];
      const attributes = typeof attrsStr === 'string' ? JSON.parse(attrsStr) : attrsStr;
      const row: ObjectRow = { id, tenant_id, type, state, attributes, version: 1, created_at: new Date(), updated_at: new Date() };
      this.objects.set(id, row);
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT id, tenant_id, type, state, attributes')) {
      const [id, tid] = values as string[];
      const row = this.objects.get(id);
      if (!row || row.tenant_id !== tid) return [];
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT * FROM objects WHERE id')) {
      const [id] = values as string[];
      const row = this.objects.get(id);
      return (row ? [row] : []) as unknown as T[];
    }
    if (t.startsWith('UPDATE objects')) {
      const [changesStr, id, tid, ver] = values as [string, string, string, number];
      const row = this.objects.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      const changes = typeof changesStr === 'string' ? JSON.parse(changesStr) : changesStr;
      row.attributes = { ...row.attributes, ...changes };
      row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }

    // ── events ─────────────────────────────────────────────────────────────────
    if (t.includes('SELECT COALESCE(MAX(seq)')) {
      const [sid, tid] = values as string[];
      const max = this.events.filter(e => e.stream_id === sid && e.tenant_id === tid).reduce((m, e) => Math.max(m, e.seq), 0);
      return [{ next_seq: max + 1 }] as unknown as T[];
    }
    if (t.startsWith('SELECT * FROM events WHERE id')) {
      const [id] = values as string[];
      const e = this.events.find(e => e.id === id);
      return (e ? [e] : []) as unknown as T[];
    }
    if (t.startsWith('INSERT INTO events')) {
      const [id, tid, sid, seq, type, payStr, actor, causation_id, correlation_id] = values as (string | number | null)[];
      const payload = typeof payStr === 'string' ? JSON.parse(payStr) : (payStr ?? {});
      const row: EventRow = { id: id as string, tenant_id: tid as string, stream_id: sid as string, seq: seq as number, type: type as string, payload, actor: actor as string, occurred_at: new Date(), causation_id: causation_id as string | null, correlation_id: correlation_id as string | null };
      this.events.push(row);
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT *') && t.includes('FROM events') && t.includes('ORDER BY seq')) {
      const [sid, tid, fromSeq] = values as [string, string, number];
      return this.events.filter(e => e.stream_id === sid && e.tenant_id === tid && e.seq >= Number(fromSeq)).sort((a, b) => a.seq - b.seq) as unknown as T[];
    }
    if (t.startsWith('SELECT COUNT(*)') && t.includes('FROM events')) {
      const [sid, tid] = values as string[];
      return [{ cnt: String(this.events.filter(e => e.stream_id === sid && e.tenant_id === tid).length) }] as unknown as T[];
    }

    // ── external_references ────────────────────────────────────────────────────
    if (t.startsWith('INSERT INTO external_references')) {
      const [oid, tid, system, ext_type, value] = values as string[];
      const idx = this.extRefs.findIndex(r => r.object_id === oid && r.system === system && r.ext_type === ext_type);
      if (idx >= 0) { this.extRefs[idx].value = value; } else { this.extRefs.push({ object_id: oid, tenant_id: tid, system, ext_type, value }); }
      return [] as unknown as T[];
    }
    if (t.startsWith('SELECT system, ext_type, value') || t.startsWith('SELECT o.id')) {
      const [oid, tid] = values as string[];
      return this.extRefs.filter(r => r.object_id === oid && r.tenant_id === tid) as unknown as T[];
    }

    // ── workflows ──────────────────────────────────────────────────────────────
    if (t.startsWith('INSERT INTO workflows')) {
      const [id, tid, tplId, tplVer, name, forObjId, forObjType, stepId, ownerId, stepsStr] = values as string[];
      const steps = typeof stepsStr === 'string' ? JSON.parse(stepsStr) : stepsStr;
      const row: WorkflowRow = { id, tenant_id: tid, template_id: tplId, template_version: tplVer, name, for_object_id: forObjId, for_object_type: forObjType, status: 'active', current_step_id: stepId, owner_id: ownerId, steps, version: 1, started_at: null, completed_at: null, suppression_reason: null };
      this.workflows.set(id, row);
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT * FROM workflows')) {
      const [id, tid] = values as string[];
      const row = this.workflows.get(id);
      if (!row || row.tenant_id !== tid) return [];
      return [row] as unknown as T[];
    }
    if (t.startsWith('UPDATE workflows SET status=$1, current_step_id')) {
      const [newStatus, nextStepId, stepsStr, completedAt, id, tid, ver] = values as (string | null)[];
      const row = this.workflows.get(id as string);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = newStatus as string;
      row.current_step_id = nextStepId;
      row.steps = typeof stepsStr === 'string' ? JSON.parse(stepsStr) : stepsStr;
      if (completedAt) row.completed_at = completedAt;
      row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE workflows SET status='suppressed'")) {
      const [reason, id, tid, ver] = values as string[];
      const row = this.workflows.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'suppressed'; row.suppression_reason = reason; row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }

    // ── tasks ──────────────────────────────────────────────────────────────────
    if (t.startsWith('INSERT INTO tasks')) {
      const [id, tid, taskType, title, desc, wfId, stepId, ownerId, dueAt] = values as (string | null)[];
      const row: TaskRow = { id: id!, tenant_id: tid!, task_type: taskType!, title: title!, description: desc!, workflow_id: wfId ?? null, workflow_step_id: stepId ?? null, owner_id: ownerId!, status: 'open', due_at: dueAt ?? null, completed_at: null, escalated_at: null, version: 1 };
      this.tasks.set(id!, row);
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT * FROM tasks')) {
      const [id, tid] = values as string[];
      const row = this.tasks.get(id);
      if (!row || row.tenant_id !== tid) return [];
      return [row] as unknown as T[];
    }
    if (t.startsWith("UPDATE tasks SET status='completed'")) {
      const [id, tid, ver] = values as string[];
      const row = this.tasks.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'completed'; row.completed_at = new Date().toISOString(); row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith('UPDATE tasks SET owner_id')) {
      const [newOwner, id, tid, ver] = values as string[];
      const row = this.tasks.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.owner_id = newOwner; row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE tasks SET status='escalated'")) {
      const [id, tid, ver] = values as string[];
      const row = this.tasks.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'escalated'; row.escalated_at = new Date().toISOString(); row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }

    // ── promises ───────────────────────────────────────────────────────────────
    if (t.startsWith('INSERT INTO promises')) {
      const [id, tid, desc, subjId, recipId, ownerId, dueAt, wfId, stepId] = values as (string | null)[];
      const row: PromiseRow = { id: id!, tenant_id: tid!, description: desc!, subject_id: subjId!, recipient_id: recipId!, owner_id: ownerId!, status: 'open', due_at: dueAt!, kept_at: null, missed_at: null, voided_at: null, void_reason: null, workflow_id: wfId ?? null, workflow_step_id: stepId ?? null, version: 1 };
      this.promises.set(id!, row);
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT * FROM promises')) {
      const [id, tid] = values as string[];
      const row = this.promises.get(id);
      if (!row || row.tenant_id !== tid) return [];
      return [row] as unknown as T[];
    }
    if (t.startsWith("UPDATE promises SET status='kept'")) {
      const [id, tid, ver] = values as string[];
      const row = this.promises.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'kept'; row.kept_at = new Date().toISOString(); row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE promises SET status='missed'")) {
      const [id, tid, ver] = values as string[];
      const row = this.promises.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'missed'; row.missed_at = new Date().toISOString(); row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE promises SET status='voided'")) {
      const [reason, id, tid, ver] = values as string[];
      const row = this.promises.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'voided'; row.voided_at = new Date().toISOString(); row.void_reason = reason; row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }

    // ── communications ─────────────────────────────────────────────────────────
    if (t.startsWith('INSERT INTO communications')) {
      const [id, tid, channel, purpose, subjId, wfId, recipType, recipId, subj, body] = values as (string | null)[];
      const row: CommunicationRow = {
        id: id!, tenant_id: tid!, channel: channel!, purpose: purpose!,
        subject_id: subjId!, workflow_id: wfId ?? null,
        recipient_type: recipType!, recipient_id: recipId!,
        subject: subj!, body: body ?? '', status: 'created',
        created_at: new Date().toISOString(), queued_at: null, sent_at: null,
        delivered_at: null, failed_at: null, failure_reason: null, adapter_used: null, version: 1,
      };
      this.communications.set(id!, row);
      return [row] as unknown as T[];
    }
    if (t.startsWith('SELECT * FROM communications')) {
      const [id, tid] = values as string[];
      const row = this.communications.get(id);
      if (!row || row.tenant_id !== tid) return [];
      return [row] as unknown as T[];
    }
    if (t.startsWith("UPDATE communications SET status='queued'")) {
      const [id, tid, ver] = values as string[];
      const row = this.communications.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'queued'; row.queued_at = new Date().toISOString(); row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE communications SET status='sent'")) {
      const [adapterName, id, tid, ver] = values as string[];
      const row = this.communications.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'sent'; row.sent_at = new Date().toISOString(); row.adapter_used = adapterName; row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE communications SET status='delivered'")) {
      const [id, tid, ver] = values as string[];
      const row = this.communications.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'delivered'; row.delivered_at = new Date().toISOString(); row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }
    if (t.startsWith("UPDATE communications SET status='failed'")) {
      const [reason, id, tid, ver] = values as string[];
      const row = this.communications.get(id);
      if (!row || row.tenant_id !== tid || row.version !== Number(ver)) return [] as unknown as T[];
      row.status = 'failed'; row.failed_at = new Date().toISOString(); row.failure_reason = reason; row.version += 1;
      return [{ version: row.version }] as unknown as T[];
    }

    return [] as unknown as T[];
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> { return fn(makeTxClient(this)); }
  async queryOne<T = unknown>(text: string, values?: unknown[]): Promise<T | null> { const rows = await this.query<T>(text, values ?? []); return rows[0] ?? null; }
  async end(): Promise<void> {}
}

// ── M4: CommunicationRow ──────────────────────────────────────────────────────
export interface CommunicationRow {
  id: string; tenant_id: string; channel: string; purpose: string;
  subject_id: string; workflow_id: string | null;
  recipient_type: string; recipient_id: string;
  subject: string; body: string; status: string;
  created_at: string; queued_at: string | null; sent_at: string | null;
  delivered_at: string | null; failed_at: string | null;
  failure_reason: string | null; adapter_used: string | null; version: number;
}
