/**
 * Alara OS API — RS256 JWT verification + AUTH_MODE (identity boundary SLICE 2, dual-mode scaffold)
 *
 * Dependency-free: an RS256 keypair is generated and test tokens are signed with Node `crypto`.
 * Covers the pure verifier (claim mapping, iss/aud/exp/alg/signature failures) and the three
 * AUTH_MODE paths via authenticatePrincipal — while default (legacy) behavior is unchanged.
 */

import { generateKeyPairSync, createSign, KeyObject } from 'crypto';
import { FastifyRequest } from 'fastify';
import { verifyJwt } from '../src/shared/jwt';
import { authenticatePrincipal, getAuthenticatedActor } from '../src/shared/auth';

// ─── RS256 test-token factory (Node crypto only) ──────────────────────────────

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ISSUER = 'https://issuer.test/alara';
const AUDIENCE = 'alara-api';
const NOW = 1_700_000_000;

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Mint a signed RS256 JWT. `claims` overrides the default valid payload; `alg`/`key` for abuse cases. */
function mintToken(
  claims: Record<string, unknown> = {},
  opts: { alg?: string; key?: KeyObject; tamper?: boolean } = {},
): string {
  const header = { alg: opts.alg ?? 'RS256', typ: 'JWT' };
  const payload = {
    sub: 'user-123', iss: ISSUER, aud: AUDIENCE,
    exp: NOW + 600, iat: NOW,
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(signingInput).sign(opts.key ?? privateKey);
  const sigSeg = opts.tamper ? b64url(Buffer.alloc(256, 1)) : b64url(sig);
  return `${signingInput}.${sigSeg}`;
}

const verify = (token: string, nowSec = NOW) =>
  verifyJwt({ token, publicKey: PEM, issuer: ISSUER, audience: AUDIENCE, nowSec });

// ─── Pure verifier: success + claim mapping ───────────────────────────────────

describe('verifyJwt — valid token & claim mapping', () => {
  test('valid token maps sub/type/tenants/roles/scopes onto a Principal', () => {
    const token = mintToken({
      sub: 'clinician-7', principal_type: 'user',
      tenants: ['t-alara', 't-2'], roles: ['clinician', 'admin'],
      scope: 'read write system:*',
    });
    const r = verify(token);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.principal).toEqual({
      principalId: 'clinician-7',
      type: 'user',
      tenants: ['t-alara', 't-2'],
      roles: ['clinician', 'admin'],
      scopes: ['read', 'write', 'system:*'],
    });
    expect(r.principal.legacyActorId).toBeUndefined(); // token principal, not legacy
  });

  test('scopes accepted from a `scopes` array as well as a space-delimited `scope`', () => {
    const r = verify(mintToken({ scope: undefined, scopes: ['a', 'b'] }));
    expect(r.valid && r.principal.scopes).toEqual(['a', 'b']);
  });

  test('missing optional claims default to type=user and empty arrays', () => {
    const r = verify(mintToken());
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.principal.type).toBe('user');
    expect(r.principal.tenants).toEqual([]);
    expect(r.principal.roles).toEqual([]);
    expect(r.principal.scopes).toEqual([]);
  });

  test('an unknown principal_type falls back to user', () => {
    const r = verify(mintToken({ principal_type: 'wizard' }));
    expect(r.valid && r.principal.type).toBe('user');
  });

  test('aud may be an array containing the expected audience', () => {
    const r = verify(mintToken({ aud: ['other', AUDIENCE] }));
    expect(r.valid).toBe(true);
  });
});

// ─── Pure verifier: failure cases ─────────────────────────────────────────────

describe('verifyJwt — rejections', () => {
  test('expired token → expired', () => {
    const r = verify(mintToken({ exp: NOW - 1 }));
    expect(r).toEqual({ valid: false, reason: 'expired' });
  });

  test('not-yet-valid token (nbf in future) → not_yet_valid', () => {
    const r = verify(mintToken({ nbf: NOW + 100 }));
    expect(r).toEqual({ valid: false, reason: 'not_yet_valid' });
  });

  test('wrong issuer → issuer_mismatch', () => {
    expect(verify(mintToken({ iss: 'https://evil.test' }))).toEqual({ valid: false, reason: 'issuer_mismatch' });
  });

  test('wrong audience → audience_mismatch', () => {
    expect(verify(mintToken({ aud: 'someone-else' }))).toEqual({ valid: false, reason: 'audience_mismatch' });
  });

  test('missing exp → invalid_claims', () => {
    expect(verify(mintToken({ exp: undefined }))).toEqual({ valid: false, reason: 'invalid_claims' });
  });

  test('missing sub → invalid_claims', () => {
    expect(verify(mintToken({ sub: undefined }))).toEqual({ valid: false, reason: 'invalid_claims' });
  });

  test('alg none is rejected → unsupported_alg (no algorithm confusion)', () => {
    expect(verify(mintToken({}, { alg: 'none' }))).toEqual({ valid: false, reason: 'unsupported_alg' });
  });

  test('tampered signature → bad_signature', () => {
    expect(verify(mintToken({}, { tamper: true }))).toEqual({ valid: false, reason: 'bad_signature' });
  });

  test('signature from a DIFFERENT key → bad_signature', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(verify(mintToken({}, { key: other.privateKey }))).toEqual({ valid: false, reason: 'bad_signature' });
  });

  test('malformed token (not 3 segments) → malformed', () => {
    expect(verify('a.b')).toEqual({ valid: false, reason: 'malformed' });
  });
});

// ─── AUTH_MODE wiring via authenticatePrincipal ───────────────────────────────

describe('authenticatePrincipal — AUTH_MODE legacy/dual/required', () => {
  const KEYS = ['AUTH_MODE', 'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_PUBLIC_KEY'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {}; for (const k of KEYS) saved[k] = process.env[k];
    process.env.AUTH_ISSUER = ISSUER;
    process.env.AUTH_AUDIENCE = AUDIENCE;
    process.env.AUTH_PUBLIC_KEY = PEM;
  });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  const reqWith = (headers: Record<string, string>) => ({ headers } as unknown as FastifyRequest);
  const bearer = (claims: Record<string, unknown> = {}) => ({ authorization: `Bearer ${mintTokenNow(claims)}` });
  // Tokens for the wiring tests use real wall-clock time (authenticatePrincipal has no clock injection).
  function mintTokenNow(claims: Record<string, unknown> = {}): string {
    const nowSec = Math.floor(Date.now() / 1000);
    return mintToken({ exp: nowSec + 600, iat: nowSec, ...claims });
  }

  test('legacy (default): token is ignored, x-actor-id is used', () => {
    delete process.env.AUTH_MODE; // default legacy
    const p = authenticatePrincipal(reqWith({ ...bearer(), 'x-actor-id': 'care-guide-1' }));
    expect(p!.principalId).toBe('care-guide-1');
    expect(p!.legacyActorId).toBe('care-guide-1'); // legacy principal, not the token
  });

  test('legacy: a valid token alone yields NO principal (token path off)', () => {
    delete process.env.AUTH_MODE;
    expect(authenticatePrincipal(reqWith({ ...bearer() }))).toBeUndefined();
  });

  test('dual: a valid token populates a verified principal (preferred over legacy)', () => {
    process.env.AUTH_MODE = 'dual';
    const p = authenticatePrincipal(reqWith({ ...bearer({ sub: 'tok-1', tenants: ['t-a'] }), 'x-actor-id': 'legacy-actor' }));
    expect(p!.principalId).toBe('tok-1');        // token wins over the legacy header
    expect(p!.tenants).toEqual(['t-a']);
    expect(p!.legacyActorId).toBeUndefined();
  });

  test('dual: missing/invalid token falls back to legacy x-actor-id', () => {
    process.env.AUTH_MODE = 'dual';
    const noToken = authenticatePrincipal(reqWith({ 'x-actor-id': 'fallback-actor' }));
    expect(noToken!.principalId).toBe('fallback-actor');
    expect(noToken!.legacyActorId).toBe('fallback-actor');
    const badToken = authenticatePrincipal(reqWith({ authorization: 'Bearer not.a.jwt', 'x-actor-id': 'fallback-actor' }));
    expect(badToken!.principalId).toBe('fallback-actor'); // invalid token → legacy fallback
  });

  test('required: a valid token is accepted', () => {
    process.env.AUTH_MODE = 'required';
    const p = authenticatePrincipal(reqWith({ ...bearer({ sub: 'req-ok' }) }));
    expect(p!.principalId).toBe('req-ok');
  });

  test('required: missing or invalid token is rejected even with x-actor-id', () => {
    process.env.AUTH_MODE = 'required';
    expect(authenticatePrincipal(reqWith({ 'x-actor-id': 'legacy-actor' }))).toBeUndefined();
    expect(authenticatePrincipal(reqWith({ authorization: 'Bearer bad', 'x-actor-id': 'legacy-actor' }))).toBeUndefined();
  });

  test('getAuthenticatedActor reflects the token principal id in dual mode', () => {
    process.env.AUTH_MODE = 'dual';
    expect(getAuthenticatedActor(reqWith({ ...bearer({ sub: 'tok-actor' }) }))).toBe('tok-actor');
  });

  test('dual but unconfigured key → token ignored, legacy fallback (fail-safe)', () => {
    process.env.AUTH_MODE = 'dual';
    delete process.env.AUTH_PUBLIC_KEY; // incomplete config
    const p = authenticatePrincipal(reqWith({ ...bearer(), 'x-actor-id': 'legacy-actor' }));
    expect(p!.principalId).toBe('legacy-actor');
  });
});
