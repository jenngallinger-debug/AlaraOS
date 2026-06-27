/**
 * Alara OS API — Rate limiting (basic, in-memory)
 *
 * Unit-tests the FixedWindowRateLimiter (injected clock, no timers) and the route
 * predicate, then integration-tests the onRequest hook via app.inject:
 *   - disabled by default under NODE_ENV=test (existing tests unaffected)
 *   - explicitly enabled via env → under-limit passes, over-limit → 429
 *   - /health is never limited; the webhook route is limited when enabled
 */

import { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers';
import { FixedWindowRateLimiter, isLimitedRoute } from '../src/shared/rate-limit';

// ─── Unit: FixedWindowRateLimiter ─────────────────────────────────────────────

describe('FixedWindowRateLimiter', () => {
  test('allows up to max within a window, then blocks', () => {
    let t = 1000;
    const rl = new FixedWindowRateLimiter(10_000, 3, () => t);
    expect(rl.check('k').allowed).toBe(true);   // 1
    expect(rl.check('k').allowed).toBe(true);   // 2
    expect(rl.check('k').allowed).toBe(true);   // 3
    expect(rl.check('k').allowed).toBe(false);  // 4 — over
    expect(rl.check('k').allowed).toBe(false);
  });

  test('window reset allows requests again after windowMs elapses', () => {
    let t = 0;
    const rl = new FixedWindowRateLimiter(1000, 1, () => t);
    expect(rl.check('k').allowed).toBe(true);   // 1
    expect(rl.check('k').allowed).toBe(false);  // over
    t = 1000;                                    // window elapsed
    expect(rl.check('k').allowed).toBe(true);   // fresh window
  });

  test('separate keys have independent buckets', () => {
    const rl = new FixedWindowRateLimiter(10_000, 1, () => 0);
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('b').allowed).toBe(true);   // different key — fresh
    expect(rl.check('a').allowed).toBe(false);  // 'a' already at limit
  });
});

describe('isLimitedRoute', () => {
  test('limits POST /commands/* and /webhooks/*; not health/graphql/GETs', () => {
    expect(isLimitedRoute('POST', '/commands/referrals')).toBe(true);
    expect(isLimitedRoute('POST', '/commands/events')).toBe(true);
    expect(isLimitedRoute('POST', '/commands/consent/withdraw')).toBe(true);
    expect(isLimitedRoute('POST', '/webhooks/automynd')).toBe(true);
    expect(isLimitedRoute('GET', '/health')).toBe(false);
    expect(isLimitedRoute('POST', '/graphql')).toBe(false);
    expect(isLimitedRoute('GET', '/commands/referrals')).toBe(false);
  });
});

// ─── Integration: the onRequest hook ──────────────────────────────────────────

describe('rate limit hook (integration)', () => {
  const KEYS = ['RATE_LIMIT_ENABLED', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function buildApp(): Promise<FastifyInstance> {
    const app = await buildTestApp().buildApp(); // reads RATE_LIMIT_* at registration
    await app.ready();
    return app;
  }

  const event = (app: FastifyInstance, n: number) =>
    app.inject({
      method: 'POST', url: '/commands/events',
      headers: { 'x-actor-id': 'system' },
      payload: { tenantId: 't', streamId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, type: 'ObjectCreated', payload: {} },
    });

  test('1. disabled by default under test — many mutating requests are never 429', async () => {
    const app = await buildApp();
    for (let i = 0; i < 8; i++) {
      const res = await event(app, i);
      expect(res.statusCode).not.toBe(429);
    }
    await app.close();
  });

  test('2 + 3 + 4. explicitly enabled — under limit passes, over limit → 429', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    const app = await buildApp();

    expect((await event(app, 1)).statusCode).not.toBe(429); // 1
    expect((await event(app, 2)).statusCode).not.toBe(429); // 2
    const third = await event(app, 3);
    expect(third.statusCode).toBe(429);                     // over limit
    expect(third.headers['retry-after']).toBeDefined();
    await app.close();
  });

  test('5. /health is never limited even when enabled', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = '1';
    const app = await buildApp();
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
    await app.close();
  });

  test('7. webhook route is limited when enabled', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_MAX = '1';
    const app = await buildApp();
    const hook = () => app.inject({
      method: 'POST', url: '/webhooks/automynd',
      payload: { eventType: 'patient.observed', tenantId: 't', payload: {} },
    });
    expect((await hook()).statusCode).not.toBe(429); // first allowed (handler decides 200/401)
    expect((await hook()).statusCode).toBe(429);     // second over the limit
    await app.close();
  });
});
