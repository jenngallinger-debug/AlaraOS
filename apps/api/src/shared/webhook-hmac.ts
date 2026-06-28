/**
 * Alara OS API — Automynd webhook HMAC verifier (PURE; not yet wired)
 *
 * Implements decision-packet slice 2 (code-concordance UPDATE 22): verify an
 * `X-Automynd-Signature: t=<unix_seconds>,v1=<hex>,kid=<key-id>` header against the raw
 * request body. The signed value is the canonical string `"{timestamp}.{rawBody}"`, HMAC-
 * SHA256, hex-encoded, compared in constant time. Timestamp tolerance bounds replay.
 *
 * This module is deliberately PURE — it takes the header, raw body, keyset, and tolerance as
 * arguments (no Fastify, no `process.env`), so it is fully unit-testable. It is NOT called by
 * the webhook route yet; wiring (dual → required) is a later slice. Nothing here changes the
 * current shared-secret behavior.
 */

import { createHmac } from 'crypto';
import { secretsMatch } from './auth';

/** Parsed `X-Automynd-Signature` header elements. */
export interface ParsedSignatureHeader {
  /** Unix seconds the signature was produced. */
  readonly timestamp: number;
  /** Hex-encoded HMAC-SHA256 signature (the `v1` element). */
  readonly v1: string;
  /** Optional key id selecting which signing key to verify against. */
  readonly kid?: string;
}

export type WebhookVerifyFailureReason =
  | 'malformed_header'
  | 'no_keys_configured'
  | 'unknown_kid'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch';

export type WebhookVerifyResult =
  | { readonly valid: true; readonly kid?: string }
  | { readonly valid: false; readonly reason: WebhookVerifyFailureReason };

export interface VerifyWebhookOptions {
  /** Raw `X-Automynd-Signature` header value. */
  readonly header: string | undefined;
  /** The exact received request bytes (see raw-body.ts) — never a re-serialized object. */
  readonly rawBody: string;
  /** Active signing keys (kid → secret), e.g. from config.getWebhookKeys(). */
  readonly keys: Map<string, string>;
  /** Allowed clock skew in seconds (|now − t| must be ≤ this). */
  readonly toleranceSec: number;
  /** Current time in unix seconds; injectable for deterministic tests. */
  readonly nowSec?: number;
}

const HEX = /^[0-9a-f]+$/i;

/**
 * Parse `t=...,v1=...,kid=...` (order-independent; unknown elements ignored). Returns null
 * when the header is absent, `t` is not a non-negative integer, or `v1` is missing/non-hex.
 */
export function parseSignatureHeader(header: string | undefined): ParsedSignatureHeader | null {
  if (!header) return null;
  let t: number | undefined;
  let v1: string | undefined;
  let kid: string | undefined;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;                    // no key, or empty key
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      if (!/^\d+$/.test(value)) return null;  // t must be a non-negative integer
      t = Number(value);
    } else if (key === 'v1') {
      v1 = value;
    } else if (key === 'kid') {
      kid = value.length > 0 ? value : undefined;
    }
  }
  if (t === undefined || !Number.isFinite(t)) return null;
  if (!v1 || !HEX.test(v1)) return null;
  return { timestamp: t, v1, kid };
}

/** HMAC-SHA256(secret, `"{timestamp}.{rawBody}"`) as lowercase hex. */
export function computeWebhookSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Verify an Automynd webhook signature. Key resolution: a header `kid` must name a configured
 * key (else `unknown_kid`); an absent `kid` tries every active key (rotation overlap) and
 * accepts on the first constant-time match. Comparison uses `secretsMatch` (timing-safe).
 */
export function verifyWebhookSignature(opts: VerifyWebhookOptions): WebhookVerifyResult {
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return { valid: false, reason: 'malformed_header' };

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > opts.toleranceSec) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' };
  }

  if (opts.keys.size === 0) return { valid: false, reason: 'no_keys_configured' };

  let candidates: Array<[string, string]>;
  if (parsed.kid !== undefined) {
    const secret = opts.keys.get(parsed.kid);
    if (secret === undefined) return { valid: false, reason: 'unknown_kid' };
    candidates = [[parsed.kid, secret]];
  } else {
    candidates = Array.from(opts.keys.entries());
  }

  const provided = parsed.v1.toLowerCase();
  for (const [kid, secret] of candidates) {
    const expected = computeWebhookSignature(secret, parsed.timestamp, opts.rawBody);
    if (secretsMatch(provided, expected)) {
      return { valid: true, kid };
    }
  }
  return { valid: false, reason: 'signature_mismatch' };
}
