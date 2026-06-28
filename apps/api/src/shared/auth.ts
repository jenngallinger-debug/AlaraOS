/**
 * Alara OS API — Transport Authentication (development boundary)
 *
 * Establishes the authenticated caller ("principal") from the request transport.
 * This is a MINIMAL development/test boundary — NOT real authentication: the
 * authenticated actor is taken from the `x-actor-id` request header. There is no
 * login, no session, and no JWT verification here. A real auth provider would
 * replace `authenticatePrincipal` (verifying a token/session) without changing the
 * downstream authorization path: the authenticated actor is what the
 * ConsentAuthorizer evaluates — never a body-supplied field.
 *
 * Identity & tenant boundary — SLICE 1 (Principal abstraction, legacy mode only).
 * See docs/architecture/identity-tenant-boundary.md. This introduces a typed `Principal`
 * BEHIND the existing boundary with NO behavior change: `authenticatePrincipal` derives a
 * legacy principal purely from `x-actor-id`, and `getAuthenticatedActor` now returns the
 * principal's id (identical to the previous header read). Real claims — verified tenant
 * membership, roles, scopes, the system→scope mapping — are later slices; here they are
 * empty/inert and consumed by nothing.
 */

import { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';
import {
  isSystemActor, getAuthMode, getAuthIssuer, getAuthAudience, getAuthPublicKey,
} from './config';
import { verifyJwt } from './jwt';

export const ACTOR_HEADER = 'x-actor-id';

/** Scope granting privileged system operations (e.g. raw event append at `/commands/events`). */
export const SYSTEM_SCOPE = 'system:*';

/** The kind of caller. A configured system actor maps to `system`; other legacy actors `user`. */
export type PrincipalType = 'user' | 'service' | 'system' | 'external';

/**
 * The authenticated caller. In legacy mode the claims are intentionally minimal: tenant
 * membership/roles/scopes are empty and NOT yet enforced (tenant is still taken from the
 * request as today). The shape is forward-compatible with token-derived principals.
 */
export interface Principal {
  /** Stable id of the caller; becomes the engine `actor`. In legacy mode this is the actor id. */
  readonly principalId: string;
  readonly type: PrincipalType;
  /** Authorized tenant set (empty in legacy mode — no verified tenant binding yet). */
  readonly tenants: readonly string[];
  /** Coarse boundary roles (empty in legacy mode). */
  readonly roles: readonly string[];
  /** Capability scopes (empty in legacy mode; the system→scope mapping is a later slice). */
  readonly scopes: readonly string[];
  /** The raw `x-actor-id` this principal was derived from (legacy mode only). */
  readonly legacyActorId?: string;
}

/** Read a single header value, trimmed; undefined when absent/empty. */
export function getHeader(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build a legacy-mode Principal from a raw actor id (pure; no request needed). A configured
 * system actor (`ALARA_SYSTEM_ACTORS`) is mapped to `type: 'system'` and granted `SYSTEM_SCOPE`,
 * so the privileged-surface gate can authorize on scope rather than the raw actor string. This
 * is behavior-preserving: the same configured actors map to the same allow/deny decision, and
 * the env is read per request exactly as before. Tenants/roles remain empty in legacy mode.
 */
export function legacyPrincipal(actorId: string): Principal {
  const system = isSystemActor(actorId);
  return {
    principalId: actorId,
    type: system ? 'system' : 'user',
    tenants: [],
    roles: [],
    scopes: system ? [SYSTEM_SCOPE] : [],
    legacyActorId: actorId,
  };
}

/** Whether the principal carries the given capability scope. */
export function principalHasScope(principal: Principal, scope: string): boolean {
  return principal.scopes.includes(scope);
}

/** Extract the bearer token from the `Authorization: Bearer <jwt>` header, if present. */
export function getBearerToken(req: FastifyRequest): string | undefined {
  const raw = getHeader(req, 'authorization');
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1].trim() : undefined;
}

/** Legacy authentication: a principal derived from the `x-actor-id` header (or undefined). */
function legacyAuthenticate(req: FastifyRequest): Principal | undefined {
  const actorId = getHeader(req, ACTOR_HEADER);
  return actorId ? legacyPrincipal(actorId) : undefined;
}

/**
 * Token authentication: verify a bearer RS256 JWT into a `Principal`, or undefined when there is
 * no token, the auth config is incomplete, or verification fails. Pure verification lives in
 * jwt.ts; this only resolves config and adapts the result.
 */
function tokenAuthenticate(req: FastifyRequest): Principal | undefined {
  const token = getBearerToken(req);
  if (!token) return undefined;
  const issuer = getAuthIssuer();
  const audience = getAuthAudience();
  const publicKey = getAuthPublicKey();
  if (!issuer || !audience || !publicKey) return undefined; // unconfigured → no token principal
  const result = verifyJwt({ token, publicKey, issuer, audience });
  return result.valid ? result.principal : undefined;
}

/**
 * Authenticate the caller into a `Principal`, honoring `AUTH_MODE`:
 *   - `legacy` (default): `x-actor-id` only — byte-identical to the previous behavior.
 *   - `dual`: prefer a valid bearer-token principal; fall back to legacy `x-actor-id`.
 *   - `required`: a valid bearer-token principal is mandatory; legacy `x-actor-id` is NOT accepted.
 * Returns `undefined` when no acceptable principal is present (preserving "missing actor" → 401).
 *
 * NOTE: this populates verified claims (incl. `tenants`) but does NOT yet derive or enforce
 * tenant boundaries — that is a later slice. Tenant is still taken from the request.
 */
export function authenticatePrincipal(req: FastifyRequest): Principal | undefined {
  const mode = getAuthMode();
  if (mode === 'legacy') return legacyAuthenticate(req);

  const tokenPrincipal = tokenAuthenticate(req);
  if (tokenPrincipal) return tokenPrincipal;
  if (mode === 'required') return undefined; // token mandatory; legacy not accepted
  return legacyAuthenticate(req);            // dual: fall back to legacy
}

/**
 * The authenticated actor id, or `undefined` if none. Now derived from the `Principal` so a
 * future token-based principal flows through unchanged; the returned value is byte-identical
 * to the previous direct `x-actor-id` read.
 */
export function getAuthenticatedActor(req: FastifyRequest): string | undefined {
  return authenticatePrincipal(req)?.principalId;
}

/**
 * Constant-time secret comparison for webhook verification. Fails closed when either
 * side is absent or the lengths differ. (MVP shared-secret check — a production vendor
 * integration would HMAC the raw request body instead.)
 */
export function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
