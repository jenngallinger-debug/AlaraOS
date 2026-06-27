/**
 * Alara OS — Canonical Subject Resolver (Phase 4)
 *
 * The merge-aware read primitive (docs/architecture/identity-resolution-spec.md §6.1):
 * v1 propagates a merge by READING, not rewriting. Every subject-keyed read resolves
 * its `subjectId` to the canonical survivor first, so a read for a merged-away id reaches
 * the survivor's data — nothing is physically re-pointed across stores.
 *
 * This resolver is READ-ONLY and deterministic. It follows merge links transitively
 * (mergedA → mergedB → survivor) with a cycle guard. The links come from an injected
 * `MergeLinkSource`:
 *   - v1 default `NoMergeLinkSource`: no merges recorded yet → every subject resolves to
 *     itself (a faithful no-op of current behavior);
 *   - Phase 5 will supply an event-backed source reading `PersonMerged` links.
 */

/** Supplies the direct survivor for a merged-away id (mergedId → survivingId). */
export interface MergeLinkSource {
  /** The direct survivor for a merged-away id, or null if it has not been merged. */
  getSurvivor(tenantId: string, mergedId: string): Promise<string | null>;
}

/** Default v1 source: no merges → every subject is its own canonical survivor. */
export class NoMergeLinkSource implements MergeLinkSource {
  async getSurvivor(): Promise<string | null> {
    return null;
  }
}

export class CanonicalSubjectResolver {
  constructor(private readonly links: MergeLinkSource = new NoMergeLinkSource()) {}

  /**
   * Resolve a subjectId to its canonical survivor, following merge links transitively.
   * Read-only. An unmerged or unknown subject resolves to itself. A cyclic link set
   * terminates deterministically (returns the last id before the cycle would repeat).
   */
  async resolveCanonicalSubject(tenantId: string, subjectId: string): Promise<string> {
    let current = subjectId;
    const seen = new Set<string>([current]);
    for (;;) {
      const next = await this.links.getSurvivor(tenantId, current);
      if (!next || next === current) return current;
      if (seen.has(next)) return current; // cycle guard → deterministic stop
      seen.add(next);
      current = next;
    }
  }
}
