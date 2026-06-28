# AlaraOS — Identity & Tenant Boundary (DECISION PACKET — design only, NOT implemented)

> **Status: DESIGN ONLY.** No runtime change. Records the agreed design for the first
> production-grade identity + tenant boundary so the implementation slices can be approved
> and executed later. Complements `tenancy-rls.md` (DB backstop) and is distinct from
> `identity-resolution-spec.md` (patient matching — see §0).

## 0. Scope & terminology (read first — three different "identities")

This packet is about the **caller's identity (principal)**. Do not conflate it with:

- **Principal identity** *(this packet — MISSING today)* — the authenticated *caller* of the
  API: staff users, service integrations, system jobs, and future external actors.
- **Patient identity resolution** *(EXISTS — `identity-resolution-spec.md`)* — matching an
  Automynd patient to a canonical `Patient`. Out of scope here; the "no identity merge" hard
  stop refers to that, not to principals.
- **Participation/Workforce roles** *(EXISTS — ADR-014, `participation-policy.ts`)* — per-subject
  permissions attached to relationship edges (Actor/Owner/Covering/Stakeholder/Informed/None).
  This is the AuthZ substrate the authenticated principal will plug **into**.

## 1. Current behavior & gaps

**AuthN (authentication): effectively none.** `getAuthenticatedActor(req)` (`apps/api/src/shared/auth.ts`)
returns the trimmed `x-actor-id` request header verbatim. No login, no token, no session, no
signature. Any caller can claim any actor id.

**What is built on that unverified header:**
- REST mutating commands require *an* actor (else 401). `/commands/events` additionally requires
  `isSystemActor(actor)` (`ALARA_SYSTEM_ACTORS` env list, default `system`). `/commands/consent*`
  authorize the actor via `ConsentAuthorizer` → RulesEngine (participation/consent-authority).
- GraphQL gate (`graphql-gate.ts`) requires *an* actor (401 if absent) but checks neither tenant
  nor roles.
- The rich **policy-based AuthZ** (ParticipationPolicyModule, ConsentPolicyModule, AIAct,
  RetrievalPermissionGate, reasoning `authorized-context`) decides "may this actor read/write
  THIS subject" from graph facts — but it trusts the actor id it is handed.

**Tenant: client-supplied, unverified.** `tenantId` is a REST body field and a GraphQL query
argument. It is never derived from the caller. App-level `WHERE tenant_id` filters faithfully
serve whatever tenant the caller names; RLS is scaffolded but inert (`tenancy-rls.md`).

**Net gaps (the production blockers):**
1. **Impersonation** — spoof `x-actor-id` to act as anyone, including a `system` actor → unlocks
   the raw-event surface and satisfies ConsentAuthorizer (which trusts the id).
2. **Cross-tenant access** — name any `tenantId` to read/write another tenant's PHI (REST and
   GraphQL alike). The GraphQL case is the open item in `code-concordance.md` UPDATE 19.
3. **No principal model** — no users, service accounts, roles, scopes, or tenant membership; no
   verified claims to drive coarse authorization or RLS.

## 2. Threat model

| Threat | Today | After this boundary |
|---|---|---|
| Impersonate staff/system actor (spoof `x-actor-id`) | **Open** — header is the identity | Closed — actor comes from a verified token; `x-actor-id` no longer trusted |
| Cross-tenant read/write (name another `tenantId`) | **Open** — tenant is a client input | Closed — tenant derived/validated from principal claims at the boundary |
| Privilege escalation to `system` scope | **Open** — claim `x-actor-id: system` | Closed — system scope is a verified claim, not a string |
| Replay/stolen credential | N/A (no credential) | Bounded — short-lived tokens, expiry, JWKS rotation |
| Lateral movement after one tenant compromised | High (discipline-based filters) | Reduced; fully closed when RLS lands (this packet is its prerequisite) |

PHI exposure is the dominant risk: both gaps lead directly to unauthorized PHI access.

## 3. Proposed identity model

A **`Principal`** = the authenticated caller, carrying **verified claims** that replace the trust
currently placed in the raw header. The authenticated `principalId` becomes the `actor` handed to
engines — so the existing ConsentAuthorizer/participation policies keep working unchanged, now fed
a verified actor.

```
Principal {
  principalId: string         // stable id; becomes the engine `actor`
  type: 'user' | 'service' | 'system' | 'external'
  tenants: string[]           // tenant membership (authorized tenant set)
  roles: string[]             // coarse boundary roles (see §6)
  scopes: string[]            // capability scopes (e.g. 'system:raw-event')
}
```

- **`user`** — human staff (clinician, care-guide, admin). Authenticated via session/OIDC token;
  member of one or more tenants; carries boundary roles.
- **`service`** — machine integrations / internal jobs. Authenticated via client-credentials or
  mTLS; tenant-scoped or cross-tenant by explicit scope.
- **`system`** — privileged internal operations (e.g. raw event append). A service principal with
  a `system:*` scope. **Replaces `ALARA_SYSTEM_ACTORS`** (a verified scope, not an env string).
- **`external`** *(future)* — **family, referral source, physician, payer, patient**. Authenticated
  via constrained credentials (patient/family portal accounts, partner API keys, magic links).
  Crucially, external actors get access **through ADR-014 participation edges** (Stakeholder /
  Informed / Covering / role-scoped), **not** broad tenant roles. The participation layer already
  models exactly this — external actors are its intended consumers.

## 4. Tenant model

- **Derived from the principal, not the request.** For single-tenant `user`/`service` principals,
  the operative tenant is the principal's tenant; the request body/arg `tenantId` is **ignored**
  (or required to equal it).
- **Multi-tenant principals** (orgs/MSOs) may pass a tenant *selector*, validated to be ∈
  `principal.tenants`; an out-of-set value is rejected. Never an arbitrary tenant.
- **System / cross-tenant service** principals may name a tenant explicitly **only because a scope
  authorizes it** (e.g. the Automynd ingest path operating across tenants).
- **Cross-tenant blocking happens at the API boundary**, before engines/resolvers: reject any
  request whose target tenant ∉ `principal.tenants` (unless a cross-tenant scope is present).
  REST → 403; GraphQL → 403 (closes UPDATE 19). The body/arg `tenantId` loses its authority.
- **DB backstop:** the principal-derived tenant is the value fed to `SET LOCAL app.tenant_id` when
  RLS is enabled (`tenancy-rls.md` §6). **This packet is the prerequisite for real RLS** — RLS
  without a trusted tenant source would gate on a spoofable value.

## 5. AuthN recommendation

- **Short-term MVP:** signed bearer tokens (JWT) — either a minimal internal issuer or a managed
  OIDC provider. Verify signature, `exp`, and `aud` with a vetted library; extract
  `principalId`/`tenants`/`roles`/`scopes` claims. Implement *behind* `getAuthenticatedActor` so
  the downstream contract is unchanged. Keep `x-actor-id` working under a flag during migration
  (dual-accept; see §7), mirroring the webhook HMAC rollout.
- **Production:** managed OIDC IdP for staff SSO; short-lived access tokens + refresh; JWKS
  rotation; `service` via client-credentials or mTLS; `external` via scoped portal identities /
  partner keys.
- **Token vs session:** stateless JWT for service-to-service. For human staff, choose by frontend:
  a browser app → server-side sessions (httpOnly cookie) is often safer (no token in JS); an SPA
  → short-lived JWT + refresh. **Decision deferred to the frontend choice** (§11).
- **Do not** hand-roll JWT/crypto beyond a vetted library; do not own password storage if an IdP
  can.

## 6. AuthZ recommendation — two layers (keep the good one, add a coarse one)

1. **Coarse role/scope gate at the command boundary (NEW).** A fast allow/deny on
   `principal.roles`/`scopes` *before* the fine-grained policy runs — e.g. "only `admin`/`clinician`
   may capture consent", "only `system:raw-event` scope may raw-append". The current system-actor
   check becomes a **scope** check.
2. **Fine-grained policy-based AuthZ at the engine (EXISTS — keep).** The RulesEngine
   participation/consent policies decide per-subject access from graph facts. This is a strength;
   **do not replace it with crude RBAC** — RBAC gates *which commands*, policies gate *which
   subjects*.

- **RBAC vs policy:** use **both** — boundary RBAC for command capability, edge/policy-based AuthZ
  for per-record decisions. They compose (RBAC denies fast; policy is the authority on PHI).
- **GraphQL resolver checks:** derive tenant from the principal; for PHI-bearing resolvers, route
  reads through the existing `RetrievalPermissionGate` / `authorized-context` so reads honor
  consent/participation, not just tenancy (this is the deferred UPDATE 19 remediation, unblocked
  once a verified principal+tenant exists).

## 7. Migration plan from `x-actor-id`

Mode flag `AUTH_MODE` ∈ `legacy | dual | required` (mirrors the HMAC `WEBHOOK_HMAC_MODE` rollout):

- **`legacy`** (today): `x-actor-id` only.
- **`dual`**: accept **either** a verified token (preferred; claims win) **or** legacy
  `x-actor-id`; emit a deprecation signal whenever a request lands on the legacy path. Tenant
  derivation/blocking enforced for **token** principals first.
- **`required`**: token mandatory; `x-actor-id` rejected; tenant always derived/validated from
  claims; client-supplied tenant trust removed.

Additive dual-accept means **no hard cutover** and instant rollback via `AUTH_MODE=legacy`.

## 8. Environment / config strategy

- `AUTH_MODE` (`legacy|dual|required`, default `legacy`).
- `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE` (token verification).
- Service/system credentials (client-credentials or mTLS material).
- **Replace `ALARA_SYSTEM_ACTORS`** with a `system:*` scope claim (keep the env as a `legacy`/`dual`
  bridge only).
- **Test affordance:** a test issuer / injectable verified principal so the existing 730+ tests do
  not need a real IdP (analogous to how webhook tests inject the secret).

## 9. Testing strategy

- **Test principal factory** (mint signed test tokens or inject a verified `Principal`) so existing
  tests adapt minimally.
- Token: valid → ok; expired / wrong `aud` / bad signature / missing → 401.
- Tenant: requested tenant ∉ `principal.tenants` → 403 (REST + GraphQL); in-set / derived → ok.
- RBAC: each command's role/scope gate (admin/clinician/care-guide/read-only); `system:raw-event`
  for raw append.
- Modes: `legacy` (header works), `dual` (token or header; deprecation signal asserted),
  `required` (header rejected).
- **Invariants preserved:** participation/consent policies still enforced with the verified actor;
  idempotency unchanged.
- **Integration harness** (eventually) against the real IdP, paired with the RLS harness from
  `tenancy-rls.md` §6.

## 10. Rollout plan

`AUTH_MODE` per environment: `legacy` → `dual` (soak; watch deprecation signal → zero) →
`required`. Instant rollback to `legacy`. Sequence with the RLS milestone: land identity+tenant
binding first (this packet), then RLS consumes the principal-derived tenant.

## 11. Open owner decisions

1. **IdP choice** — managed OIDC (Auth0 / Cognito / Clerk / Okta) vs self-hosted (Keycloak) vs a
   minimal internal issuer for MVP.
2. **Session vs JWT for staff** — depends on the frontend (browser app → cookie sessions; SPA →
   short-lived JWT).
3. **Tenant membership** — single-tenant-per-user (simplest) vs multi-tenant memberships
   (orgs/MSOs). Determines whether requests may carry a tenant selector.
4. **Boundary role taxonomy** (admin / clinician / care-guide / read-only) and its mapping to
   ADR-014 participation roles.
5. **External-actor auth** — mechanisms and timing for family / patient / referral source /
   physician / payer (portal accounts, partner keys, magic links).
6. **Service/system credentials** — client-credentials vs mTLS vs signed internal tokens.
7. **Strict vs selectable tenant** — bind strictly from token, or allow a validated selector.
8. **Timeline vs RLS** — this packet is RLS's prerequisite; confirm ordering.

## 12. Exact implementation slices (if approved)

1. **Principal abstraction (internal; NO behavior change).** Add a `Principal` type +
   `authenticatePrincipal(req)` that, in `legacy` mode, returns a legacy principal from
   `x-actor-id` (tenant from request, empty roles). Pure refactor behind `getAuthenticatedActor`;
   everything still works. *(Mirrors how the HMAC verifier was staged unwired — de-risks all
   downstream slices, independently shippable, needs no IdP decision.)* **✅ DONE (UPDATE 27).**
2. **Token verification (dual, tenant unenforced).** Add JWT/OIDC verification; `AUTH_MODE=dual`
   accepts token-or-legacy; populate `Principal` claims; deprecation signal on legacy. No tenant
   enforcement yet.
3. **Tenant derivation + cross-tenant block.** For token principals, derive/validate tenant from
   claims; reject mismatched `tenantId` (REST 403 / GraphQL 403) at the boundary.
4. **Command-level role/scope gates.** Replace `ALARA_SYSTEM_ACTORS` with a `system:*` scope; add
   coarse role gates per mutating command.
5. **GraphQL tenant + permission enforcement.** Derive tenant from principal in resolvers; route
   PHI reads through `RetrievalPermissionGate` (closes UPDATE 19).
6. **`required` mode + remove legacy `x-actor-id`.**
7. **(Separate track) RLS milestone** per `tenancy-rls.md` §6, fed by the principal-derived tenant.
8. **(Later) external actor types** (family / patient / referral / physician / payer) onto
   participation edges.

**Recommended first slice after approval: Slice 1 (Principal abstraction, internal, no behavior
change).** It needs no IdP decision, is independently testable, and de-risks every later slice —
exactly the staging pattern used for the webhook HMAC verifier.
