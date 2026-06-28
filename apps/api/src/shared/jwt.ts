/**
 * Alara OS API — RS256 JWT verification (PURE, dependency-free)
 *
 * Verifies an RS256 JWT against a configured public key and maps its claims onto a `Principal`.
 * Dependency-free (Node `crypto` only — no jsonwebtoken/jose), consistent with the webhook-HMAC
 * and rate-limit slices. VENDOR-NEUTRAL: it verifies a standard RS256 token against whatever
 * public key / issuer / audience is configured — no IdP vendor is named or assumed.
 *
 * Security posture:
 *   - ONLY `alg: RS256` is accepted; `none`, HS256, and any other alg are rejected
 *     (no algorithm-confusion attack).
 *   - Signature is verified BEFORE any claim is trusted.
 *   - `exp` is required; `iss`/`aud` must match; `nbf` honored when present.
 *
 * This module is PURE (token + key + iss/aud + clock in, result out — no Fastify, no env), so it
 * is fully unit-testable. Wiring into `authenticatePrincipal` lives in auth.ts.
 */

import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import type { Principal, PrincipalType } from './auth';

export type TokenVerifyFailureReason =
  | 'malformed'
  | 'unsupported_alg'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'invalid_claims';

export type TokenVerifyResult =
  | { readonly valid: true; readonly principal: Principal }
  | { readonly valid: false; readonly reason: TokenVerifyFailureReason };

export interface TokenVerifyOptions {
  /** The raw JWT (no `Bearer ` prefix). */
  readonly token: string;
  /** RS256 public key — PEM string or a crypto KeyObject. */
  readonly publicKey: string | KeyObject;
  /** Expected `iss`. */
  readonly issuer: string;
  /** Expected `aud` (must be present in the token's audience). */
  readonly audience: string;
  /** Current time in unix seconds; injectable for deterministic tests. */
  readonly nowSec?: number;
}

const PRINCIPAL_TYPES: ReadonlySet<string> = new Set(['user', 'service', 'system', 'external']);

function b64urlToBuffer(seg: string): Buffer {
  return Buffer.from(seg, 'base64url');
}

function decodeJson(seg: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(b64urlToBuffer(seg).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Normalize a claim into a string[] (drops non-strings; accepts a single string). */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

/** Scopes come from `scope` (space-delimited, OAuth-style) or `scopes` (array). */
function parseScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload['scope'] === 'string') {
    return (payload['scope'] as string).split(/\s+/).filter((s) => s.length > 0);
  }
  return asStringArray(payload['scopes']);
}

/**
 * Verify an RS256 JWT and map it to a `Principal`. Returns a typed failure reason rather than
 * throwing, so the caller (auth.ts) can decide policy (fall back to legacy vs reject).
 */
export function verifyJwt(opts: TokenVerifyOptions): TokenVerifyResult {
  const parts = opts.token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [headerSeg, payloadSeg, signatureSeg] = parts;

  const header = decodeJson(headerSeg);
  if (!header) return { valid: false, reason: 'malformed' };
  if (header['alg'] !== 'RS256') return { valid: false, reason: 'unsupported_alg' };

  const payload = decodeJson(payloadSeg);
  if (!payload) return { valid: false, reason: 'malformed' };

  // Signature first — never trust claims from an unverified token.
  let key: KeyObject;
  try {
    key = typeof opts.publicKey === 'string' ? createPublicKey(opts.publicKey) : opts.publicKey;
  } catch {
    return { valid: false, reason: 'bad_signature' }; // unusable key → cannot verify → reject
  }
  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerSeg}.${payloadSeg}`),
      key,
      b64urlToBuffer(signatureSeg),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { valid: false, reason: 'bad_signature' };

  // Registered-claim validation (only after a good signature).
  if (payload['iss'] !== opts.issuer) return { valid: false, reason: 'issuer_mismatch' };

  const aud = payload['aud'];
  const audOk = Array.isArray(aud) ? aud.includes(opts.audience) : aud === opts.audience;
  if (!audOk) return { valid: false, reason: 'audience_mismatch' };

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof payload['exp'] !== 'number') return { valid: false, reason: 'invalid_claims' };
  if (now >= (payload['exp'] as number)) return { valid: false, reason: 'expired' };
  if (typeof payload['nbf'] === 'number' && now < (payload['nbf'] as number)) {
    return { valid: false, reason: 'not_yet_valid' };
  }

  const sub = payload['sub'];
  if (typeof sub !== 'string' || sub.length === 0) return { valid: false, reason: 'invalid_claims' };

  const rawType = payload['principal_type'];
  const type: PrincipalType =
    typeof rawType === 'string' && PRINCIPAL_TYPES.has(rawType) ? (rawType as PrincipalType) : 'user';

  const principal: Principal = {
    principalId: sub,
    type,
    tenants: asStringArray(payload['tenants']),
    roles: asStringArray(payload['roles']),
    scopes: parseScopes(payload),
    // no legacyActorId — this is a verified token principal, not a legacy one
  };
  return { valid: true, principal };
}
