/**
 * Alara OS API - basic in-memory rate limiting (process-local)
 *
 * A small fixed-window limiter applied as a Fastify onRequest hook to MUTATING routes
 * only (POST /commands/*, /webhooks/automynd). It reduces abuse / retry-storm / DoS risk
 * on the write surface. This is NOT distributed: each process keeps its own counters, so
 * behind multiple instances the effective limit is per-instance. Production-scale shared
 * rate limiting (e.g. Redis) is future work.
 *
 * Disabled by default under NODE_ENV=test (see config.isRateLimitEnabled) so existing
 * tests are unaffected unless they opt in via RATE_LIMIT_ENABLED.
 */

import { FastifyInstance } from 'fastify';
import { getHeader, ACTOR_HEADER } from './auth';
import {
  isRateLimitEnabled, getRateLimitWindowMs, getRateLimitMax,
} from './config';

interface Bucket { count: number; windowStart: number; }

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the current window resets. */
  resetMs: number;
}

/** A pure, clock-injectable fixed-window counter (unit-testable without timers). */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Record a hit for `key` and decide whether it is within the limit. */
  check(key: string): RateLimitDecision {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || t - b.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: t });
      return { allowed: true, remaining: this.max - 1, resetMs: this.windowMs };
    }
    if (b.count >= this.max) {
      return { allowed: false, remaining: 0, resetMs: this.windowMs - (t - b.windowStart) };
    }
    b.count += 1;
    return { allowed: true, remaining: this.max - b.count, resetMs: this.windowMs - (t - b.windowStart) };
  }
}

const LIMITED_PREFIXES = ['/commands/', '/webhooks/'];

/** Only mutating command + webhook POSTs are limited (never /health, /graphql, GETs). */
export function isLimitedRoute(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const path = url.split('?')[0];
  return LIMITED_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Register the rate-limit onRequest hook. No-op when disabled (so the hook is not even
 * installed under tests by default). Keyed by authenticated actor (x-actor-id) when
 * present, else client IP.
 */
export function registerRateLimit(app: FastifyInstance): void {
  if (!isRateLimitEnabled()) return;
  const limiter = new FixedWindowRateLimiter(getRateLimitWindowMs(), getRateLimitMax());

  app.addHook('onRequest', async (req, reply) => {
    if (!isLimitedRoute(req.method, req.url)) return;
    const key = getHeader(req, ACTOR_HEADER) ?? req.ip ?? 'unknown';
    const decision = limiter.check(key);
    if (!decision.allowed) {
      reply.header('retry-after', Math.ceil(decision.resetMs / 1000));
      reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'rate limit exceeded',
      });
      return reply; // short-circuit the request lifecycle
    }
  });
}
