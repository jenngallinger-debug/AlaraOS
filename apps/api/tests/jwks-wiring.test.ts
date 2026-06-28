/**
 * Alara OS API — JWKS runtime wiring (identity boundary, JWKS slice 3)
 *
 * Wires JwksCache into authenticatePrincipal behind AUTH_JWKS_URL. Dependency-free + no network:
 * a fake JwksFetcher (injected via configureJwksForTests) returns a JWKS built from a local RSA
 * keypair. Proves: default static-key path unchanged, JWKS precedence, warm/cold/fail-closed, and
 * last-known-good. The hot path (authenticatePrincipal) stays synchronous.
 */

import { generateKeyPairSync, createSign, KeyObject } from 'crypto';
import { FastifyRequest } from 'fastify';
import { authenticatePrincipal } from '../src/shared/auth';
import { configureJwksForTests, warmJwks } from '../src/shared/jwks-runtime';
import { JwksFetcher } from '../src/shared/jwks';

const ISSUER = 'https://issuer.test/alara';
const AUDIENCE = 'alara-api';
const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface Kp { kid: string; priv: KeyObject; jwk: Record<string, unknown>; pem: string; }
function makeKey(kid: string): Kp {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { kid, priv: privateKey, jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' }, pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}
const jwksDoc = (...ks: Kp[]) => ({ keys: ks.map((k) => k.jwk) });

function token(kp: Kp): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: kp.kid }));
  const payload = b64url(JSON.stringify({ sub: `u-${kp.kid}`, iss: ISSUER, aud: AUDIENCE, exp: nowSec + 600, iat: nowSec, tenants: ['t1'] }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(kp.priv);
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Stateful fake fetcher (counts calls; throws for an Error response). */
type CountingFetcher = JwksFetcher & { calls: number };
function fakeFetcher(...responses: unknown[]): CountingFetcher {
  const fn: CountingFetcher = Object.assign(
    async (): Promise<unknown> => {
      const r = responses[Math.min(fn.calls, responses.length - 1)];
      fn.calls += 1;
      if (r instanceof Error) throw r;
      return r;
    },
    { calls: 0 },
  );
  return fn;
}

const reqWith = (headers: Record<string, string>) => ({ headers } as unknown as FastifyRequest);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const ENV = ['AUTH_MODE', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_PUBLIC_KEY', 'AUTH_JWKS_URL'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {}; for (const k of ENV) saved[k] = process.env[k];
  process.env.AUTH_ISSUER = ISSUER;
  process.env.AUTH_AUDIENCE = AUDIENCE;
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  configureJwksForTests(undefined); // clear the injected fetcher + reset the singleton
});

describe('JWKS runtime wiring', () => {
  test('default (AUTH_JWKS_URL unset): static AUTH_PUBLIC_KEY path is unchanged', async () => {
    const a = makeKey('static');
    process.env.AUTH_MODE = 'dual';
    process.env.AUTH_PUBLIC_KEY = a.pem;
    // No AUTH_JWKS_URL → resolver falls back to the single key (which ignores kid).
    const p = authenticatePrincipal(reqWith(bearer(token(a))));
    expect(p!.principalId).toBe('u-static');
  });

  test('JWKS configured + warm + valid kid token → verified principal (JWKS precedence)', async () => {
    const a = makeKey('k1');
    process.env.AUTH_MODE = 'dual';
    process.env.AUTH_PUBLIC_KEY = makeKey('other').pem; // present, but JWKS must take precedence
    process.env.AUTH_JWKS_URL = 'https://idp.test/jwks';
    configureJwksForTests({ fetcher: fakeFetcher(jwksDoc(a)), minRefreshIntervalMs: 0 });
    await warmJwks();                                   // deterministic warm (no network)

    const p = authenticatePrincipal(reqWith(bearer(token(a))));
    expect(p).toBeDefined();
    expect(p!.principalId).toBe('u-k1');
    expect(p!.tenants).toEqual(['t1']);
  });

  test('unknown kid fails closed (dual → legacy fallback)', async () => {
    const known = makeKey('known'); const stranger = makeKey('stranger');
    process.env.AUTH_MODE = 'dual';
    process.env.AUTH_JWKS_URL = 'https://idp.test/jwks';
    configureJwksForTests({ fetcher: fakeFetcher(jwksDoc(known)), minRefreshIntervalMs: 0 });
    await warmJwks();

    // token signed by a kid NOT in the JWKS, but x-actor-id present → dual falls back to legacy.
    const p = authenticatePrincipal(reqWith({ ...bearer(token(stranger)), 'x-actor-id': 'legacy-actor' }));
    expect(p!.principalId).toBe('legacy-actor');
    expect(p!.legacyActorId).toBe('legacy-actor');
  });

  test('cold cache in dual mode falls back to legacy x-actor-id', async () => {
    const a = makeKey('k1');
    process.env.AUTH_MODE = 'dual';
    process.env.AUTH_JWKS_URL = 'https://idp.test/jwks';
    configureJwksForTests({ fetcher: fakeFetcher(jwksDoc(a)), minRefreshIntervalMs: 0 });
    // NOTE: no warmJwks() → cache cold → resolver yields undefined synchronously → fail closed.
    const p = authenticatePrincipal(reqWith({ ...bearer(token(a)), 'x-actor-id': 'legacy-actor' }));
    expect(p!.principalId).toBe('legacy-actor'); // dual → legacy fallback
  });

  test('cold cache in required mode rejects (no principal)', async () => {
    const a = makeKey('k1');
    process.env.AUTH_MODE = 'required';
    process.env.AUTH_JWKS_URL = 'https://idp.test/jwks';
    configureJwksForTests({ fetcher: fakeFetcher(jwksDoc(a)), minRefreshIntervalMs: 0 });
    // cold cache + required → no token principal, legacy NOT accepted.
    const p = authenticatePrincipal(reqWith({ ...bearer(token(a)), 'x-actor-id': 'legacy-actor' }));
    expect(p).toBeUndefined();
  });

  test('fetch failure preserves last-known-good', async () => {
    const a = makeKey('k1');
    let clock = 0;
    process.env.AUTH_MODE = 'dual';
    process.env.AUTH_JWKS_URL = 'https://idp.test/jwks';
    // First refresh succeeds; second throws. ttl 0 + throttle 0 + injected clock → 2nd warm attempts.
    configureJwksForTests({ fetcher: fakeFetcher(jwksDoc(a), new Error('down')), ttlMs: 0, minRefreshIntervalMs: 0, now: () => clock });
    await warmJwks();                                   // fetch #1 ok → cache {k1}
    expect(authenticatePrincipal(reqWith(bearer(token(a))))!.principalId).toBe('u-k1');

    clock = 1000; await warmJwks();                     // fetch #2 throws → keep last-known-good
    expect(authenticatePrincipal(reqWith(bearer(token(a))))!.principalId).toBe('u-k1'); // still verifies
  });

  test('rotation: new kid usable after a refresh; old kid retired', async () => {
    const a = makeKey('a'); const b = makeKey('b');
    let clock = 0;
    process.env.AUTH_MODE = 'dual';
    process.env.AUTH_JWKS_URL = 'https://idp.test/jwks';
    configureJwksForTests({ fetcher: fakeFetcher(jwksDoc(a), jwksDoc(b)), ttlMs: 0, minRefreshIntervalMs: 0, now: () => clock });
    await warmJwks();
    expect(authenticatePrincipal(reqWith(bearer(token(a))))!.principalId).toBe('u-a');

    clock = 1000; await warmJwks();                     // rotate → {b}
    expect(authenticatePrincipal(reqWith({ ...bearer(token(a)), 'x-actor-id': 'fallback' }))!.principalId).toBe('fallback'); // old kid gone → dual fallback
    expect(authenticatePrincipal(reqWith(bearer(token(b))))!.principalId).toBe('u-b');
  });
});
