/**
 * Alara OS API — Transport Authentication (development boundary)
 *
 * Establishes the authenticated caller ("principal") from the request transport.
 * This is a MINIMAL development/test boundary — NOT real authentication: the
 * authenticated actor is taken from the `x-actor-id` request header. There is no
 * login, no session, and no JWT verification here. A real auth provider would
 * replace `getAuthenticatedActor` (verifying a token/session) without changing the
 * downstream authorization path: the authenticated actor is what the
 * ConsentAuthorizer evaluates — never a body-supplied field.
 */

import { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';

export const ACTOR_HEADER = 'x-actor-id';

/** Read a single header value, trimmed; undefined when absent/empty. */
export function getHeader(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The authenticated actor for this request, or undefined if none is present. */
export function getAuthenticatedActor(req: FastifyRequest): string | undefined {
  return getHeader(req, ACTOR_HEADER);
}

/**
 * Constant-time secret comparison for webhook verification. Fails closed when either
 * side is absent or the lengths differ. (MVP shared-secret check — a production vendor
 * integration would HMAC the raw request body instead.)
 */
export function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
