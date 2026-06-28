/**
 * Alara OS API — raw-body capture (scoped JSON content-type parser)
 *
 * Stashes the EXACT received request bytes (as a string) on `request.rawBody` and then
 * parses JSON via Fastify's own default parser, so parse semantics — empty-body rejection,
 * prototype/constructor-poisoning protection, and 400-on-malformed — are byte-for-byte
 * unchanged. The future Automynd HMAC check (decision packet, code-concordance UPDATE 22)
 * must verify the signature over these exact bytes, not a re-serialized object.
 *
 * Register this INSIDE an encapsulated plugin context (`app.register(async (ctx) => …)`)
 * so the parser applies only to that context's routes; all other routes keep the framework
 * default parser. Adds no dependency (no `fastify-raw-body`).
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

/** A request that has been through the raw-body parser. */
export type RawBodyRequest = FastifyRequest & { rawBody?: string };

/** Read the captured raw body, or undefined if this route did not use the raw-body parser. */
export function getRawBody(req: FastifyRequest): string | undefined {
  return (req as RawBodyRequest).rawBody;
}

/**
 * Install a JSON content-type parser on `instance` that records the raw body, then delegates
 * to Fastify's default JSON parser. Encapsulated to `instance` and its children only.
 */
export function registerRawBodyJsonParser(instance: FastifyInstance): void {
  // Reuse the framework default parser with Fastify's default poisoning actions so behaviour
  // matches every other JSON route exactly; we only add the raw-bytes capture in front of it.
  const defaultJsonParser = instance.getDefaultJsonParser('error', 'error');
  instance.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = body as string; // parseAs:'string' guarantees a string at runtime
    (req as RawBodyRequest).rawBody = raw;
    defaultJsonParser(req, raw, done);
  });
}
