/**
 * Alara OS API — minimal env-based config for the auth boundary
 *
 * NOT a secrets manager. Reads `process.env`, matching the existing apps/api pattern
 * (`process.env.NODE_ENV`). These knobs back the transport-auth boundary only.
 */

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

/** Header carrying the Automynd webhook shared secret (MVP boundary; see auth.ts). */
export const AUTOMYND_SECRET_HEADER = 'x-automynd-secret';

/**
 * The configured Automynd webhook secret, or `undefined` when not configured.
 * When undefined, the webhook fails closed (rejects all requests).
 */
export function getAutomyndWebhookSecret(): string | undefined {
  const s = (process.env.AUTOMYND_WEBHOOK_SECRET ?? '').trim();
  return s.length > 0 ? s : undefined;
}
