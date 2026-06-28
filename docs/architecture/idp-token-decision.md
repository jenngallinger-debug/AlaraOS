# AlaraOS — IdP / Token Strategy (OWNER DECISION PACKET — design only, NOT implemented)

> **Status: DESIGN ONLY — decision-forcing.** No runtime change. This is the single owner
> decision that unblocks the remaining security-closing identity slices. Companion to
> `identity-tenant-boundary.md` (the architecture packet, UPDATE 26) and `tenancy-rls.md`.

## 1. Current identity state (what already exists)

- **Principal abstraction (legacy mode).** `authenticatePrincipal(req)` (`apps/api/src/shared/auth.ts`)
  derives a typed `Principal { principalId, type, tenants[], roles[], scopes[], legacyActorId }`
  from the `x-actor-id` header. `getAuthenticatedActor` returns `principal.principalId`
  (byte-identical to the old header read).
- **System actor is scope-gated** (UPDATE 28): `/commands/events` authorizes on
  `principalHasScope(principal, 'system:*')`; configured `ALARA_SYSTEM_ACTORS` get that scope.
- **But the claims are NOT verified.** In legacy mode `tenants`/`roles` are empty and the
  `principalId` is self-asserted. REST mutating commands require *a* principal (401 if absent);
  the GraphQL gate requires *a* principal but checks neither tenant nor roles; **`tenantId` is a
  client-supplied REST body field / GraphQL argument**; RLS is inert (`tenancy-rls.md`).
- **`x-actor-id` is spoofable** — any caller can claim any id, including a configured system actor.

The plumbing is ready; the **trusted claims source** is the missing piece.

## 2. Why implementation is blocked without an IdP / token decision

The `Principal` shape is forward-compatible, but populating it with **verified** claims requires a
credential whose issuer we trust. The IdP/token choice determines, all at once:

- **How `authenticatePrincipal` verifies** — JWKS public-key (OIDC/RS256), shared secret (HS256),
  or a server-side session lookup.
- **Which claims are available** and their names (tenant, roles, scopes, type).
- **How humans log in** (frontend) and **how machine/system callers get credentials**.
- **Key management & rotation** (own it vs. provider-managed).

Slices 2 (token dual-mode), 3 (tenant derivation), 5 (GraphQL tenant block), and the RLS
session-tenant **all read these verified claims**. Building any of them against a guessed
mechanism risks rework. One decision now de-risks the whole chain.

## 3. Recommended short-term path

**Local/dev signed JWT, RS256, behind `authenticatePrincipal`, enabled via `AUTH_MODE=dual`.**
A tiny internal issuer (or a test-token factory) mints RS256 JWTs with the claim set in §7;
`authenticatePrincipal` verifies signature/`exp`/`aud` via a public key (JWKS-shaped) and builds a
verified `Principal`; absent a token it falls back to legacy `x-actor-id` (deprecation signal).
This unblocks Slices 2–3 and the test harness **without choosing a vendor**.

## 4. Recommended production path

**Managed OIDC provider (BAA-signed)** for staff SSO — short-lived access tokens + refresh, JWKS
rotation, MFA — plus **service tokens** for machine/system principals and (optionally)
**session cookies** layered on OIDC if the staff frontend is a browser app. Because the dev path
already uses **RS256 + JWKS**, production swaps the issuer/JWKS URL, **not** the verifier code.

## 5. Options comparison

| # | Option | Pros | Cons | AlaraOS fit |
|---|---|---|---|---|
| 1 | **Local/dev signed JWT** (self-issued HS/RS, verify in-process) | Fast; no vendor; full claim control; ideal for dev + test harness; same verify path as OIDC if RS256/JWKS | We own keys/rotation/user store/login UI; not a production IdP; no SSO/MFA | **Best short-term & test**; bridge to OIDC |
| 2 | **Managed OIDC** (Auth0 / Cognito / Clerk / WorkOS / Okta) | Production-grade; SSO/MFA/JWKS/rotation handled; BAA available; supports staff + future external portals | Vendor cost/lock-in; integration + tenant-claim mapping; network dependency | **Best for production** (staff identity) |
| 3 | **Session-cookie app auth** (server-side sessions, httpOnly) | Safe for browsers (no token in JS); easy revocation; CSRF-manageable | Stateful (session store); poor for service-to-service / partner APIs; still needs the claim model server-side | Good **iff** a browser staff app; complements, not replaces, tokens for machine callers |
| 4 | **API/service-token only** (long-lived keys / signed service tokens) | Simple for integrations (Automynd-style); no user login | No human identity, no SSO, no per-user audit; weak for staff PHI access | **Necessary but insufficient** — covers service/system, not human staff/external |

## 6. Recommendation for AlaraOS

**Two-track, sharing one verifier:**
1. **Short-term (now):** Option 1 — local/dev **RS256** JWT + test-token factory → unblock Slices
   2–3 and tests, no vendor decision required.
2. **Production:** Option 2 — **managed, BAA-signed OIDC** for staff; Option 4 — **service tokens**
   for machine/system principals (Automynd ingest, internal jobs, the `system:*` scope); Option 3 —
   **session cookies** layered on OIDC **only if** the staff frontend is a browser app.

**Decide RS256 + JWKS up front** so the cheap dev issuer and the eventual managed IdP verify through
the **same code path** (swap issuer/JWKS, not the verifier). External actors (family / patient /
referral source / physician / payer) arrive later as scoped OIDC identities / partner tokens mapped
onto ADR-014 participation edges. Rationale: AlaraOS already has the `Principal` shape and rich
policy-based AuthZ — the only gap is a trusted claims source, and a PHI system needs a BAA-capable
provider for production human identity.

## 7. Required token claims (→ `Principal`)

| Concept | JWT claim (suggested) | → Principal | Notes |
|---|---|---|---|
| subject / principal id | `sub` | `principalId` (engine `actor`) | stable, opaque |
| tenant ids | `tenants: string[]` (or `org`/`tid`) | `tenants` | the **authorized** tenant set; single value for single-tenant |
| roles | `roles: string[]` | `roles` | boundary RBAC |
| scopes | `scope` (space-delimited) or `scopes[]` | `scopes` | capability scopes incl. `system:*` |
| actor type | `principal_type` (`user|service|system|external`) | `type` | or derive from audience/scopes |
| standard verification | `iss`, `aud`, `exp`, `iat`, `nbf`, `kid` | — | verify signature + `exp` + `aud`; `kid` → JWKS key |

Minimum to start (Slice 2): `sub`, `exp`, `aud`, `iss`. Add `tenants` for Slice 3; `roles`/`scopes`
for broader RBAC; `principal_type` for clean typing.

## 8. How this unlocks the chain

- **`AUTH_MODE=dual`** — `authenticatePrincipal` verifies a token → builds a verified `Principal`
  from claims; falls back to legacy `x-actor-id` when no token (deprecation signal). No tenant
  enforcement yet → safe, additive, instantly reversible (`AUTH_MODE=legacy`).
- **Tenant derivation** — with a verified `tenants` claim, derive/validate the operative tenant
  from the principal instead of trusting the request body/argument.
- **GraphQL tenant block** — resolvers compare the requested `tenantId` against `principal.tenants`
  → 403 on mismatch (closes the UPDATE 19 cross-tenant gap).
- **RLS later** — the principal-derived tenant becomes `SET LOCAL app.tenant_id`
  (`tenancy-rls.md` §6). RLS needs a **trusted** tenant; only a verified principal provides one.

## 9. Implementation slices after owner approval

1. **Token verification + `AUTH_MODE`** (`legacy|dual|required`): verify behind
   `authenticatePrincipal`; test-token factory; deprecation signal on legacy path. Ship `dual`.
2. **Tenant derivation + cross-tenant block** (REST 403) for token principals.
3. **GraphQL tenant block** in resolvers (closes UPDATE 19).
4. **`required` mode** + remove legacy `x-actor-id` trust.
5. **(Separate track) RLS milestone** fed by the principal-derived tenant.
6. **(Later) external actor identities** onto participation edges.

## 10. Open decisions for the founder / product owner

1. **Production IdP vendor** (Auth0 / Cognito / Clerk / WorkOS / Okta) **+ BAA**, or self-host
   (Keycloak); budget.
2. **Staff frontend shape** — browser app (→ session-cookie option) vs API/SPA only (→ JWT).
3. **Tenant membership model** — single-tenant-per-user vs multi-tenant (orgs/MSOs); decides the
   `tenants` claim cardinality and whether a request may carry a validated tenant selector.
4. **Role taxonomy** (admin / clinician / care-guide / read-only) and mapping to ADR-014 roles.
5. **Signing** — RS256 + JWKS (recommended) vs HS256 shared secret (simpler dev only).
6. **Machine/system credentials** — client-credentials grant vs static service tokens vs mTLS.
7. **External-actor portals** — scope and timeline (family / patient / referral / physician / payer).
8. **HIPAA posture** — confirm the BAA requirement for the chosen provider.

## 11. Risks of delaying this decision

- **Top residual production blocker stays open:** `x-actor-id` remains spoofable → **impersonation**
  (including a configured system actor) and **cross-tenant PHI access** are both live. A spoofed
  actor even satisfies the ConsentAuthorizer, and a named `tenantId` bypasses isolation.
- **Cannot run real PHI in production** without verified identity + tenant binding.
- **Compounding rework:** Slices 2/3/5 and the RLS milestone all sit behind this; building them on a
  guessed mechanism risks redo.
- **RLS stays inert** — no trusted tenant source, so the database provides no backstop
  (`tenancy-rls.md`).
- **Weak compliance/audit posture** — no per-user authentication means a thin access-audit trail
  for a PHI system.

---

### Clear recommendation for the owner

**Approve RS256-based JWT as the verification mechanism now**, implemented short-term as a local/dev
issuer (+ test-token factory) so Slices 2–3 can begin immediately, with **managed BAA-signed OIDC**
as the production issuer (same verifier, swapped JWKS) and **service tokens** for machine/system
callers. The only decisions that truly gate *starting* Slice 2 are: (a) **RS256 + JWKS** as the
scheme, and (b) the **tenant membership model** (single vs multi-tenant) for the `tenants` claim. The
production vendor and frontend/session questions can be settled in parallel and do not block Slice 2.
