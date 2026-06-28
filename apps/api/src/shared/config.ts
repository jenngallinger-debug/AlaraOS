/**
 * Alara OS API - minimal env-based config for the auth boundary
 *
 * NOT a secrets manager. Reads `process.env`, matching the existing apps/api pattern
 * (`process.env.NODE_ENV`). These knobs back the transport-auth boundary only.
 */

import { createHash } from 'crypto';

/**
 * Actors permitted to use privileged command surfaces (e.g. raw event append at
 * `/commands/events`). Configurable via `ALARA_SYSTEM_ACTORS` (comma-separated);
 * defaults to `system` for dev/test.
 */
export function getSystemActors(): Set<string> {
  const raw = (process.env.ALARA_SYSTEM_ACTORS ?? 'system').trim();
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
}

export function isSystemActor(actor: string): boolean {
  return getSystemActors().has(actor);
}

/**
 * Whether the raw event-append command surface (`POST /commands/events`) is mounted.
 *
 * Raw append is the most privileged write surface (any canonical event onto any stream),
 * and the `x-actor-id` system-actor gate is only an MVP transport check — a spoofed
 * `system` header would unlock it. So we fail closed: the surface is OFF by default and
 * only ON when explicitly opted in, or implicitly under `NODE_ENV=test` (where the AC-3
 * suite exercises it). `ALLOW_RAW_EVENT_COMMAND` (true/false/1/0) overrides either way,
 * including the escape hatch to enable it in dev/prod when an operator accepts the risk.
 */
export function isRawEventCommandEnabled(): boolean {
  const raw = (process.env.ALLOW_RAW_EVENT_COMMAND ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return process.env.NODE_ENV === 'test';
}

/** Header carrying the Automynd webhook shared secret (MVP boundary; see auth.ts). */
export const AUTOMYND_SECRET_HEADER = 'x-automynd-secret';

/** Header carrying the webhook idempotency key (one logical delivery = one key). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * The configured Automynd webhook secret, or `undefined` when not configured.
 * When undefined, the webhook fails closed (rejects all requests).
 */
export function getAutomyndWebhookSecret(): string | undefined {
  const s = (process.env.AUTOMYND_WEBHOOK_SECRET ?? '').trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Derive a stable, UUID-shaped event id from its parts (a deterministic v5-style id).
 * Same parts produce the same id, so the Event Store's idempotency-by-id makes a
 * replayed webhook a no-op. Uses Node `crypto` (no extra dependency). The parts are
 * JSON-encoded before hashing so they cannot ambiguously concatenate. NOT a payload
 * hash - the parts are tenant + source + idempotency key, so a reused key maps to one
 * id regardless of payload (a changed payload under the same key is detected as a
 * conflict by the caller).
 */
export function deterministicEventId(...parts: string[]): string {
  const h = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32).split('');
  h[12] = '5';                                               // version 5
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);  // RFC4122 variant
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// ─── Rate limiting (basic, in-memory, process-local) ──────────────────────────

/**
 * Whether the basic rate limiter is active. `RATE_LIMIT_ENABLED` (true/false/1/0)
 * overrides; otherwise it defaults ON outside tests and OFF under `NODE_ENV=test`
 * (so existing API tests are unaffected unless they opt in).
 */
export function isRateLimitEnabled(): boolean {
  const raw = (process.env.RATE_LIMIT_ENABLED ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return process.env.NODE_ENV !== 'test';
}

/** Rate-limit window in ms (default 60s). */
export function getRateLimitWindowMs(): number {
  const n = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** Max requests per key per window (default 100). */
export function getRateLimitMax(): number {
  const n = Number(process.env.RATE_LIMIT_MAX);
  return Number.isFinite(n) && n > 0 ? n : 100;
}
