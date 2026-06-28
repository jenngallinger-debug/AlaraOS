/**
 * Alara OS API — JWKS runtime wiring (process singleton + fetch adapter + warm)
 *
 * Wires the pure `JwksCache` (jwks.ts) into runtime token verification behind `AUTH_JWKS_URL`.
 * Keeps the verification HOT PATH SYNCHRONOUS: `getJwksResolver()` returns the cache's synchronous
 * resolver and only kicks a fire-and-forget refresh (never awaited). The Node `fetch` adapter is
 * the sole real I/O in the JWKS feature; it is dependency-free (global `fetch` + `AbortSignal`).
 *
 * Tests inject a fake fetcher via `configureJwksForTests` — no real network is ever used.
 */

import { JwksCache, JwksFetcher } from './jwks';
import type { KeyResolver } from './jwt';
import { getAuthJwksUrl, getAuthJwksCacheTtlSec, getAuthJwksTimeoutMs } from './config';

/** Bounded-timeout JWKS fetch over Node's global `fetch` (no dependency). Throws on timeout/non-2xx. */
export async function fetchJwks(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`jwks fetch failed: HTTP ${res.status}`);
  return res.json();
}

interface JwksTestConfig {
  readonly fetcher?: JwksFetcher;
  readonly ttlMs?: number;
  readonly minRefreshIntervalMs?: number;
  readonly now?: () => number;
}

let testConfig: JwksTestConfig | undefined;
let cache: JwksCache | undefined;
let cacheUrl: string | undefined;

/**
 * TEST ONLY: inject a fake fetcher (and optional timing/clock) and reset the singleton. Pass
 * `undefined` to clear the override. Keeps tests off the network and deterministic.
 */
export function configureJwksForTests(cfg: JwksTestConfig | undefined): void {
  testConfig = cfg;
  cache = undefined;
  cacheUrl = undefined;
}

/** Get (or lazily build) the process-singleton cache for `url`. */
function getCache(url: string): JwksCache {
  if (!cache || cacheUrl !== url) {
    const fetcher: JwksFetcher = testConfig?.fetcher ?? ((u) => fetchJwks(u, getAuthJwksTimeoutMs()));
    cache = new JwksCache({
      url,
      fetcher,
      ttlMs: testConfig?.ttlMs ?? getAuthJwksCacheTtlSec() * 1000,
      minRefreshIntervalMs: testConfig?.minRefreshIntervalMs,
      now: testConfig?.now,
    });
    cacheUrl = url;
  }
  return cache;
}

/**
 * The JWKS-backed key resolver when `AUTH_JWKS_URL` is set, else `undefined` (caller falls back to
 * the static key). Kicks a fire-and-forget refresh to keep the cache warm under traffic — NEVER
 * awaited, so the caller's hot path stays synchronous. A cold cache resolves to `undefined` per
 * `kid` (→ verifier fails closed) until a refresh completes.
 */
export function getJwksResolver(): KeyResolver | undefined {
  const url = getAuthJwksUrl();
  if (!url) return undefined;
  const c = getCache(url);
  void c.maybeRefresh().catch(() => {}); // non-blocking warm; never throws into the hot path
  return c.resolver();
}

/**
 * Non-blocking startup warm. No-op when `AUTH_JWKS_URL` is unset. Never rejects; returns the
 * promise so tests can `await` it for determinism while the server fires it and ignores the result.
 */
export function warmJwks(): Promise<void> {
  const url = getAuthJwksUrl();
  if (!url) return Promise.resolve();
  return getCache(url).maybeRefresh().catch(() => {});
}
