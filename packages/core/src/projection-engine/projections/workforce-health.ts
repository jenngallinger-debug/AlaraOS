/**
 * Alara OS — Workforce Health Projection (ADR-016)
 *
 * A computed, non-authoritative summary of workforce capacity,
 * assignment distribution, and coordination health.
 *
 * "Discarding this projection loses no truth."
 *
 * ADR-016: methodVersion, canonicalInputs, confidence, aiInvolved all declared.
 * aiInvolved is always false — WorkforceEngine is fully deterministic.
 */

import {
  ConfidenceLevel,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
  ProjectionType,
} from '../types';
import { Assignment, Availability, WorkforceMember, WorkforceRole } from '../../workforce-engine/types';

// ─── Input type ───────────────────────────────────────────────────────────────

export interface WorkforceHealthInput {
  readonly tenantId: string;
  readonly members: readonly WorkforceMember[];
  readonly availabilities: readonly Availability[];
  readonly activeAssignments: readonly Assignment[];
}

// ─── Value type ───────────────────────────────────────────────────────────────

export interface MemberLoadSummary {
  readonly memberId: string;
  readonly displayName: string;
  readonly role: WorkforceRole;
  readonly currentLoad: number;
  readonly maxLoad: number;
  readonly utilizationRate: number;
  readonly status: string;
}

export interface WorkforceHealthValue {
  readonly tenantId: string;
  readonly totalActiveMembers: number;
  readonly totalAvailableMembers: number;
  readonly totalAtCapacity: number;
  readonly totalOnLeave: number;
  readonly totalActiveAssignments: number;
  readonly averageUtilization: number; // 0.0–1.0
  readonly membersByRole: Record<WorkforceRole, number>;
  readonly overloadedMembers: readonly MemberLoadSummary[];
  readonly availableMembers: readonly MemberLoadSummary[];
  readonly healthScore: number; // 0.0–1.0
  readonly coordinationRisk: 'critical' | 'high' | 'medium' | 'low' | 'none';
  readonly disclaimer: 'computed-projection-advisory-only';
}

// ─── Projection definition ─────────────────────────────────────────────────────

export const WorkforceHealthProjectionDefinition: ProjectionDefinition<
  WorkforceHealthInput,
  WorkforceHealthValue
> = {
  type: 'WorkforceHealth' as ProjectionType,
  methodName: 'workforce-health',
  methodVersion: '1.0.0',

  declareDependencies(subjectId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Workforce members', kind: 'object', sourceId: `${subjectId}::workforce_members` },
      { name: 'Availability snapshots', kind: 'object', sourceId: `${subjectId}::workforce_availability` },
      { name: 'Active assignments', kind: 'object', sourceId: `${subjectId}::assignments` },
    ];
  },

  build(input: WorkforceHealthInput): ProjectionBuildResult<WorkforceHealthValue> {
    const activeMembers = input.members.filter(m => m.status === 'active');
    const availMap = new Map(input.availabilities.map(a => [String(a.memberId), a]));

    // Member summary
    const memberSummaries: MemberLoadSummary[] = activeMembers.map(m => {
      const avail = availMap.get(String(m.id));
      const load = avail?.currentLoad ?? 0;
      const max = avail?.maxLoad ?? 10;
      return {
        memberId: String(m.id),
        displayName: m.displayName,
        role: m.role,
        currentLoad: load,
        maxLoad: max,
        utilizationRate: max > 0 ? Math.round((load / max) * 100) / 100 : 0,
        status: avail?.status ?? 'available',
      };
    });

    // Counts
    const totalAvailable = memberSummaries.filter(m => m.status === 'available' && m.utilizationRate < 0.8).length;
    const totalAtCapacity = memberSummaries.filter(m => m.utilizationRate >= 1.0 || m.status === 'at_capacity').length;
    const totalOnLeave = input.members.filter(m => m.status === 'on_leave').length;

    // Average utilization across active members with availability data
    const withAvail = memberSummaries.filter(m => availMap.has(m.memberId));
    const avgUtilization = withAvail.length > 0
      ? withAvail.reduce((sum, m) => sum + m.utilizationRate, 0) / withAvail.length
      : 0;

    // Overloaded and available
    const overloaded = memberSummaries.filter(m => m.utilizationRate >= 0.9);
    const available = memberSummaries.filter(m => m.utilizationRate < 0.6 && m.status === 'available');

    // By role
    const allRoles: WorkforceRole[] = ['care_guide', 'clinical_coordinator', 'intake_specialist', 'scheduler', 'quality_reviewer', 'supervisor', 'administrator'];
    const byRole = {} as Record<WorkforceRole, number>;
    for (const role of allRoles) byRole[role] = 0;
    for (const m of activeMembers) byRole[m.role] = (byRole[m.role] ?? 0) + 1;

    // Health score
    const overloadPenalty = overloaded.length / Math.max(activeMembers.length, 1);
    const capacityPenalty = totalAtCapacity / Math.max(activeMembers.length, 1);
    const healthScore = Math.max(0, Math.min(1, 1 - overloadPenalty * 0.5 - capacityPenalty * 0.3));

    // Coordination risk
    const coordinationRisk: WorkforceHealthValue['coordinationRisk'] =
      totalAvailable === 0 ? 'critical' :
      avgUtilization >= 0.9 ? 'high' :
      avgUtilization >= 0.7 ? 'medium' :
      avgUtilization >= 0.4 ? 'low' : 'none';

    const overallConfidence: ConfidenceLevel =
      activeMembers.length >= 5 ? 'high' :
      activeMembers.length >= 2 ? 'moderate' : 'low';

    return {
      value: {
        tenantId: input.tenantId,
        totalActiveMembers: activeMembers.length,
        totalAvailableMembers: totalAvailable,
        totalAtCapacity,
        totalOnLeave,
        totalActiveAssignments: input.activeAssignments.length,
        averageUtilization: Math.round(avgUtilization * 100) / 100,
        membersByRole: byRole,
        overloadedMembers: overloaded,
        availableMembers: available,
        healthScore: Math.round(healthScore * 100) / 100,
        coordinationRisk,
        disclaimer: 'computed-projection-advisory-only',
      },
      confidence: overallConfidence,
      inferenceBasis: 'inference',
      aiInvolved: false,
      sourceEventIds: [
        ...input.members.map(m => String(m.id)),
        ...input.activeAssignments.map(a => String(a.id)),
      ],
      freshUntil: null,
    };
  },
};
