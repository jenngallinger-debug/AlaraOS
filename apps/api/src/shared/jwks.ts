/**
 * Alara OS API — JWKS key cache (dependency-free, INJECTABLE, UNWIRED)
 *
 * Implements JWKS slice 2 (docs/architecture/jwks-resolver.md): fetch a JWKS, parse RSA public
 * JWKs into `KeyObject`s, cache them by `kid`, and expose a SYNCHRONOUS resolver
 * `(kid?) => KeyObject | undefined` that the existing `verifyJwt` (UPDATE 34) can consume.
 *
 * Design (see packet §4–§7):
 *   - Synchronous `resolve()` reads the in-memory cache — never the network. Async `refresh()`
 *     populates it. This is what keeps the verification hot-path synchronous when wired later.
 *   - The fetcher is INJECTED (`(url) => Promise<unknown>`), so tests use a fake — no real
 *     network here, and the production `fetch` adapter is the wiring slice's concern.
 *   - TTL staleness, a min-interval refresh throttle (anti-storm), and last-known-good on failure.
 *
 * This module is NOT imported by auth.ts — wiring it behind `AUTH_JWKS_URL` is JWKS slice 3.
 * Dependency-free: Node `crypto` only (no `jwks-rsa`/`jose`).
 */

import { createPublicKey, KeyObject } from 'crypto';
import type { KeyResolver } from './jwt';

/** An injected async fetcher: given the JWKS URL, return the parsed JWKS JSON (or throw). */
export type JwksFetcher = (url: string) => Promise<unknown>;

export interface JwksCacheOptions {
  readonly url: string;
  readonly fetcher: JwksFetcher;
  /** Cache freshness window (ms). After this, `maybeRefresh()` will fetch. Default 600_000 (10m). */
  readonly ttlMs?: number;
  /** Minimum interval (ms) between fetch ATTEMPTS — throttles unknown-`kid` storms. Default 30_000. */
  readonly minRefreshIntervalMs?: number;
  /** Injectable clock (ms) for deterministic tests. Default `Date.now`. */
  readonly now?: () => number;
}

/** Minimal RSA-signing JWK shape we accept. */
interface RsaJwk {
  kty?: unknown; kid?: unknown; use?: unknown; alg?: unknown; n?: unknown; e?: unknown;
}

/**
 * Parse a JWKS document into `Map<kid, KeyObject>`. Returns `undefined` for a MALFORMED document
 * (not a `{ keys: [...] }` object) — the caller keeps last-known-good. A well-formed document with
 * no usable keys yields an empty map. Non-RSA / non-signing / non-RS256 / keyless / unparseable
 * entries are skipped.
 */
export function parseJwks(raw: unknown): Map<string, KeyObject> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const keysArr = (raw as { keys?: unknown }).keys;
  if (!Array.isArray(keysArr)) return undefined;

  const out = new Map<string, KeyObject>();
  for (const entry of keysArr) {
    if (!entry || typeof entry !== 'object') continue;
    const jwk = entry as RsaJwk;
    if (jwk.kty !== 'RSA') continue;                                  // RSA only
    if (jwk.use !== undefined && jwk.use !== 'sig') continue;         // signing keys only (if stated)
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;       // RS256 only (if stated)
    if (typeof jwk.kid !== 'string' || jwk.kid.length === 0) continue; // need a kid to index by
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue; // RSA params required
    try {
      // `format: 'jwk'` import — cast to the createPublicKey input type (avoids depending on the
      // DOM-lib `JsonWebKey` global, which this tsconfig does not expose).
      const key = createPublicKey({ key: entry, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0]);
      if (key.asymmetricKeyType === 'rsa') out.set(jwk.kid, key);
    } catch {
      continue; // unparseable JWK → skip (fail safe)
    }
  }
  return out;
}

export class JwksCache {
  private keys = new Map<string, KeyObject>();
  private lastSuccessAt = Number.NEGATIVE_INFINITY; // for TTL staleness
  private lastAttemptAt = Number.NEGATIVE_INFINITY;  // for the min-interval throttle
  private readonly url: string;
  private readonly fetcher: JwksFetcher;
  private readonly ttlMs: number;
  private readonly minRefreshIntervalMs: number;
  private readonly now: () => number;

  constructor(opts: JwksCacheOptions) {
    this.url = opts.url;
    this.fetcher = opts.fetcher;
    this.ttlMs = opts.ttlMs ?? 600_000;
    this.minRefreshIntervalMs = opts.minRefreshIntervalMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Number of cached keys (diagnostics/tests). */
  size(): number {
    return this.keys.size;
  }

  /**
   * SYNCHRONOUS key resolution. With a `kid`, return that key (or undefined). Without a `kid`,
   * return the sole key when the cache holds exactly one (else undefined — ambiguous/empty).
   */
  resolve(kid?: string): KeyObject | undefined {
    if (kid !== undefined) return this.keys.get(kid);
    if (this.keys.size === 1) return this.keys.values().next().value;
    return undefined;
  }

  /** A `KeyResolver`-compatible bound function for `verifyJwt`. */
  resolver(): KeyResolver {
    return (kid) => this.resolve(kid);
  }

  /** True when the cache is empty or older than the TTL. */
  private isStale(): boolean {
    return this.keys.size === 0 || (this.now() - this.lastSuccessAt) >= this.ttlMs;
  }

  /** Refresh only when stale (and not throttled). Safe: never throws. */
  async maybeRefresh(): Promise<void> {
    if (this.isStale()) await this.refresh();
  }

  /**
   * Fetch the JWKS and atomically replace the cache. Subject to the min-interval throttle (so a
   * flood of unknown-`kid` requests cannot stampede the endpoint). NEVER throws and preserves
   * last-known-good when the fetch fails, the document is malformed, or it yields no usable keys.
   */
  async refresh(): Promise<void> {
    const t = this.now();
    if (t - this.lastAttemptAt < this.minRefreshIntervalMs) return; // throttled
    this.lastAttemptAt = t;

    let raw: unknown;
    try {
      raw = await this.fetcher(this.url);
    } catch {
      return; // fetch failed → keep last-known-good
    }
    const parsed = parseJwks(raw);
    if (parsed === undefined || parsed.size === 0) return; // malformed / empty → keep last-known-good
    this.keys = parsed;                  // atomic swap
    this.lastSuccessAt = this.now();
  }
}
