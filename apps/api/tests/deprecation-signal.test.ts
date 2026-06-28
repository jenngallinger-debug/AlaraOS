/**
 * Alara OS API — legacy auth fallback deprecation signal (identity boundary)
 *
 * In AUTH_MODE=dual, when no valid token principal is available and the legacy x-actor-id fallback
 * admits the request, a PHI-safe deprecation signal is emitted. No signal in legacy mode, when a
 * valid token is used, or in required mode (legacy is rejected). The signal carries only bounded,
 * non-sensitive metadata — never the token, headers, body, tenantId, or PHI.
 *
 * Dependency-free: an RS256 keypair signs tokens; a captured sink (setDeprecationSinkForTests)
 * records emissions deterministically — no console spying, no network.
 */

import { generateKeyPairSync, createSign } from 'crypto';
import { FastifyRequest } from 'fastify';
import { authenticatePrincipal } from '../src/shared/auth';
import { setDeprecationSinkForTests, DeprecationSignal } from '../src/shared/deprecation';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUER = 'https://issuer.test/alara';
const AUDIENCE = 'alara-api';
const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A valid RS256 token carrying a tenant (to prove the tenant never appears in the signal). */
function validToken(): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: 'tok-user', iss: ISSUER, aud: AUDIENCE, exp: nowSec + 600, iat: nowSec, tenants: ['secret-tenant'] }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

const reqWith = (headers: Record<string, string>) => ({ headers } as unknown as FastifyRequest);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const ENV = ['AUTH_MODE', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_PUBLIC_KEY'] as const;
let saved: Record<string, string | undefined>;
let captured: DeprecationSignal[];

beforeEach(() => {
  saved = {}; for (const k of ENV) saved[k] = process.env[k];
  process.env.AUTH_ISSUER = ISSUER;
  process.env.AUTH_AUDIENCE = AUDIENCE;
  process.env.AUTH_PUBLIC_KEY = PEM;
  captured = [];
  setDeprecationSinkForTests((s) => { captured.push(s); });
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  setDeprecationSinkForTests(undefined); // restore default sink
});

describe('legacy auth fallback deprecation signal', () => {
  test('legacy mode: no signal', () => {
    delete process.env.AUTH_MODE; // default legacy
    const p = authenticatePrincipal(reqWith({ 'x-actor-id': 'care-guide-1' }));
    expect(p!.principalId).toBe('care-guide-1');
    expect(captured).toHaveLength(0);
  });

  test('dual + valid token: no signal', () => {
    process.env.AUTH_MODE = 'dual';
    const p = authenticatePrincipal(reqWith({ ...bearer(validToken()), 'x-actor-id': 'ignored' }));
    expect(p!.principalId).toBe('tok-user'); // token wins
    expect(captured).toHaveLength(0);
  });

  test('dual + missing token + legacy actor: emits signal', () => {
    process.env.AUTH_MODE = 'dual';
    const p = authenticatePrincipal(reqWith({ 'x-actor-id': 'care-guide-1' }));
    expect(p!.principalId).toBe('care-guide-1'); // decision unchanged: legacy admitted
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      event: 'auth.legacy_fallback', mode: 'dual', reason: 'legacy_actor_fallback', principalId: 'care-guide-1',
    });
  });

  test('dual + invalid token + legacy actor: emits signal', () => {
    process.env.AUTH_MODE = 'dual';
    const p = authenticatePrincipal(reqWith({ authorization: 'Bearer not.a.jwt', 'x-actor-id': 'care-guide-1' }));
    expect(p!.principalId).toBe('care-guide-1'); // invalid token → legacy fallback admitted
    expect(captured).toHaveLength(1);
    expect(captured[0].reason).toBe('legacy_actor_fallback');
  });

  test('dual + no token + NO legacy actor: no signal (nothing admitted, → 401 upstream)', () => {
    process.env.AUTH_MODE = 'dual';
    const p = authenticatePrincipal(reqWith({}));
    expect(p).toBeUndefined();
    expect(captured).toHaveLength(0);
  });

  test('required mode: missing/invalid token does not emit a fallback signal and still rejects', () => {
    process.env.AUTH_MODE = 'required';
    const missing = authenticatePrincipal(reqWith({ 'x-actor-id': 'care-guide-1' }));
    const invalid = authenticatePrincipal(reqWith({ authorization: 'Bearer bad', 'x-actor-id': 'care-guide-1' }));
    expect(missing).toBeUndefined();
    expect(invalid).toBeUndefined();
    expect(captured).toHaveLength(0); // legacy rejected in required → no fallback signal
  });

  test('signal contains NO token / headers / body / tenant / PHI', () => {
    process.env.AUTH_MODE = 'dual';
    const tok = validToken();
    // Provide an (ignored) invalid token + actor that triggers fallback; ensure none of the
    // sensitive material leaks into the signal.
    authenticatePrincipal(reqWith({ authorization: `Bearer ${tok}.tampered`, 'x-actor-id': 'care-guide-1' }));
    expect(captured).toHaveLength(1);
    const sig = captured[0];
    // Only the four bounded fields exist.
    expect(Object.keys(sig).sort()).toEqual(['event', 'mode', 'principalId', 'reason']);
    const serialized = JSON.stringify(sig);
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('secret-tenant');     // tenant claim absent
    expect(serialized).not.toContain('eyJ');                // no JWT segment
    expect(serialized).not.toContain('authorization');
  });

  test('principalId is length-bounded (defensive against oversized header input)', () => {
    process.env.AUTH_MODE = 'dual';
    const huge = 'a'.repeat(500);
    authenticatePrincipal(reqWith({ 'x-actor-id': huge }));
    expect(captured).toHaveLength(1);
    expect(captured[0].principalId!.length).toBeLessThanOrEqual(65); // 64 + ellipsis
    expect(captured[0].principalId!.endsWith('…')).toBe(true);
  });
});
