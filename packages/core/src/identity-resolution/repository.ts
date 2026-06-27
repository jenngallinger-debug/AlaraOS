/**
 * Alara OS — Identity Resolution Repository (Phase 1: external-reference lookup)
 *
 * Read-only candidate lookup for Identity Resolution
 * (docs/architecture/identity-resolution-spec.md §4.1, §9, §12 phase 1).
 *
 * v1 scope — STRICTLY:
 *   - external-reference-first: the only candidate signal in v1 is an EXACT external
 *     reference, resolved via the existing ObjectGraphRepository.findByExternalReference;
 *   - Patient-only: "Person" maps to the existing `Patient` object type;
 *   - read-only: this performs NO create, NO merge, NO write of any kind;
 *   - no demographic matching (deferred until a safe candidate-query/index exists).
 *
 * External references are EVIDENCE, not identity: this returns Alara `Patient` objects
 * (each with its canonical Alara UUID), never external records, and the external id is
 * never treated as the object's identity.
 */

import { DatabaseClient } from '../shared/database';
import { ObjectGraphRepository } from '../object-graph/repository';
import { AlaraObject } from '../shared/types';

const PATIENT_TYPE = 'Patient';

/** An exact external reference to look a candidate up by. */
export interface ExternalReferenceQuery {
  system: string;
  extType: string;
  value: string;
}

export class IdentityResolutionRepository {
  private readonly graph: ObjectGraphRepository;

  constructor(db: DatabaseClient) {
    this.graph = new ObjectGraphRepository(db);
  }

  /**
   * Find candidate `Patient` object(s) by an EXACT external reference.
   *
   * Read-only, Patient-only, deterministic. Returns the matching Patients ordered by
   * their Alara id so repeated calls yield a stable candidate ordering (the basis for
   * deterministic classification in later phases). Non-Patient objects that happen to
   * share the same external reference are excluded — an external id shared across object
   * types never resolves a Patient by that fact alone.
   */
  async findPatientsByExternalReference(
    tenantId: string,
    ref: ExternalReferenceQuery,
  ): Promise<AlaraObject[]> {
    const objects = await this.graph.findByExternalReference(
      tenantId,
      ref.system,
      ref.extType,
      ref.value,
    );
    return objects
      .filter((o) => o.type === PATIENT_TYPE)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
