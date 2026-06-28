/**
 * Alara OS API — HTTP security headers + CORS
 *
 * Two small, deliberate hardening pieces for the HTTP edge:
 *
 *  1. Security headers — a dependency-free `onSend` hook that adds a standard, universally
 *     safe header set to every response (no new dependency, matching the rate-limit slice's
 *     "don't add a dep unless one already exists" convention). HSTS is opt-in because it is
 *     deployment-sensitive.
 *  2. CORS — registers the already-installed `@fastify/cors` with an env-driven allowlist.
 *     The default is DENY (no cross-origin), which is safer than a permissive wildcard.
 *     There is no known production frontend origin in-repo; the owner sets it per environment.
 */

import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  areSecurityHeadersEnabled, isHstsEnabled, getHstsMaxAge, getCorsAllowedOrigins,
  AUTOMYND_SECRET_HEADER, IDEMPOTENCY_KEY_HEADER,
} from './config';
import { ACTOR_HEADER } from './auth';

/** Request headers a cross-origin client may send (the API's auth/idempotency headers). */
const ALLOWED_REQUEST_HEADERS = ['content-type', ACTOR_HEADER, AUTOMYND_SECRET_HEADER, IDEMPOTENCY_KEY_HEADER];

/** The standard, response-safe header set (no CSP — this is a JSON API + dev GraphiQL). */
const STANDARD_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'x-dns-prefetch-control': 'off',
  'x-permitted-cross-domain-policies': 'none',
};

/**
 * Add security headers to every response via `onSend` (covers routes, errors, and 404s).
 * No-op when disabled. Read at request time so the toggle is testable without a rebuild.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!areSecurityHeadersEnabled()) return payload;
    for (const [name, value] of Object.entries(STANDARD_HEADERS)) {
      reply.header(name, value);
    }
    if (isHstsEnabled()) {
      reply.header('strict-transport-security', `max-age=${getHstsMaxAge()}; includeSubDomains`);
    }
    return payload;
  });
}

/**
 * Register CORS from the env allowlist. Empty allowlist → `origin: false` (cross-origin
 * denied, no ACAO emitted). A non-empty list reflects only those origins. Read once at
 * registration time, so tests toggle it by rebuilding the app.
 */
export async function registerCors(app: FastifyInstance): Promise<void> {
  const origins = getCorsAllowedOrigins();
  await app.register(cors, {
    origin: origins.length > 0 ? origins : false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ALLOWED_REQUEST_HEADERS,
    credentials: false, // header-based auth, no cookies — never reflect credentials
    maxAge: 600,
  });
}
