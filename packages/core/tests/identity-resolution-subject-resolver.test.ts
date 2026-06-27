/**
 * Alara OS — Identity Resolution Phase 4: CanonicalSubjectResolver
 *
 * Proves the merge-aware read primitive (docs/architecture/identity-resolution-spec.md §6.1):
 *   - an unmerged subject resolves to itself (v1 no-op default)
 *   - an unknown subject is handled deterministically (resolves to itself)
 *   - with injected merge-link state, a merged-away id resolves to the survivor
 *   - transitive merge chains resolve to the final survivor
 *   - cyclic links terminate deterministically (no infinite loop)
 *   - resolution performs no mutation (idempotent / read-only)
 */

import {
  CanonicalSubjectResolver,
  NoMergeLinkSource,
  MergeLinkSource,
} from '../src/identity-resolution';

const TENANT = 'tenant-1';

/** A pure in-memory merge-link source for tests: mergedId → survivingId. */
class MapMergeLinkSource implements MergeLinkSource {
  public reads = 0;
  constructor(private readonly links: Record<string, string>) {}
  async getSurvivor(_tenantId: string, mergedId: string): Promise<string | null> {
    this.reads++;
    return this.links[mergedId] ?? null;
  }
}

describe('Identity Resolution — CanonicalSubjectResolver (Phase 4)', () => {
  test('unmerged subject resolves to itself (v1 no-op default)', async () => {
    const resolver = new CanonicalSubjectResolver(new NoMergeLinkSource());
    expect(await resolver.resolveCanonicalSubject(TENANT, 'patient-1')).toBe('patient-1');
  });

  test('default constructor uses the no-op source', async () => {
    const resolver = new CanonicalSubjectResolver();
    expect(await resolver.resolveCanonicalSubject(TENANT, 'patient-x')).toBe('patient-x');
  });

  test('unknown subject is handled deterministically', async () => {
    const resolver = new CanonicalSubjectResolver(new MapMergeLinkSource({}));
    const a = await resolver.resolveCanonicalSubject(TENANT, 'ghost');
    const b = await resolver.resolveCanonicalSubject(TENANT, 'ghost');
    expect(a).toBe('ghost');
    expect(b).toBe('ghost');
  });

  test('merged-away id resolves to the survivor', async () => {
    const resolver = new CanonicalSubjectResolver(new MapMergeLinkSource({ 'merged-1': 'survivor-1' }));
    expect(await resolver.resolveCanonicalSubject(TENANT, 'merged-1')).toBe('survivor-1');
    // the survivor itself resolves to itself
    expect(await resolver.resolveCanonicalSubject(TENANT, 'survivor-1')).toBe('survivor-1');
  });

  test('transitive merge chain resolves to the final survivor', async () => {
    const resolver = new CanonicalSubjectResolver(
      new MapMergeLinkSource({ m1: 'm2', m2: 'm3', m3: 'survivor' }),
    );
    expect(await resolver.resolveCanonicalSubject(TENANT, 'm1')).toBe('survivor');
  });

  test('cyclic links terminate deterministically (no infinite loop)', async () => {
    const resolver = new CanonicalSubjectResolver(
      new MapMergeLinkSource({ a: 'b', b: 'a' }),
    );
    const r = await resolver.resolveCanonicalSubject(TENANT, 'a');
    expect(['a', 'b']).toContain(r);
    // deterministic across calls
    expect(await resolver.resolveCanonicalSubject(TENANT, 'a')).toBe(r);
  });

  test('resolution is read-only — repeated calls are idempotent', async () => {
    const source = new MapMergeLinkSource({ m1: 'survivor-1' });
    const resolver = new CanonicalSubjectResolver(source);
    const a = await resolver.resolveCanonicalSubject(TENANT, 'm1');
    const b = await resolver.resolveCanonicalSubject(TENANT, 'm1');
    expect(a).toBe(b);
    expect(a).toBe('survivor-1');
  });
});
