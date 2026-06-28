/**
 * Alara OS API — HTTP security headers + CORS tests
 *
 * Proves the HTTP edge hardening:
 *   - standard security headers on every response (default ON);
 *   - HSTS is opt-in (default OFF);
 *   - CORS denies cross-origin by default (no allowlist) and reflects only configured origins;
 *   - preflight (OPTIONS) honors the same allowlist.
 *
 * CORS is read once at registration time, so origin tests build a fresh app under the env.
 * Security headers are read per-request, so they toggle without a rebuild.
 */

import { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';

// Save/restore the env knobs this suite mutates.
const ENV_KEYS = ['SECURITY_HEADERS_ENABLED', 'HSTS_ENABLED', 'CORS_ALLOWED_ORIGINS'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = {}; for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

async function freshApp(): Promise<FastifyInstance> {
  const app = await buildTestApp().buildApp();
  await app.ready();
  return app;
}

describe('Security headers', () => {
  test('default: standard headers present on a normal response', async () => {
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
    } finally { await app.close(); }
  });

  test('default: HSTS is NOT emitted (opt-in)', async () => {
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['strict-transport-security']).toBeUndefined();
    } finally { await app.close(); }
  });

  test('HSTS_ENABLED=true emits Strict-Transport-Security', async () => {
    process.env.HSTS_ENABLED = 'true';
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['strict-transport-security']).toMatch(/^max-age=\d+; includeSubDomains$/);
    } finally { await app.close(); }
  });

  test('headers are also present on error/404 responses', async () => {
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    } finally { await app.close(); }
  });

  test('SECURITY_HEADERS_ENABLED=false disables the header set', async () => {
    process.env.SECURITY_HEADERS_ENABLED = 'false';
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBeUndefined();
    } finally { await app.close(); }
  });
});

describe('CORS', () => {
  const ORIGIN = 'https://portal.example.com';

  test('default (no allowlist): cross-origin denied — no Access-Control-Allow-Origin', async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: ORIGIN } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally { await app.close(); }
  });

  test('configured origin is reflected in Access-Control-Allow-Origin', async () => {
    process.env.CORS_ALLOWED_ORIGINS = `${ORIGIN}, https://other.example.com`;
    const app = await freshApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: ORIGIN } });
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    } finally { await app.close(); }
  });

  test('origin NOT in the allowlist is not reflected', async () => {
    process.env.CORS_ALLOWED_ORIGINS = ORIGIN;
    const app = await freshApp();
    try {
      const res = await app.inject({
        method: 'GET', url: '/health', headers: { origin: 'https://evil.example.com' },
      });
      expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
    } finally { await app.close(); }
  });

  test('preflight (OPTIONS) for an allowed origin returns CORS headers', async () => {
    process.env.CORS_ALLOWED_ORIGINS = ORIGIN;
    const app = await freshApp();
    try {
      const res = await app.inject({
        method: 'OPTIONS', url: '/commands/consent',
        headers: {
          origin: ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-actor-id',
        },
      });
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
    } finally { await app.close(); }
  });
});
