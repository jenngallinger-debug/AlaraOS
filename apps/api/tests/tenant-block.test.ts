/**
 * Alara OS API — REST tenant membership block (identity boundary SLICE 3)
 *
 * A VERIFIED token principal may only act in a tenant listed in its `tenants` claim (empty →
 * fail closed, 403). Legacy principals are NOT tenant-enforced (backward compatible). Applies to
 * the principal-authed mutating commands that take a tenantId — referrals, events, consent,
 * consent/withdraw — and NOT to the shared-secret webhook.
 *
 * Dependency-free: an RS256 keypair is generated and tokens are signed with Node `crypto`.
 */

import { generateKeyPairSync, createSign } from 'crypto';
import { FastifyInstance } from 'fastify';
import { buildTestApp, validReferral, TENANT, REFERRAL_ACTOR, SYSTEM_ACTOR } from './helpers';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUER = 'https://issuer.test/alara';
const AUDIENCE = 'alara-api';

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Mint a signed RS256 token for `sub` with the given tenant membership. */
function token(sub: string, tenants: string[], extra: Record<string, unknown> = {}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub, iss: ISSUER, aud: AUDIENCE, exp: nowSec + 600, iat: nowSec, tenants, ...extra,
  }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

const validConsent = {
  tenantId: TENANT, subjectId: 'subject-1', grantorId: 'patient', recipientId: 'wm-care-guide',
  permissionTypes: ['read'], source: 'intake',
};

describe('REST tenant membership block', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof buildTestApp>['store'];

  const KEYS = ['AUTH_MODE', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_PUBLIC_KEY'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(async () => {
    saved = {}; for (const k of KEYS) saved[k] = process.env[k];
    process.env.AUTH_ISSUER = ISSUER;
    process.env.AUTH_AUDIENCE = AUDIENCE;
    process.env.AUTH_PUBLIC_KEY = PEM;
    const t = buildTestApp();
    store = t.store;
    app = await t.buildApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  const postReferral = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/commands/referrals', headers, payload: validReferral });
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  // ─── legacy (default) — unchanged ───────────────────────────────────────────

  test('legacy mode (default): x-actor-id referral succeeds regardless of tenant claims', async () => {
    delete process.env.AUTH_MODE;
    const res = await postReferral({ 'x-actor-id': REFERRAL_ACTOR });
    expect(res.statusCode).toBe(201); // legacy principals are not tenant-enforced
  });

  // ─── dual — verified token tenant enforcement ───────────────────────────────

  test('verified token whose tenants include the request tenant → 201', async () => {
    process.env.AUTH_MODE = 'dual';
    const res = await postReferral(bearer(token('clinician-1', [TENANT, 'other-tenant'])));
    expect(res.statusCode).toBe(201);
  });

  test('verified token whose tenants do NOT include the request tenant → 403, nothing created', async () => {
    process.env.AUTH_MODE = 'dual';
    const before = store.objects.size;
    const res = await postReferral(bearer(token('clinician-1', ['some-other-tenant'])));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/tenant not permitted/);
    expect(store.objects.size).toBe(before); // tenant block runs before the engine
  });

  test('verified token with EMPTY tenants → 403 on a tenant-scoped command (fail closed)', async () => {
    process.env.AUTH_MODE = 'dual';
    const res = await postReferral(bearer(token('clinician-1', [])));
    expect(res.statusCode).toBe(403);
  });

  test('multi-tenant token can access EITHER allowed tenant', async () => {
    process.env.AUTH_MODE = 'dual';
    const t = token('clinician-1', [TENANT, 'tenant-b']);
    const a = await app.inject({ method: 'POST', url: '/commands/referrals', headers: bearer(t), payload: validReferral });
    const b = await app.inject({
      method: 'POST', url: '/commands/referrals', headers: bearer(t),
      payload: { ...validReferral, tenantId: 'tenant-b', automyndReferralId: 'REF-B', automyndPatientId: 'AM-B' },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  test('dual mode: missing/invalid token falls back to legacy (x-actor-id), no tenant enforcement', async () => {
    process.env.AUTH_MODE = 'dual';
    const noToken = await postReferral({ 'x-actor-id': REFERRAL_ACTOR });
    expect(noToken.statusCode).toBe(201);                                   // legacy fallback, not enforced
    const badToken = await postReferral({ authorization: 'Bearer not.a.jwt', 'x-actor-id': REFERRAL_ACTOR });
    expect(badToken.statusCode).toBe(201);                                  // invalid token → legacy fallback
  });

  // ─── applies across the tenant-scoped commands ──────────────────────────────

  test('consent capture enforces the tenant block for verified principals', async () => {
    process.env.AUTH_MODE = 'dual';
    const ok = await app.inject({ method: 'POST', url: '/commands/consent', headers: bearer(token('subject-1', [TENANT])), payload: validConsent });
    expect(ok.statusCode).toBe(201);
    const denied = await app.inject({ method: 'POST', url: '/commands/consent', headers: bearer(token('subject-1', ['elsewhere'])), payload: validConsent });
    expect(denied.statusCode).toBe(403);
  });

  test('raw event command: system scope still required AND tenant block applies to verified principals', async () => {
    process.env.AUTH_MODE = 'dual';
    const evt = { tenantId: TENANT, streamId: '00000000-0000-4000-8000-0000000000b1', type: 'ObjectCreated', payload: {} };
    // system scope + matching tenant → 201
    const ok = await app.inject({ method: 'POST', url: '/commands/events', headers: bearer(token('svc', [TENANT], { scope: 'system:*' })), payload: evt });
    expect(ok.statusCode).toBe(201);
    // system scope but WRONG tenant → 403 (tenant block)
    const wrongTenant = await app.inject({ method: 'POST', url: '/commands/events', headers: bearer(token('svc', ['other'], { scope: 'system:*' })), payload: evt });
    expect(wrongTenant.statusCode).toBe(403);
    // matching tenant but NO system scope → 403 (scope gate still first)
    const noScope = await app.inject({ method: 'POST', url: '/commands/events', headers: bearer(token('svc', [TENANT])), payload: evt });
    expect(noScope.statusCode).toBe(403);
  });

  test('required mode: legacy x-actor-id is rejected (401) regardless of tenant', async () => {
    process.env.AUTH_MODE = 'required';
    const res = await postReferral({ 'x-actor-id': REFERRAL_ACTOR });
    expect(res.statusCode).toBe(401); // token mandatory in required mode
  });

  test('legacy system-actor raw event is unaffected in legacy mode (no tenant enforcement)', async () => {
    delete process.env.AUTH_MODE;
    const evt = { tenantId: TENANT, streamId: '00000000-0000-4000-8000-0000000000b2', type: 'ObjectCreated', payload: {} };
    const res = await app.inject({ method: 'POST', url: '/commands/events', headers: { 'x-actor-id': SYSTEM_ACTOR }, payload: evt });
    expect(res.statusCode).toBe(201);
  });
});
