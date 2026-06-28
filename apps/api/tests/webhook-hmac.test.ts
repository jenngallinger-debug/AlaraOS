/**
 * Alara OS API — Automynd webhook HMAC verifier + config (decision-packet slice 2)
 *
 * Pure unit tests. The verifier is NOT wired into the route yet, so these assert the helper
 * and config parsing in isolation: valid/invalid signatures, timestamp tolerance, malformed
 * headers, key rotation by kid, and config defaults/invalid values.
 */

import {
  parseSignatureHeader, computeWebhookSignature, verifyWebhookSignature,
} from '../src/shared/webhook-hmac';
import {
  parseWebhookKeys, getWebhookKeys, getWebhookTimestampToleranceSec, getWebhookHmacMode,
} from '../src/shared/config';

const RAW = '{"eventType":"patient.observed","tenantId":"t","payload":{"a":1}}';
const NOW = 1_700_000_000;          // fixed "now" (unix seconds)
const TOL = 300;
const SECRET_A = 'whsec_aaa';
const SECRET_B = 'whsec_bbb';

/** Build a signature header for the given secret/timestamp/body (+ optional kid). */
function sign(secret: string, opts: { t?: number; kid?: string; body?: string } = {}): string {
  const t = opts.t ?? NOW;
  const v1 = computeWebhookSignature(secret, t, opts.body ?? RAW);
  return `t=${t},v1=${v1}` + (opts.kid ? `,kid=${opts.kid}` : '');
}

const keysAB = () => new Map([['k1', SECRET_A], ['k2', SECRET_B]]);
const verify = (header: string | undefined, over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) =>
  verifyWebhookSignature({ header, rawBody: RAW, keys: keysAB(), toleranceSec: TOL, nowSec: NOW, ...over });

// ─── Header parsing ───────────────────────────────────────────────────────────

describe('parseSignatureHeader', () => {
  test('parses t, v1, kid (order-independent, ignores unknown elements)', () => {
    const p = parseSignatureHeader('kid=k2, v1=deadBEEF, t=42, foo=bar');
    expect(p).toEqual({ timestamp: 42, v1: 'deadBEEF', kid: 'k2' });
  });
  test('kid is optional', () => {
    expect(parseSignatureHeader('t=42,v1=ab')).toEqual({ timestamp: 42, v1: 'ab', kid: undefined });
  });
  test.each([
    ['undefined', undefined],
    ['empty', ''],
    ['missing t', 'v1=abcd'],
    ['non-integer t', 't=12.5,v1=abcd'],
    ['non-numeric t', 't=soon,v1=abcd'],
    ['missing v1', 't=42'],
    ['non-hex v1', 't=42,v1=zzzz'],
    ['garbage', 'not-a-signature'],
  ])('returns null for malformed header: %s', (_label, header) => {
    expect(parseSignatureHeader(header as string | undefined)).toBeNull();
  });
});

// ─── Signature verification ───────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  test('valid signature with matching kid → valid', () => {
    const res = verify(sign(SECRET_A, { kid: 'k1' }));
    expect(res).toEqual({ valid: true, kid: 'k1' });
  });

  test('valid signature without kid → tries all keys, matches', () => {
    const res = verify(sign(SECRET_B)); // no kid; k2 secret
    expect(res).toEqual({ valid: true, kid: 'k2' });
  });

  test('wrong secret → signature_mismatch', () => {
    const res = verify(sign('whsec_wrong', { kid: 'k1' }));
    expect(res).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  test('tampered raw body → signature_mismatch', () => {
    const header = sign(SECRET_A, { kid: 'k1' });           // signed over RAW
    const res = verify(header, { rawBody: RAW + ' ' });     // body changed by one byte
    expect(res).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  test('tampered timestamp WITHIN tolerance → signature_mismatch (t is signed)', () => {
    const header = sign(SECRET_A, { kid: 'k1', t: NOW });
    const tampered = header.replace(`t=${NOW}`, `t=${NOW + 10}`); // still within ±300, but signature was over NOW
    const res = verify(tampered);
    expect(res).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  test('expired timestamp (too old) → timestamp_out_of_tolerance', () => {
    const res = verify(sign(SECRET_A, { kid: 'k1', t: NOW - (TOL + 1) }));
    expect(res).toEqual({ valid: false, reason: 'timestamp_out_of_tolerance' });
  });

  test('future timestamp beyond tolerance → timestamp_out_of_tolerance', () => {
    const res = verify(sign(SECRET_A, { kid: 'k1', t: NOW + (TOL + 1) }));
    expect(res).toEqual({ valid: false, reason: 'timestamp_out_of_tolerance' });
  });

  test('exactly at the tolerance boundary is accepted', () => {
    const res = verify(sign(SECRET_A, { kid: 'k1', t: NOW - TOL }));
    expect(res).toEqual({ valid: true, kid: 'k1' });
  });

  test('malformed header → malformed_header', () => {
    expect(verify('garbage')).toEqual({ valid: false, reason: 'malformed_header' });
  });

  test('unknown kid → unknown_kid (no fallback to other keys when kid is named)', () => {
    // Signed correctly with SECRET_A but names a kid that is not configured.
    const header = sign(SECRET_A, { kid: 'k-unknown' });
    expect(verify(header)).toEqual({ valid: false, reason: 'unknown_kid' });
  });

  test('no keys configured → no_keys_configured', () => {
    const res = verify(sign(SECRET_A, { kid: 'k1' }), { keys: new Map() });
    expect(res).toEqual({ valid: false, reason: 'no_keys_configured' });
  });

  test('uppercase hex signature still verifies (case-insensitive)', () => {
    const header = sign(SECRET_A, { kid: 'k1' }).replace(/v1=([0-9a-f]+)/, (_m, h) => `v1=${h.toUpperCase()}`);
    expect(verify(header)).toEqual({ valid: true, kid: 'k1' });
  });
});

// ─── Key rotation ─────────────────────────────────────────────────────────────

describe('key rotation', () => {
  test('during overlap (both keys active), a signature under EITHER key verifies', () => {
    expect(verify(sign(SECRET_A, { kid: 'k1' })).valid).toBe(true);
    expect(verify(sign(SECRET_B, { kid: 'k2' })).valid).toBe(true);
  });

  test('after the old key is removed, its signatures stop verifying', () => {
    const onlyNew = new Map([['k2', SECRET_B]]);
    // Old key named explicitly → unknown_kid; old key with no kid → mismatch (not in keyset).
    expect(verify(sign(SECRET_A, { kid: 'k1' }), { keys: onlyNew })).toEqual({ valid: false, reason: 'unknown_kid' });
    expect(verify(sign(SECRET_A), { keys: onlyNew })).toEqual({ valid: false, reason: 'signature_mismatch' });
    // New key still works.
    expect(verify(sign(SECRET_B, { kid: 'k2' }), { keys: onlyNew })).toEqual({ valid: true, kid: 'k2' });
  });

  test('uniform failure reason: wrong secret and tampered body both report signature_mismatch', () => {
    const wrongSecret = verify(sign('nope', { kid: 'k1' }));
    const tamperedBody = verify(sign(SECRET_A, { kid: 'k1' }), { rawBody: 'different' });
    expect(wrongSecret).toEqual({ valid: false, reason: 'signature_mismatch' });
    expect(tamperedBody).toEqual({ valid: false, reason: 'signature_mismatch' });
  });
});

// ─── Config parsing ───────────────────────────────────────────────────────────

describe('parseWebhookKeys', () => {
  test('parses comma-separated kid:secret pairs', () => {
    expect(parseWebhookKeys('k1:sa, k2:sb')).toEqual(new Map([['k1', 'sa'], ['k2', 'sb']]));
  });
  test('secret may contain colons (split on first colon only)', () => {
    expect(parseWebhookKeys('k1:abc:def')).toEqual(new Map([['k1', 'abc:def']]));
  });
  test('skips malformed entries (no colon, empty kid, empty secret) and blanks', () => {
    expect(parseWebhookKeys('nocolon, :nokid, k3:, , k4:sd')).toEqual(new Map([['k4', 'sd']]));
  });
  test('duplicate kid takes the last value', () => {
    expect(parseWebhookKeys('k1:first,k1:second')).toEqual(new Map([['k1', 'second']]));
  });
  test('empty string → empty map', () => {
    expect(parseWebhookKeys('').size).toBe(0);
  });
});

describe('webhook config env helpers', () => {
  const KEYS = ['AUTOMYND_WEBHOOK_KEYS', 'WEBHOOK_TIMESTAMP_TOLERANCE_SEC', 'WEBHOOK_HMAC_MODE'] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => { saved = {}; for (const k of KEYS) saved[k] = process.env[k]; });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test('getWebhookKeys reads AUTOMYND_WEBHOOK_KEYS', () => {
    process.env.AUTOMYND_WEBHOOK_KEYS = 'k1:sa,k2:sb';
    expect(getWebhookKeys()).toEqual(new Map([['k1', 'sa'], ['k2', 'sb']]));
  });
  test('getWebhookKeys defaults to empty', () => {
    delete process.env.AUTOMYND_WEBHOOK_KEYS;
    expect(getWebhookKeys().size).toBe(0);
  });

  test('timestamp tolerance default is 300', () => {
    delete process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
    expect(getWebhookTimestampToleranceSec()).toBe(300);
  });
  test('timestamp tolerance honors a valid value', () => {
    process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SEC = '120';
    expect(getWebhookTimestampToleranceSec()).toBe(120);
  });
  test.each(['0', '-5', 'abc', ''])('timestamp tolerance falls back to 300 for invalid %p', (val) => {
    process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SEC = val;
    expect(getWebhookTimestampToleranceSec()).toBe(300);
  });

  test('hmac mode default is off', () => {
    delete process.env.WEBHOOK_HMAC_MODE;
    expect(getWebhookHmacMode()).toBe('off');
  });
  test.each(['dual', 'required', 'OFF', 'Dual'])('hmac mode parses %p case-insensitively', (val) => {
    process.env.WEBHOOK_HMAC_MODE = val;
    expect(getWebhookHmacMode()).toBe(val.toLowerCase() === 'off' ? 'off' : val.toLowerCase());
  });
  test.each(['', 'on', 'true', 'garbage'])('hmac mode falls back to off for invalid %p', (val) => {
    process.env.WEBHOOK_HMAC_MODE = val;
    expect(getWebhookHmacMode()).toBe('off');
  });
});
