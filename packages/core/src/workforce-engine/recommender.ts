/**
 * Alara OS — Assignment Recommender
 *
 * Deterministic scoring of workforce members for assignment.
 * No AI. No probabilistic reasoning. Pure weighted scoring.
 *
 * Scoring dimensions (all 0.0–1.0):
 *   skillScore       — does the member have required skills at adequate level?
 *   availabilityScore — is the member available with capacity?
 *   continuityScore  — has this member worked with this subject before?
 *   loadScore        — inverse of current utilization (lower load = higher score)
 *   programScore     — does the member cover the required programs?
 *
 * Composite = weighted average of all dimensions.
 * Disqualification overrides score (at-capacity, on-leave, inactive).
 *
 * Same input always produces same recommendation — deterministic.
 */

import {
  Availability,
  AvailabilityStatus,
  CandidateScore,
  CoverageArea,
  SkillEntry,
  SkillLevel,
  SkillProfile,
  WorkforceRole,
  WorkforceMember,
} from './types';
import { AlaraId } from '../shared/types';

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  skill: 0.30,
  availability: 0.25,
  continuity: 0.20,
  load: 0.15,
  program: 0.10,
};

// ─── Skill level numeric values ───────────────────────────────────────────────

const SKILL_LEVEL_VALUE: Record<SkillLevel, number> = {
  expert:    1.0,
  proficient: 0.8,
  competent: 0.6,
  novice:    0.3,
};

// ─── Disqualifying statuses ───────────────────────────────────────────────────

const DISQUALIFYING_STATUSES = new Set<AvailabilityStatus>(['on_leave', 'offline']);

// ─── Scorer ───────────────────────────────────────────────────────────────────

export interface ScoringInput {
  readonly member: WorkforceMember;
  readonly availability: Availability;
  readonly requiredSkills: readonly string[];
  readonly requiredPrograms: readonly string[];
  readonly requiredRole: WorkforceRole | null;
  readonly priorAssigneeId: AlaraId | null;
}

export function scoreMember(input: ScoringInput): CandidateScore {
  const { member, availability, requiredSkills, requiredPrograms, requiredRole, priorAssigneeId } = input;

  // ── Disqualification checks ────────────────────────────────────────────────

  if (member.status === 'inactive') {
    return disqualified(member, 'Member is inactive');
  }
  if (member.status === 'on_leave') {
    return disqualified(member, 'Member is on leave');
  }
  if (DISQUALIFYING_STATUSES.has(availability.status)) {
    return disqualified(member, `Member availability: ${availability.status}`);
  }
  if (availability.currentLoad >= availability.maxLoad) {
    return disqualified(member, 'Member is at maximum capacity');
  }
  if (requiredRole && member.role !== requiredRole) {
    return disqualified(member, `Required role: ${requiredRole}, member role: ${member.role}`);
  }

  // ── Skill score ────────────────────────────────────────────────────────────

  const skillScore = computeSkillScore(member.skillProfile, requiredSkills);

  // ── Availability score ─────────────────────────────────────────────────────

  const availabilityScore = computeAvailabilityScore(availability);

  // ── Continuity score ───────────────────────────────────────────────────────

  const continuityScore = priorAssigneeId && String(priorAssigneeId) === String(member.id) ? 1.0 : 0.0;

  // ── Load score (inverse utilization) ──────────────────────────────────────

  const utilization = availability.maxLoad > 0 ? availability.currentLoad / availability.maxLoad : 1.0;
  const loadScore = Math.max(0, 1.0 - utilization);

  // ── Program coverage score ─────────────────────────────────────────────────

  const programScore = computeProgramScore(member.coverageArea, requiredPrograms);

  // ── Composite ─────────────────────────────────────────────────────────────

  const totalScore =
    skillScore       * WEIGHTS.skill +
    availabilityScore * WEIGHTS.availability +
    continuityScore  * WEIGHTS.continuity +
    loadScore        * WEIGHTS.load +
    programScore     * WEIGHTS.program;

  return {
    memberId: member.id,
    memberName: member.displayName,
    totalScore: Math.round(totalScore * 1000) / 1000,
    skillScore,
    availabilityScore,
    continuityScore,
    loadScore,
    programScore,
    disqualified: false,
    disqualificationReason: null,
  };
}

function computeSkillScore(profile: SkillProfile, required: readonly string[]): number {
  if (required.length === 0) return 0.5; // no requirement = neutral
  const memberSkills = new Map<string, SkillLevel>();
  for (const s of profile.skills) memberSkills.set(s.skill.toLowerCase(), s.level);

  let total = 0;
  let matched = 0;
  for (const req of required) {
    const level = memberSkills.get(req.toLowerCase());
    if (level) {
      total += SKILL_LEVEL_VALUE[level];
      matched++;
    }
  }
  return required.length > 0 ? total / required.length : 0.5;
}

function computeAvailabilityScore(availability: Availability): number {
  switch (availability.status) {
    case 'available':   return 1.0;
    case 'busy':        return 0.5;
    case 'at_capacity': return 0.0;
    case 'on_leave':    return 0.0;
    case 'offline':     return 0.0;
  }
}

function computeProgramScore(area: CoverageArea, required: readonly string[]): number {
  if (required.length === 0) return 0.5;
  const covered = new Set(area.programCodes.map(p => p.toLowerCase()));
  const matched = required.filter(p => covered.has(p.toLowerCase())).length;
  return matched / required.length;
}

function disqualified(member: WorkforceMember, reason: string): CandidateScore {
  return {
    memberId: member.id,
    memberName: member.displayName,
    totalScore: 0,
    skillScore: 0,
    availabilityScore: 0,
    continuityScore: 0,
    loadScore: 0,
    programScore: 0,
    disqualified: true,
    disqualificationReason: reason,
  };
}

// ─── Rank candidates ──────────────────────────────────────────────────────────

export function rankCandidates(scores: readonly CandidateScore[]): {
  primary: CandidateScore | null;
  alternatives: CandidateScore[];
} {
  const eligible = scores.filter(s => !s.disqualified).sort((a, b) => b.totalScore - a.totalScore);
  if (eligible.length === 0) return { primary: null, alternatives: [] };
  return {
    primary: eligible[0],
    alternatives: eligible.slice(1, 4), // up to 3 alternatives
  };
}
