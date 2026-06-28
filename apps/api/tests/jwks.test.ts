/**
 * Alara OS API — JWKS cache/fetcher (identity boundary, JWKS slice 2 — pure, unwired)
 *
 * Dependency-free: real RSA keypairs are generated with Node `crypto`, JWKS documents are built
 * from their public-JWK export, and a FAKE injected fetcher + injected clock drive the cache.
 * No real network. Also proves the resolver plugs into the Slice-20 `verifyJwt` seam.
 */

import { generateKeyPairSync, createSign, KeyObject } from 'crypto';
import { JwksCache, parseJwks, JwksFetcher } from '../src/shared/jwks';
import { verifyJwt } from '../src/shared/jwt';

interface KeyPair { kid: string; privateKey: KeyObject; jwk: Record<string, unknown>; }

function makeKey(kid: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { kid, privateKey, jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } };
}

/** A JWKS document `{ keys: [...] }` from the given keys. */
const jwks = (...keys: KeyPair[]) => ({ keys: keys.map((k) => k.jwk) });

type CountingFetcher = JwksFetcher & { calls: number };
/** A fake fetcher returning a sequence of responses (or throwing for an Error value). Counts calls. */
function fakeFetcher(...responses: unknown[]): CountingFetcher {
  const fn: CountingFetcher = Object.assign(
    async (_url: string): Promise<unknown> => {
      const r = responses[Math.min(fn.calls, responses.length - 1)];
      fn.calls += 1;
      if (r instanceof Error) throw r;
      return r;
    },
    { calls: 0 },
  );
  return fn;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ISSUER = 'https://issuer.test/alara';
const AUDIENCE = 'alara-api';

/** Sign a token (kid in header) with the keypair's private key. */
function mintToken(kp: KeyPair): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: kp.kid }));
  const payload = b64url(JSON.stringify({ sub: 'u1', iss: ISSUER, aud: AUDIENCE, exp: nowSec + 600, iat: nowSec }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(kp.privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

// ─── parseJwks (pure) ──────────────────────────────────────────────────────────

describe('parseJwks', () => {
  test('parses RSA signing keys, indexed by kid', () => {
    const a = makeKey('a'); const b = makeKey('b');
    const out = parseJwks(jwks(a, b))!;
    expect(out.size).toBe(2);
    expect(out.get('a')!.asymmetricKeyType).toBe('rsa');
  });

  test('malformed documents return undefined (→ keep last-known-good)', () => {
    expect(parseJwks(null)).toBeUndefined();
    expect(parseJwks('nope')).toBeUndefined();
    expect(parseJwks({ notKeys: 1 })).toBeUndefined();
  });

  test('ignores non-RSA / non-signing / non-RS256 / keyless / non-RSA-param entries', () => {
    const ok = makeKey('ok');
    const ecKey = { kty: 'EC', kid: 'ec', crv: 'P-256', x: 'a', y: 'b' };
    const encKey = { ...makeKey('enc').jwk, use: 'enc' };
    const wrongAlg = { ...makeKey('rs512').jwk, alg: 'RS512' };
    const noKid = { ...makeKey('x').jwk }; delete (noKid as Record<string, unknown>).kid;
    const missingParams = { kty: 'RSA', kid: 'bad', use: 'sig', alg: 'RS256' }; // no n/e → skipped pre-import
    const out = parseJwks({ keys: [ok.jwk, ecKey, encKey, wrongAlg, noKid, missingParams] })!;
    expect([...out.keys()]).toEqual(['ok']); // only the valid RSA signing key
  });
});

// ─── JwksCache ─────────────────────────────────────────────────────────────────

describe('JwksCache', () => {
  let clock: number;
  const now = () => clock;
  beforeEach(() => { clock = 0; });

  test('successful fetch populates the resolver; known kid resolves, unknown → undefined', async () => {
    const a = makeKey('a');
    const cache = new JwksCache({ url: 'x', fetcher: fakeFetcher(jwks(a)), now });
    await cache.refresh();
    expect(cache.size()).toBe(1);
    expect(cache.resolve('a')).toBeInstanceOf(KeyObject);
    expect(cache.resolve('missing')).toBeUndefined();
  });

  test('resolver() output verifies a token signed by the matching private key (plugs into verifyJwt)', async () => {
    const a = makeKey('a');
    const cache = new JwksCache({ url: 'x', fetcher: fakeFetcher(jwks(a)), now });
    await cache.refresh();
    const r = verifyJwt({ token: mintToken(a), resolveKey: cache.resolver(), issuer: ISSUER, audience: AUDIENCE });
    expect(r.valid).toBe(true);
  });

  test('resolver is SYNCHRONOUS (returns a KeyObject, not a Promise)', async () => {
    const a = makeKey('a');
    const cache = new JwksCache({ url: 'x', fetcher: fakeFetcher(jwks(a)), now });
    await cache.refresh();
    const got = cache.resolve('a');
    expect(got).toBeInstanceOf(KeyObject);
    expect((got as unknown as { then?: unknown }).then).toBeUndefined();
  });

  test('expired cache (TTL) triggers a refresh through the injected fetcher', async () => {
    const a = makeKey('a');
    const fetcher = fakeFetcher(jwks(a), jwks(a));
    const cache = new JwksCache({ url: 'x', fetcher, ttlMs: 1000, minRefreshIntervalMs: 0, now });
    await cache.refresh();                 // t=0 → fetch #1
    expect(fetcher.calls).toBe(1);
    clock = 500; await cache.maybeRefresh(); // fresh → no fetch
    expect(fetcher.calls).toBe(1);
    clock = 1500; await cache.maybeRefresh(); // stale → fetch #2
    expect(fetcher.calls).toBe(2);
  });

  test('fetch failure preserves last-known-good', async () => {
    const a = makeKey('a');
    const fetcher = fakeFetcher(jwks(a), new Error('network down'));
    const cache = new JwksCache({ url: 'x', fetcher, ttlMs: 0, minRefreshIntervalMs: 0, now });
    await cache.refresh();                 // ok → cache {a}
    clock = 100; await cache.refresh();    // throws → keep last-known-good
    expect(cache.resolve('a')).toBeInstanceOf(KeyObject);
  });

  test('malformed JWKS response preserves last-known-good (fails safe)', async () => {
    const a = makeKey('a');
    const fetcher = fakeFetcher(jwks(a), { garbage: true });
    const cache = new JwksCache({ url: 'x', fetcher, ttlMs: 0, minRefreshIntervalMs: 0, now });
    await cache.refresh();
    clock = 100; await cache.refresh();    // malformed → keep {a}
    expect(cache.resolve('a')).toBeInstanceOf(KeyObject);
  });

  test('key rotation: new kid added, overlap preserved, then old kid retired', async () => {
    const a = makeKey('a'); const b = makeKey('b');
    const fetcher = fakeFetcher(jwks(a), jwks(a, b), jwks(b));
    const cache = new JwksCache({ url: 'x', fetcher, ttlMs: 0, minRefreshIntervalMs: 0, now });
    await cache.refresh();                          // {a}
    expect(cache.resolve('a')).toBeDefined();
    clock = 1; await cache.refresh();               // overlap {a,b}
    expect(cache.resolve('a')).toBeDefined();
    expect(cache.resolve('b')).toBeDefined();
    clock = 2; await cache.refresh();               // {b} — old key retired
    expect(cache.resolve('a')).toBeUndefined();
    expect(cache.resolve('b')).toBeDefined();
  });

  test('min-interval throttle prevents fetch storms', async () => {
    const a = makeKey('a');
    const fetcher = fakeFetcher(jwks(a), jwks(a), jwks(a));
    const cache = new JwksCache({ url: 'x', fetcher, ttlMs: 0, minRefreshIntervalMs: 1000, now });
    await cache.maybeRefresh();             // t=0 → fetch #1
    await cache.maybeRefresh();             // t=0 → throttled
    await cache.refresh();                  // t=0 → throttled
    expect(fetcher.calls).toBe(1);
    clock = 1000; await cache.maybeRefresh(); // throttle window passed → fetch #2
    expect(fetcher.calls).toBe(2);
  });

  test('no-kid resolution: single key returns it; ambiguous (multiple) / empty → undefined', async () => {
    const a = makeKey('a'); const b = makeKey('b');
    const single = new JwksCache({ url: 'x', fetcher: fakeFetcher(jwks(a)), now });
    await single.refresh();
    expect(single.resolve()).toBeInstanceOf(KeyObject); // exactly one → return it

    const multi = new JwksCache({ url: 'x', fetcher: fakeFetcher(jwks(a, b)), now });
    await multi.refresh();
    expect(multi.resolve()).toBeUndefined();            // ambiguous → undefined

    const empty = new JwksCache({ url: 'x', fetcher: fakeFetcher({ keys: [] }), now });
    await empty.refresh();
    expect(empty.resolve()).toBeUndefined();            // empty → undefined
  });
});
