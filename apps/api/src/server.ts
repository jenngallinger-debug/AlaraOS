/**
 * Alara OS API — Server Bootstrap
 *
 * Fastify chosen over NestJS:
 *   - No DI container needed — engines already compose via constructors
 *   - Schema-first validation with ajv (built in to Fastify)
 *   - ~3x lower overhead than NestJS for this architecture
 *   - Mercurius for GraphQL (Fastify-native, not Express-based)
 *
 * Stack: Fastify 4 + Mercurius (GraphQL) + ajv validation
 */

import Fastify from 'fastify';
import mercurius from 'mercurius';
import { EngineContainer } from './shared/container';
import { registerRestRoutes } from './rest/routes';
import { schema } from './graphql/schema';
import { buildResolvers } from './graphql/resolvers';

export async function buildServer(container: EngineContainer) {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    ajv: {
      customOptions: {
        strict: false,
        allErrors: false,
      },
    },
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  app.setErrorHandler((error, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      statusCode,
      error: statusCode === 400 ? 'Bad Request'
           : statusCode === 422 ? 'Unprocessable Entity'
           : 'Internal Server Error',
      message: error.message,
    });
  });

  // ── REST routes ───────────────────────────────────────────────────────────
  await registerRestRoutes(app, container);

  // ── GraphQL (Mercurius) ───────────────────────────────────────────────────
  await app.register(mercurius, {
    schema,
    resolvers: buildResolvers(container) as Parameters<typeof mercurius>[1]['resolvers'],
    graphiql: process.env.NODE_ENV !== 'production',
    path: '/graphql',
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    service: 'alara-os-api',
    version: '0.5.0',
    timestamp: new Date().toISOString(),
  }));

  return app;
}
