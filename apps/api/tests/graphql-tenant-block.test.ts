/**
 * Alara OS API — GraphQL tenant membership block (identity boundary SLICE 5)
 *
 * A VERIFIED token principal may only query a tenant in its `tenants` claim (empty → fail
 * closed). Legacy principals / the relaxed unauthenticated path are unchanged. Mirrors the REST
 * tenant block (Slice 17) on the GraphQL read surface — closes the cross-tenant PHI gap.
 *
 * Dependency-free: an RS256 keypair is generated and tokens are signed with Node `crypto`.
 */

import { generateKeyPairSync, createSign } from 'crypto';
import { FastifyInstance } from 'fastify';
import { buildTestApp, validReferral, TENANT, REFERRAL_ACTOR } from './helpers';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUER = 'https://issuer.test/alara';
const AUDIENCE = 'alara-api';

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function token(sub: string, tenants: string[]): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, iss: ISSUER, aud: AUDIENCE, exp: nowSec + 600, iat: nowSec, tenants }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

describe('GraphQL tenant membership block', () => {
  let app: FastifyInstance;
  let patientId: string;

  const KEYS = ['AUTH_MODE', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_PUBLIC_KEY'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    saved = {}; for (const k of KEYS) saved[k] = process.env[k];
    process.env.AUTH_ISSUER = ISSUER;
    process.env.AUTH_AUDIENCE = AUDIENCE;
    process.env.AUTH_PUBLIC_KEY = PEM;
    const t = buildTestApp();
    app = await t.buildApp();
    await app.ready();
    // Seed a real projection under TENANT (legacy x-actor-id path — unaffected by the block).
    const seed = await app.inject({
      method: 'POST', url: '/commands/referrals',
      headers: { 'x-actor-id': REFERRAL_ACTOR }, payload: validReferral,
    });
    patientId = seed.json().patientId;
  });
  afterEach(async () => {
    await app.close();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  const twinQuery = (tenantId: string, pid: string) => JSON.stringify({
    query: `query($t:String!,$p:ID!){ digitalCareTwin(tenantId:$t, patientId:$p){ patientId patientAttributes } }`,
    variables: { t: tenantId, p: pid },
  });
  const gql = (payload: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/graphql', headers: { 'content-type': 'application/json', ...headers }, payload });
  const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

  test('legacy/test default (no token): twin query still returns data', async () => {
    delete process.env.AUTH_MODE;
    const res = await gql(twinQuery(TENANT, patientId));
    expect(res.statusCode).toBe(200);
    expect(res.json().errors).toBeUndefined();
    expect(res.json().data.digitalCareTwin.patientAttributes.name).toBe('Samuel Brown');
  });

  test('legacy principal (x-actor-id) is not tenant-enforced — data returned', async () => {
    delete process.env.AUTH_MODE;
    const res = await gql(twinQuery(TENANT, patientId), { 'x-actor-id': REFERRAL_ACTOR });
    expect(res.json().errors).toBeUndefined();
    expect(res.json().data.digitalCareTwin).not.toBeNull();
  });

  test('verified token whose tenants include the queried tenant → data returned', async () => {
    process.env.AUTH_MODE = 'dual';
    const res = await gql(twinQuery(TENANT, patientId), bearer(token('clinician-1', [TENANT, 'other'])));
    expect(res.json().errors).toBeUndefined();
    expect(res.json().data.digitalCareTwin.patientAttributes.name).toBe('Samuel Brown');
  });

  test('verified token querying a NON-member tenant → safe error, NO PHI leaked', async () => {
    process.env.AUTH_MODE = 'dual';
    const res = await gql(twinQuery(TENANT, patientId), bearer(token('attacker', ['some-other-tenant'])));
    expect(res.statusCode).toBe(200);                                   // GraphQL transport
    expect(res.json().data.digitalCareTwin).toBeNull();                 // no data
    expect(res.json().errors[0].message).toMatch(/tenant not permitted/);
    // The PHI-bearing payload must NOT appear anywhere in the response.
    expect(JSON.stringify(res.json())).not.toContain('Samuel Brown');
  });

  test('verified token with EMPTY tenants → fail closed (error, null data)', async () => {
    process.env.AUTH_MODE = 'dual';
    const res = await gql(twinQuery(TENANT, patientId), bearer(token('clinician-1', [])));
    expect(res.json().data.digitalCareTwin).toBeNull();
    expect(res.json().errors[0].message).toMatch(/tenant not permitted/);
  });

  test('multi-tenant token can query either allowed tenant', async () => {
    process.env.AUTH_MODE = 'dual';
    const tok = token('clinician-1', [TENANT, 'tenant-b']);
    // TENANT has a seeded twin → data; tenant-b is allowed but empty → null WITHOUT a tenant error.
    const a = await gql(twinQuery(TENANT, patientId), bearer(tok));
    const b = await gql(twinQuery('tenant-b', patientId), bearer(tok));
    expect(a.json().errors).toBeUndefined();
    expect(a.json().data.digitalCareTwin).not.toBeNull();
    expect(b.json().errors).toBeUndefined();          // allowed tenant → no tenant error
    expect(b.json().data.digitalCareTwin).toBeNull(); // simply no projection there
  });

  test('the block applies to the object resolver too (cross-tenant object read denied)', async () => {
    process.env.AUTH_MODE = 'dual';
    const q = JSON.stringify({ query: `{ object(tenantId:"${TENANT}", id:"${patientId}"){ id type } }` });
    const ok = await gql(q, bearer(token('u', [TENANT])));
    expect(ok.json().errors).toBeUndefined();
    expect(ok.json().data.object.type).toBe('Patient');
    const denied = await gql(q, bearer(token('u', ['elsewhere'])));
    expect(denied.json().data.object).toBeNull();
    expect(denied.json().errors[0].message).toMatch(/tenant not permitted/);
  });
});
