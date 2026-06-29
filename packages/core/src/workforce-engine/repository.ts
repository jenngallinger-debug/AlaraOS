/**
 * Alara OS — Workforce Engine Repository
 *
 * Read layer for workforce objects.
 * All writes go through WorkforceEngine (event-sourced).
 */

import { DatabaseClient } from '../shared/database';
import { withTenantTransaction } from '../shared/tenant-scope';
import { AlaraId } from '../shared/types';
import {
  Assignment,
  AssignmentConfidence,
  AssignmentEvidence,
  AssignmentPriority,
  AssignmentStatus,
  Availability,
  AvailabilityStatus,
  CapacitySnapshot,
  CoverageArea,
  SkillProfile,
  Team,
  WorkforceMember,
  WorkforceMemberStatus,
  WorkforceRole,
} from './types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface MemberRow {
  id: string; tenant_id: string; display_name: string; role: string;
  status: string; team_id: string | null; supervisor_id: string | null;
  external_hr_id: string | null; skill_profile: unknown; coverage_area: unknown;
  escalation_path_id: string | null; created_at: string; updated_at: string; version: number;
}

interface AvailabilityRow {
  member_id: string; tenant_id: string; status: string;
  current_load: number; max_load: number; next_available_at: string | null;
  unavailable_until: string | null; snapshot_at: string;
}

interface AssignmentRow {
  id: string; tenant_id: string; subject_id: string; subject_type: string;
  assignee_id: string; assignee_name: string; priority: string; status: string;
  reason: string; evidence: unknown; confidence: string;
  transferred_from_id: string | null;
  rules_engine_approved: boolean | null; rules_engine_explanation: string | null;
  due_at: string | null; accepted_at: string | null; completed_at: string | null;
  created_at: string; version: number;
}

interface CapacityRow {
  id: string; tenant_id: string; member_id: string; current_load: number;
  max_load: number; utilization_rate: number; active_assignment_ids: string[];
  snapshot_at: string; version: number;
}

interface TeamRow {
  id: string; tenant_id: string; name: string; description: string;
  lead_id: string | null; member_ids: string[]; specializations: string[];
  created_at: string; version: number;
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToMember(row: MemberRow): WorkforceMember {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, displayName: row.display_name,
    role: row.role as WorkforceRole, status: row.status as WorkforceMemberStatus,
    teamId: row.team_id as AlaraId | null, supervisorId: row.supervisor_id as AlaraId | null,
    externalHrId: row.external_hr_id,
    skillProfile: row.skill_profile as SkillProfile,
    coverageArea: row.coverage_area as CoverageArea,
    escalationPathId: row.escalation_path_id as AlaraId | null,
    createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
    version: row.version,
  };
}

function rowToAvailability(row: AvailabilityRow): Availability {
  return {
    memberId: row.member_id as AlaraId, tenantId: row.tenant_id,
    status: row.status as AvailabilityStatus,
    currentLoad: row.current_load, maxLoad: row.max_load,
    nextAvailableAt: row.next_available_at, unavailableUntil: row.unavailable_until,
    snapshotAt: row.snapshot_at,
  };
}

function rowToAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id,
    subjectId: row.subject_id, subjectType: row.subject_type,
    assigneeId: row.assignee_id as AlaraId, assigneeName: row.assignee_name,
    priority: row.priority as AssignmentPriority, status: row.status as AssignmentStatus,
    reason: row.reason, evidence: row.evidence as AssignmentEvidence,
    confidence: row.confidence as AssignmentConfidence,
    transferredFromId: row.transferred_from_id as AlaraId | null,
    rulesEngineApproved: row.rules_engine_approved,
    rulesEngineExplanation: row.rules_engine_explanation,
    dueAt: row.due_at ? new Date(row.due_at) : null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    createdAt: new Date(row.created_at), version: row.version,
  };
}

function rowToCapacity(row: CapacityRow): CapacitySnapshot {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, memberId: row.member_id as AlaraId,
    currentLoad: row.current_load, maxLoad: row.max_load,
    utilizationRate: row.utilization_rate,
    activeAssignmentIds: row.active_assignment_ids ?? [],
    snapshotAt: new Date(row.snapshot_at), version: row.version,
  };
}

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id as AlaraId, tenantId: row.tenant_id, name: row.name,
    description: row.description, leadId: row.lead_id as AlaraId | null,
    memberIds: (row.member_ids ?? []) as AlaraId[],
    specializations: row.specializations ?? [],
    createdAt: new Date(row.created_at), version: row.version,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class WorkforceRepository {
  constructor(private readonly db: DatabaseClient) {}

  // ── Members ───────────────────────────────────────────────────────────────

  // RLS step 2 (Batch A): single-statement, tenant-filtered reads run inside a tenant-scoped
  // transaction (carries `app.tenant_id`). Behavior-preserving today (RLS inert → same rows);
  // identical SQL/params/ordering/mapping. `getAvailabilityForMembers` aggregate is deferred.
  async getMemberById(tenantId: string, id: AlaraId): Promise<WorkforceMember | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<MemberRow>(
        `SELECT * FROM workforce_members WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToMember(row) : null;
    });
  }

  async getActiveMembersForTenant(tenantId: string, role?: WorkforceRole): Promise<WorkforceMember[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      if (role) {
        const r = await client.query<MemberRow>(
          `SELECT * FROM workforce_members WHERE tenant_id = $1 AND status = 'active' AND role = $2 ORDER BY display_name`,
          [tenantId, role],
        );
        return r.rows.map(rowToMember);
      }
      const r = await client.query<MemberRow>(
        `SELECT * FROM workforce_members WHERE tenant_id = $1 AND status = 'active' ORDER BY display_name`,
        [tenantId],
      );
      return r.rows.map(rowToMember);
    });
  }

  async getAllMembersForTenant(tenantId: string): Promise<WorkforceMember[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<MemberRow>(
        `SELECT * FROM workforce_members WHERE tenant_id = $1 ORDER BY display_name`,
        [tenantId],
      );
      return r.rows.map(rowToMember);
    });
  }

  // ── Availability ──────────────────────────────────────────────────────────

  async getAvailability(tenantId: string, memberId: AlaraId): Promise<Availability | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<AvailabilityRow>(
        `SELECT * FROM workforce_availability WHERE member_id = $1 AND tenant_id = $2`,
        [memberId, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToAvailability(row) : null;
    });
  }

  async getAvailabilityForMembers(tenantId: string, memberIds: readonly AlaraId[]): Promise<Map<string, Availability>> {
    const map = new Map<string, Availability>();
    for (const id of memberIds) {
      const avail = await this.getAvailability(tenantId, id);
      if (avail) map.set(String(id), avail);
    }
    return map;
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async getAssignmentById(tenantId: string, id: AlaraId): Promise<Assignment | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<AssignmentRow>(
        `SELECT * FROM assignments WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToAssignment(row) : null;
    });
  }

  async getAssignmentsForSubject(tenantId: string, subjectId: string): Promise<Assignment[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<AssignmentRow>(
        `SELECT * FROM assignments WHERE tenant_id = $1 AND subject_id = $2 ORDER BY created_at DESC`,
        [tenantId, subjectId],
      );
      return r.rows.map(rowToAssignment);
    });
  }

  async getActiveAssignmentsForMember(tenantId: string, memberId: AlaraId): Promise<Assignment[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<AssignmentRow>(
        `SELECT * FROM assignments WHERE tenant_id = $1 AND assignee_id = $2 AND status IN ('approved','accepted') ORDER BY created_at DESC`,
        [tenantId, memberId],
      );
      return r.rows.map(rowToAssignment);
    });
  }

  // ── Capacity ──────────────────────────────────────────────────────────────

  async getLatestCapacity(tenantId: string, memberId: AlaraId): Promise<CapacitySnapshot | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<CapacityRow>(
        `SELECT * FROM capacity_snapshots WHERE tenant_id = $1 AND member_id = $2 ORDER BY snapshot_at DESC LIMIT 1`,
        [tenantId, memberId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToCapacity(row) : null;
    });
  }

  // ── Teams ─────────────────────────────────────────────────────────────────

  async getTeamById(tenantId: string, id: AlaraId): Promise<Team | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<TeamRow>(
        `SELECT * FROM workforce_teams WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = r.rows[0] ?? null;
      return row ? rowToTeam(row) : null;
    });
  }
}
