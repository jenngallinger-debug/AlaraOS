/**
 * Alara OS API — Principal abstraction (identity/tenant boundary SLICE 1, legacy mode)
 *
 * Proves the typed Principal sits BEHIND the existing auth boundary with NO behavior change:
 *   - unit: the legacy Principal is built correctly from x-actor-id;
 *   - unit: getAuthenticatedActor still returns the actor id (derived from the principal);
 *   - integration: the existing success / missing-actor / system-actor / GraphQL paths are
 *     byte-for-byte unchanged.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import {
  authenticatePrincipal, legacyPrincipal, getAuthenticatedActor,
} from '../src/shared/auth';
import { buildTestApp, validReferral, TENANT, REFERRAL_ACTOR, SYSTEM_ACTOR } from './helpers';

/** Minimal FastifyRequest stand-in carrying only headers (all the auth helpers read). */
const reqWith = (headers: Record<string, string | undefined>) =>
  ({ headers } as unknown as FastifyRequest);

// ─── Unit: legacy principal construction ──────────────────────────────────────

describe('legacyPrincipal / authenticatePrincipal (legacy mode)', () => {
  test('legacyPrincipal builds the correct minimal shape', () => {
    expect(legacyPrincipal('care-guide-001')).toEqual({
      principalId: 'care-guide-001',
      type: 'user',
      tenants: [],
      roles: [],
      scopes: [],
      legacyActorId: 'care-guide-001',
    });
  });

  test('authenticatePrincipal derives a principal from x-actor-id', () => {
    const p = authenticatePrincipal(reqWith({ 'x-actor-id': 'wm-care-guide' }));
    expect(p).toBeDefined();
    expect(p!.principalId).toBe('wm-care-guide');
    expect(p!.legacyActorId).toBe('wm-care-guide');
    expect(p!.type).toBe('user');
    expect(p!.tenants).toEqual([]);
    expect(p!.roles).toEqual([]);
    expect(p!.scopes).toEqual([]);
  });

  test('authenticatePrincipal returns undefined when no actor header is present', () => {
    expect(authenticatePrincipal(reqWith({}))).toBeUndefined();
    expect(authenticatePrincipal(reqWith({ 'x-actor-id': '   ' }))).toBeUndefined(); // trimmed-empty
  });

  test('a system actor id still yields a principal (no special-casing in slice 1)', () => {
    // The system→scope mapping is a later slice; here the system actor is an ordinary
    // legacy principal. The privileged-surface gate stays on isSystemActor (see integration).
    const p = authenticatePrincipal(reqWith({ 'x-actor-id': SYSTEM_ACTOR }));
    expect(p!.principalId).toBe(SYSTEM_ACTOR);
    expect(p!.scopes).toEqual([]);
  });

  test('getAuthenticatedActor is behavior-compatible (returns principalId, else undefined)', () => {
    expect(getAuthenticatedActor(reqWith({ 'x-actor-id': 'abc' }))).toBe('abc');
    expect(getAuthenticatedActor(reqWith({}))).toBeUndefined();
  });
});

// ─── Integration: external behavior is unchanged ──────────────────────────────

describe('Principal abstraction does not change request behavior', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof buildTestApp>['store'];

  beforeEach(async () => {
    const t = buildTestApp();
    store = t.store;
    app = await t.buildApp();
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  test('x-actor-id success path still works (referral → 201)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/commands/referrals',
      headers: { 'x-actor-id': REFERRAL_ACTOR }, payload: validReferral,
    });
    expect(res.statusCode).toBe(201);
  });

  test('missing actor still fails exactly as before (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/commands/referrals', payload: validReferral });
    expect(res.statusCode).toBe(401);
  });

  test('system-actor gate on /commands/events is preserved', async () => {
    const body = { tenantId: TENANT, streamId: '00000000-0000-4000-8000-0000000000a1', type: 'ObjectCreated', payload: {} };
    const ok = await app.inject({ method: 'POST', url: '/commands/events', headers: { 'x-actor-id': SYSTEM_ACTOR }, payload: body });
    expect(ok.statusCode).toBe(201);                                    // system actor allowed
    const forbidden = await app.inject({ method: 'POST', url: '/commands/events', headers: { 'x-actor-id': 'not-system' }, payload: body });
    expect(forbidden.statusCode).toBe(403);                            // non-system actor still rejected
  });

  test('GraphQL behavior is unchanged (query with actor still returns data)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/json', 'x-actor-id': REFERRAL_ACTOR },
      payload: JSON.stringify({ query: '{ __schema { queryType { name } } }' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.__schema.queryType.name).toBe('Query');
  });
});
