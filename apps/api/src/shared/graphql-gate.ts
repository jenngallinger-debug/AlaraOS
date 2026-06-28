/**
 * Alara OS API — GraphQL read-surface auth gate
 *
 * The GraphQL endpoint returns PHI / tenant-scoped read models and was previously
 * reachable with no authentication. This installs an `onRequest` hook that brings
 * `/graphql` onto the same transport-auth boundary as the mutating REST commands:
 * when auth is required (see config.isGraphqlAuthRequired) a request without an
 * authenticated actor (`x-actor-id`) is rejected with 401 before it reaches Mercurius.
 *
 * Scope: this only requires *a* principal. It does NOT enforce tenant isolation —
 * `tenantId` is still a client-supplied query argument, so an authenticated caller can
 * still name another tenant. Tenant-aware authorization needs real authN + resolver
 * changes and is tracked as a decision packet (code-concordance UPDATE 19).
 */

import { FastifyInstance } from 'fastify';
import { getAuthenticatedActor } from './auth';
import { isGraphqlAuthRequired } from './config';

/** True for the GraphQL data endpoint only (not the `/graphiql` IDE shell). */
export function isGraphqlPath(url: string): boolean {
  return url.split('?')[0] === '/graphql';
}

/**
 * Register the GraphQL auth gate. The requirement is read per-request, so tests can
 * toggle `GRAPHQL_REQUIRE_AUTH` without rebuilding the app. Only call this when the
 * GraphQL surface is actually mounted (so a disabled surface 404s naturally instead).
 */
export function registerGraphqlAuthGate(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!isGraphqlPath(req.url)) return;
    if (!isGraphqlAuthRequired()) return;
    if (!getAuthenticatedActor(req)) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'unauthenticated: missing x-actor-id',
      });
      return reply; // short-circuit before Mercurius handles the query
    }
  });
}
