/**
 * Alara OS — Identity Resolution Engine (Phase 2: deterministic matcher)
 *
 * Classifies a person-bearing input into one of the four outcomes
 * (docs/architecture/identity-resolution-spec.md §4):
 *   MATCH / NO_MATCH / POSSIBLE_MATCH_REVIEW_REQUIRED / INSUFFICIENT_EVIDENCE
 *
 * v1 rules (spec §4.1) — STRICTLY deterministic, external-reference-first:
 *   - exact external reference resolving to exactly one Patient, with no conflicting
 *     evidence → MATCH;
 *   - exact external reference resolving to MULTIPLE Patients (id collision), or
 *     different references resolving to different Patients, or an external-ref match
 *     whose demographics conflict → POSSIBLE_MATCH_REVIEW_REQUIRED;
 *   - identifying evidence present but no external-reference candidate → NO_MATCH
 *     (safe to create a new Patient);
 *   - too little input to even create safely → INSUFFICIENT_EVIDENCE.
 *
 * NO demographic auto-match: demographics never produce a MATCH; they only downgrade a
 * match to review when they conflict. This engine is READ-ONLY — it classifies and
 * returns the matched id; it never creates, merges, or writes.
 */

import { AlaraObject } from '../shared/types';
import { IdentityResolutionRepository } from './repository';
import {
  IdentityCandidateInput,
  IdentityConflict,
  IdentityResolutionResult,
} from './types';

export class IdentityResolutionEngine {
  constructor(private readonly repo: IdentityResolutionRepository) {}

  async resolve(input: IdentityCandidateInput): Promise<IdentityResolutionResult> {
    const refs = (input.externalReferences ?? []).filter(
      (r) => r && r.system && r.extType && r.value,
    );
    const hasRef = refs.length > 0;
    const hasName = !!input.name && input.name.trim().length > 0;

    // Gather candidate Patients across all external references, de-duplicated by id,
    // in deterministic order (repository sorts by Alara id).
    const byId = new Map<string, AlaraObject>();
    for (const ref of refs) {
      const found = await this.repo.findPatientsByExternalReference(input.tenantId, ref);
      for (const o of found) byId.set(String(o.id), o);
    }
    const candidates = Array.from(byId.values()).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const candidateIds = candidates.map((o) => String(o.id));

    // No candidate found.
    if (candidates.length === 0) {
      if (!hasRef && !hasName) {
        return result('INSUFFICIENT_EVIDENCE', candidateIds, ['no_identifying_evidence']);
      }
      return result('NO_MATCH', candidateIds, ['no_external_reference_match']);
    }

    // Multiple distinct candidates → ambiguous identity, human review (spec §5).
    if (candidates.length > 1) {
      const conflicts: IdentityConflict[] = candidates.map((c) => ({
        candidateId: String(c.id),
        field: 'externalReference',
        inputValue: refs.map((r) => `${r.system}:${r.extType}:${r.value}`).join(','),
        candidateValue: String(c.id),
        code: 'ID_COLLISION',
      }));
      return result('POSSIBLE_MATCH_REVIEW_REQUIRED', candidateIds, ['multiple_candidates'], conflicts);
    }

    // Exactly one candidate — check for conflicting demographic evidence.
    const candidate = candidates[0];
    const conflicts = detectConflicts(input, candidate);
    if (conflicts.length > 0) {
      return result(
        'POSSIBLE_MATCH_REVIEW_REQUIRED',
        candidateIds,
        ['conflicting_evidence', ...conflicts.map((c) => c.code.toLowerCase())],
        conflicts,
      );
    }

    // Clean, single, exact external-reference match.
    return {
      outcome: 'MATCH',
      matchedPatientId: String(candidate.id),
      candidateIds,
      reasonCodes: ['exact_external_reference'],
      conflicts: [],
    };
  }
}

/** Compare provided demographic evidence against a candidate Patient's attributes. */
function detectConflicts(input: IdentityCandidateInput, candidate: AlaraObject): IdentityConflict[] {
  const conflicts: IdentityConflict[] = [];
  const attrs = candidate.attributes ?? {};
  if (input.dob && attrs['dob'] && String(input.dob) !== String(attrs['dob'])) {
    conflicts.push({
      candidateId: String(candidate.id),
      field: 'dob',
      inputValue: input.dob,
      candidateValue: attrs['dob'],
      code: 'DOB_MISMATCH',
    });
  }
  return conflicts;
}

function result(
  outcome: IdentityResolutionResult['outcome'],
  candidateIds: string[],
  reasonCodes: string[],
  conflicts: IdentityConflict[] = [],
): IdentityResolutionResult {
  return { outcome, candidateIds, reasonCodes, conflicts };
}
