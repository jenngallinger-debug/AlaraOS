/**
 * Alara OS — ID Generation
 *
 * - AlaraId (objects): UUIDv4  (stable identity, no ordering semantics needed)
 * - EventId:           UUIDv7  (time-ordered, enables efficient range queries)
 *
 * Per OD-S2-2 (established in Sprint 2).
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { AlaraId, makeAlaraId } from './types';

// Re-export so callers can import makeAlaraId from this module
export { makeAlaraId } from './types';

/**
 * Derive a stable, UUID-shaped id from its parts (a deterministic v5-style id).
 * Same parts produce the same id — used for idempotency keys (e.g. a per-referral
 * receipt stream). Parts are JSON-encoded before hashing so they cannot ambiguously
 * concatenate. Pure `crypto`, no extra dependency.
 */
export function deterministicId(...parts: string[]): string {
  const h = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32).split('');
  h[12] = '5';                                               // version 5
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);  // RFC4122 variant
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Generate a new Alara object identity (UUIDv4). */
export function newAlaraId(): AlaraId {
  return makeAlaraId(uuidv4());
}

/**
 * Generate a time-ordered event ID (UUIDv7).
 *
 * UUIDv7 encodes a 48-bit millisecond timestamp in the high bits,
 * enabling chronological ordering without a separate timestamp column.
 *
 * Pure TS implementation — no native support needed.
 */
export function newEventId(): string {
  const now = BigInt(Date.now());

  const tsMsHigh = Number((now >> 16n) & 0xffffn);
  const tsMsLow  = Number(now & 0xffffn);
  const subMs    = Math.floor(Math.random() * 0x1000);
  const ver      = 0x7000 | subMs;
  const rand1    = Math.floor(Math.random() * 0x3fff) | 0x8000;
  const rand2    = Math.floor(Math.random() * 0xffffffffffff);

  const hex = [
    pad(tsMsHigh, 4),
    pad(tsMsLow, 4),
    pad(ver, 4),
    pad(rand1, 4),
    pad(rand2, 12),
  ].join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function pad(n: number, len: number): string {
  return n.toString(16).padStart(len, '0');
}
