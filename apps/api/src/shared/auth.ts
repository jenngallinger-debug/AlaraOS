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

export const ACTOR_HEADER = 'x-actor-id';

/** The authenticated actor for this request, or undefined if none is present. */
export function getAuthenticatedActor(req: FastifyRequest): string | undefined {
  const raw = req.headers[ACTOR_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const actor = (value ?? '').trim();
  return actor.length > 0 ? actor : undefined;
}
