/**
 * Alara OS API Tests — Shared Test Helpers
 *
 * Builds a real Fastify server backed by InMemoryStore.
 * No real database, no external services, fully deterministic.
 */

import { buildServer } from '../src/server';
import { buildContainer } from '../src/shared/container';
import { DatabaseClient } from '../../../packages/core/src/shared/database';
import { InMemoryStore } from '../../../packages/core/tests/helpers/in-memory-store';

export function buildTestApp() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const container = buildContainer(db);
  return { store, container, buildApp: () => buildServer(container) };
}

export const TENANT = 'alara-home-care';

export const validReferral = {
  tenantId:           TENANT,
  patientName:        'Samuel Brown',
  programType:        'EEOICPA',
  referralSource:     'Dr. Jones Clinic',
  referralDate:       '2026-06-25',
  automyndPatientId:  'AM-883201',
  automyndReferralId: 'REF-001',
  actor:              'care-guide-001',
};

// ─── Transport-auth test constants ────────────────────────────────────────────
/** Authenticated actor for referral commands (matches validReferral.actor). */
export const REFERRAL_ACTOR = 'care-guide-001';
/** Privileged actor for /commands/events (default ALARA_SYSTEM_ACTORS = 'system'). */
export const SYSTEM_ACTOR = 'system';
/** Shared secret used by webhook tests (the suite sets AUTOMYND_WEBHOOK_SECRET to this). */
export const WEBHOOK_SECRET = 'test-automynd-secret';
