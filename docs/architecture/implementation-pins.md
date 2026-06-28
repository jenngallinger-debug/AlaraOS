# AlaraOS — Implementation Pins

These are **constraints, not technologies**. They are binding on all implementation.

1. Derived state must never become canonical truth.
2. Reality Models and Projections must be tied to Graph version **plus** synthesis version.
3. Stale derived state is a cache miss.
4. Derived values enter canon only as timestamped readings / events.
5. Events require deterministic causal ordering.
   _Status: per-stream append hardened — `EventStore.append` takes a transaction-scoped
   `pg_advisory_xact_lock(hashtext(tenant_id), hashtext(stream_id))` before computing
   `MAX(seq)+1`, so concurrent appends to one stream serialize into a contiguous,
   gap-free sequence; different streams proceed concurrently. The `UNIQUE(stream_id, seq)`
   constraint remains a backstop. (Bounded retry-on-unique is NOT added; a multi-stream
   transaction acquiring locks in conflicting order could still deadlock and rely on
   Postgres deadlock detection — see `code-concordance.md`.)_
6. Authorization must gate Graph reads **before** Reality Understanding sees data.
   _Posture update (P0): the **RulesEngine now fails closed** — a rule set with no
   registered policy returns **DENY**, not implicit ALLOW. Intentional allow is explicit
   via a registered policy (e.g. `DefaultAllowPolicyModule`, `ruleSetIds ['*']`), so the
   retrieval read gate suppresses records when no read policy is registered. `DEFER` alone
   still collapses to ALLOW (known follow-on, pinned by tests). See `code-concordance.md`
   UPDATE 10._
   _Read-path hardening (P0): `ConsentRepository.findForSubject` now queries by tenant +
   type + `attributes->>'subjectId'` (backed by partial index `idx_objects_consent_subject`,
   migration 012) instead of scanning every Consent in the tenant. Semantics unchanged;
   consent scope/purpose-of-use granularity and merge-aware reads remain open. See
   `code-concordance.md` UPDATE 11._
   _API auth boundary (P0, apps/api): mutating REST commands now require the transport
   authentication boundary — `/commands/referrals` and `/commands/events` require an
   authenticated `x-actor-id` (events additionally require a privileged system actor),
   joining the already-authenticated consent endpoints; `/webhooks/automynd` requires a
   valid `x-automynd-secret` shared secret (fails closed when unconfigured). GraphQL is
   read-only (no mutations). This is **not** a production auth provider — `x-actor-id` is
   still a spoofable dev boundary and the webhook secret is a shared secret, not an HMAC.
   See `code-concordance.md` UPDATE 13._
   _Webhook replay protection (P0): `/webhooks/automynd` also requires an `idempotency-key`
   header; the canonical event id is derived deterministically from (tenant, source, key)
   so a replay is deduped by the Event Store (no second event), and a key reused with a
   different payload returns 409. `EventStore.append` gained an additive optional `eventId`
   to enable this (no semantic change). Still MVP: not HMAC-over-raw-body, no replay
   timestamp window. See `code-concordance.md` UPDATE 14._
   _Referral command idempotency (P0): `IntakeOrchestrator.handleReferralReceived` is
   idempotent by external referral id via a deterministic per-referral receipt stream
   (tenant + automynd + `automyndReferralId`). A retry replays the original result (no
   duplicate workflow/task/promise/communication); a reused id with a different payload is
   a conflict (API 409); a missing id is rejected. Enforced in the orchestrator (protects
   the canonical operation for any caller). Residual: concurrent first-time duplicates not
   yet prevented (needs a pre-saga claim). See `code-concordance.md` UPDATE 15._
   _Rate limiting (P0, apps/api): a dependency-free, **process-local** fixed-window limiter
   (`shared/rate-limit.ts`) is applied as an onRequest hook to mutating routes (POST
   `/commands/*`, `/webhooks/automynd`); over-limit → 429. Keyed by `x-actor-id` else IP.
   Configurable via `RATE_LIMIT_ENABLED`/`_WINDOW_MS`/`_MAX`; **off by default under
   `NODE_ENV=test`**. `/health` and `/graphql` excluded. Distributed/shared rate limiting
   is future work. See `code-concordance.md` UPDATE 16._
   _Raw event command gate (Hardening P2, apps/api): `POST /commands/events` (raw append to
   any stream) is now mounted only when `isRawEventCommandEnabled()` — `ALLOW_RAW_EVENT_COMMAND`
   (true/false/1/0) overrides, else enabled ONLY under `NODE_ENV=test` and **disabled by
   default in dev/prod**. When disabled it answers `reply.callNotFound()` → **404**, identical
   to an unregistered route (least-revealing; does not disclose the surface), and the gate runs
   before auth so credentials don't change the result. The system-actor gate + transport auth
   still apply when enabled. See `code-concordance.md` UPDATE 17._
   _GraphQL read-surface gate (Hardening P2, apps/api): `/graphql` returns PHI/tenant-scoped
   reads and was unauthenticated. `shared/graphql-gate.ts` adds an onRequest auth hook —
   missing `x-actor-id` → 401 (same transport boundary as REST commands); `GRAPHQL_REQUIRE_AUTH`
   overrides, default required outside tests, **relaxed under `NODE_ENV=test`** so the AC-5/6/7
   suite is unaffected. `GRAPHQL_ENABLED` (default ON) is a kill-switch: when off, Mercurius is
   not mounted → 404. **Does NOT fix cross-tenant access** — `tenantId` is still a client
   argument; tenant-aware authorization needs real authN + resolver changes (DEFERRED decision
   packet). See `code-concordance.md` UPDATE 19._
   _Consent capture idempotency (Hardening P2): `ConsentCaptureService.capture` was not
   idempotent (every grant minted a fresh Consent), so a double-submit created two active
   Consents. Now (when an `eventStore` is wired — the API container does) it reuses the
   referral receipt-stream pattern: idempotency key = explicit `idempotency-key` header else a
   content fingerprint; authorize→idempotency-check ordering (a stranger gets 403 before any
   replay disclosure); a replay returns the original consent (API 200 vs first-capture 201); an
   explicit key reused with different content → `ConsentIdempotencyConflictError` (API 409).
   New `ConsentCaptureReceiptRecorded` event. Residual: same first-time concurrency window as the
   referral pattern (withdraw idempotency is now closed — see UPDATE 25). See
   `code-concordance.md` UPDATE 20._
   _Consent withdraw idempotency (Hardening P2): `ConsentEngine.transition` now short-circuits
   when the consent already holds the target status (`current.attributes.status === changes.status`)
   — a repeated withdraw of an already-revoked consent appends NO redundant `ObjectUpdated` and
   returns a stable 200 with `idempotentReplay` (eventId `''`). A transition to a different status
   still proceeds; authorization, validation, and the optimistic-concurrency guard on the real
   update path are unchanged. See `code-concordance.md` UPDATE 25._
   _Identity & tenant boundary (Hardening P2, DESIGN ONLY — not implemented): decision packet for
   the first production-grade identity + tenant boundary — the remaining true production blocker.
   AlaraOS has policy-based AuthZ (ADR-014 participation, ConsentAuthorizer, RetrievalPermissionGate)
   but no AuthN: `x-actor-id` and `tenantId` are unverified client inputs (impersonation +
   cross-tenant PHI open). Introduces a verified `Principal` (user/service/system/external) with
   tenant/roles/scopes claims; tenant DERIVED from principal not request; cross-tenant blocked at
   the boundary (closes UPDATE 19); two-layer AuthZ (boundary RBAC + existing per-subject policies);
   `AUTH_MODE` legacy→dual→required rollout. Prerequisite for real RLS (`tenancy-rls.md` §6). First
   slice: Principal abstraction (internal, no behavior change). Full packet in
   `docs/architecture/identity-tenant-boundary.md`; see `code-concordance.md` UPDATE 26._
   _Principal abstraction (identity boundary SLICE 1 — IMPLEMENTED, legacy mode): `shared/auth.ts`
   adds a typed `Principal` (principalId/type/tenants/roles/scopes/legacyActorId) +
   `legacyPrincipal`/`authenticatePrincipal`; `getAuthenticatedActor` now derives its return from
   the principal (byte-identical to the old `x-actor-id` read). Legacy claims are minimal/inert
   (type `user`, empty tenants/roles/scopes); nothing consumes them yet, tenant still from request,
   `/commands/events` still gates on `isSystemActor`. NO behavior change (all prior tests
   unchanged). Slices 2–4 (token verification, tenant binding, system→scope) are later. See
   `code-concordance.md` UPDATE 27._
   _System actor → scope gate (identity boundary SLICE 4 partial — IMPLEMENTED): `shared/auth.ts`
   adds `SYSTEM_SCOPE='system:*'`; `legacyPrincipal` grants it (and `type:'system'`) to configured
   `ALARA_SYSTEM_ACTORS`; `principalHasScope` helper. `/commands/events` now authorizes on
   `principalHasScope(principal, SYSTEM_SCOPE)` instead of `isSystemActor(actor)` — identical
   allow/deny (201/403/401), env read per request as before. `auth.ts`→`config.ts` import (no
   cycle); `ALARA_SYSTEM_ACTORS` unchanged as the config source. Only the raw-event gate migrated;
   broader per-command RBAC still future. See `code-concordance.md` UPDATE 28._
   _IdP / token strategy (identity boundary — OWNER DECISION PACKET, design only): forces the
   single owner decision that unblocks token dual-mode, tenant derivation, GraphQL tenant block,
   and RLS session-tenant. Recommends a two-track approach sharing ONE verifier — short-term
   local/dev **RS256 JWT** (+ test-token factory) to start Slices 2–3 now without a vendor, and
   **managed BAA-signed OIDC** for production staff + **service tokens** for machine/system
   principals, all via **RS256 + JWKS** so dev and prod verify identically. Required claims map to
   `Principal` (`sub`→principalId, `tenants`, `roles`, `scope`, `principal_type`). Gating decisions
   to START Slice 2: RS256+JWKS scheme + tenant membership model (single vs multi-tenant). No
   runtime change. Full packet `docs/architecture/idp-token-decision.md`; see
   `code-concordance.md` UPDATE 29._
   _Token verification + AUTH_MODE (identity boundary SLICE 2 — IMPLEMENTED, default OFF):
   `shared/jwt.ts` is a PURE, dependency-free RS256 verifier (Node crypto) — `verifyJwt` checks
   alg=RS256 only (rejects none/HS*), signature-before-claims, iss/aud/exp/nbf, and maps
   sub/principal_type/tenants/roles/scope onto a `Principal`. Config `AUTH_MODE`
   (legacy|dual|required, default legacy), `AUTH_ISSUER`/`AUTH_AUDIENCE`/`AUTH_PUBLIC_KEY` (PEM;
   JWKS-URL resolver is a later slice). `authenticatePrincipal` honors the mode: legacy =
   byte-identical x-actor-id; dual = prefer verified token else legacy; required = token only.
   NO tenant enforcement (tenants claim populated but unused), NO GraphQL change, no new dep,
   default behavior unchanged. Vendor-neutral (no IdP hardcoded). See `code-concordance.md`
   UPDATE 30._
   _REST tenant membership block (identity boundary SLICE 3 partial — IMPLEMENTED): `shared/auth.ts`
   adds `isVerifiedPrincipal` (token-derived = no `legacyActorId`) + `isTenantAllowed(principal,
   tenantId)` — legacy → always allowed (unchanged); verified token → request `tenantId` must be in
   `principal.tenants`, empty membership **fails closed**. The four principal-authed mutating
   commands (referrals/events/consent/withdraw) now use `authenticatePrincipal` and return **403**
   when the tenant is not permitted (before the engine, so nothing mutates). Webhook excluded
   (shared-secret). NO GraphQL change, NO tenant derivation/defaulting, NO RLS. Default legacy
   behavior byte-identical. See `code-concordance.md` UPDATE 31._
   _GraphQL tenant membership block (identity boundary SLICE 5 partial — IMPLEMENTED): the Mercurius
   `context` factory (`server.ts`) injects `authenticatePrincipal(request)` as `context.principal`;
   `resolvers.ts` `assertTenantAllowed` guards every tenant-scoped resolver (object/workflow/
   timeline/digitalCareTwin/referralSourceStrength + 3 stubs). A verified token querying a non-member
   tenant (empty → fail closed) → safe GraphQL error, null data, NO PHI leaked; legacy / no-principal
   unenforced. **Closes the UPDATE 19 cross-tenant gap** across REST (UPDATE 31) + GraphQL. Schema
   unchanged; no derivation; no RetrievalPermissionGate-on-reads yet; default byte-identical. See
   `code-concordance.md` UPDATE 32._
   _Production JWKS resolver (identity boundary — DECISION PACKET, design only): designs JWKS-by-`kid`
   to replace the single static `AUTH_PUBLIC_KEY`, enabling `AUTH_MODE=dual` against a real IdP.
   Keeps `verifyJwt`/`authenticatePrincipal` SYNCHRONOUS by reading an in-memory key cache
   (`Map<kid,KeyObject>`, TTL + last-known-good + min-interval) filled by a non-blocking background
   refresher (startup never blocks on the IdP). `verifyJwt` gains a sync key-resolver; rotation is
   overlap-based; fail-closed (dual→legacy, required→401). Dependency-free (Node `fetch`,
   `createPublicKey({format:'jwk'})`); vendor-neutral (AUTH_JWKS_URL is config). 4 slices; first =
   key-resolver refactor (no behavior change). No runtime change. Full packet
   `docs/architecture/jwks-resolver.md`; see `code-concordance.md` UPDATE 33._
   _JWT key-resolver refactor (JWKS slice 1 — IMPLEMENTED, no network): `shared/jwt.ts` adds
   `KeyResolver=(kid?)=>string|KeyObject|undefined` + `singleKeyResolver`; `verifyJwt` takes
   `resolveKey` instead of `publicKey`, reads `kid` from the header, and **fails closed
   (`unknown_kid`)** when the resolver returns nothing (before signature). `auth.ts` adapts the
   single `AUTH_PUBLIC_KEY` via `singleKeyResolver` — same key, same result, `authenticatePrincipal`
   unchanged. All other validation byte-identical. No JWKS fetch / cache / network / dep / config
   change yet (slices 2–4). See `code-concordance.md` UPDATE 34._
   _JWKS cache/fetcher module (JWKS slice 2 — IMPLEMENTED, unwired): `shared/jwks.ts` (Node crypto
   only). `parseJwks` builds `Map<kid,KeyObject>` from a JWKS (RSA signing keys only; JWK→KeyObject
   via `createPublicKey({format:'jwk'})`; malformed → undefined). `JwksCache` takes an INJECTED async
   fetcher, with TTL staleness, min-interval throttle, and last-known-good on failure/malformed/empty;
   `resolve(kid?)` is SYNCHRONOUS and `resolver()` returns a `KeyResolver` for `verifyJwt`. NOT
   imported by auth (no network/fetch/config/dep) — wiring is slice 3. Zero runtime change. See
   `code-concordance.md` UPDATE 35._
   _HTTP security headers + CORS (Hardening P2, apps/api): `shared/http-security.ts`. A
   dependency-free `onSend` hook (no Helmet) sets a standard header set on every response
   (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   `Cross-Origin-Resource-Policy: same-origin`, DNS-prefetch off, cross-domain-policies none),
   default ON (`SECURITY_HEADERS_ENABLED`); HSTS is opt-in (`HSTS_ENABLED`, default OFF). CORS
   uses the already-installed `@fastify/cors` with an env allowlist `CORS_ALLOWED_ORIGINS` —
   **empty → deny (no wildcard)**; non-empty reflects only those origins; `credentials: false`.
   No CSP (would break dev GraphiQL). Owner decision: set `CORS_ALLOWED_ORIGINS` to the real
   frontend origin(s) and `HSTS_ENABLED=true` once TLS is confirmed. See
   `code-concordance.md` UPDATE 21._
   _Webhook HMAC signing (Hardening P2, DESIGN ONLY — not implemented): decision packet to
   replace the `x-automynd-secret` shared-secret with HMAC-SHA256 over `"{timestamp}.{rawBody}"`
   (`X-Automynd-Signature: t=,v1=,kid=`), ±300s timestamp tolerance, key rotation via a
   `kid`-keyed keyset, and a 3-state `WEBHOOK_HMAC_MODE` (off→dual→required) rollout with no flag
   day. Raw body captured via an encapsulated Fastify content-type parser (dependency-free).
   Existing `idempotency-key` dedup is unchanged and complementary. No runtime change yet;
   4 implementation slices defined. See `code-concordance.md` UPDATE 22._
   _Webhook raw-body capture (Hardening P2, HMAC slice 1/4 — IMPLEMENTED): `shared/raw-body.ts`
   `registerRawBodyJsonParser` stashes the exact request bytes on `req.rawBody` then delegates to
   Fastify's default JSON parser (semantics byte-identical). `/webhooks/automynd` is now in an
   encapsulated context so only it buffers the raw body; all other routes keep the default
   parser. Nothing reads `rawBody` yet (it feeds slice 2's HMAC verify). No auth/idempotency/
   shared-secret change. See `code-concordance.md` UPDATE 23._
   _Webhook HMAC verifier + config (Hardening P2, HMAC slice 2/4 — IMPLEMENTED, UNWIRED):
   `shared/webhook-hmac.ts` is a pure verifier — `verifyWebhookSignature` checks
   `X-Automynd-Signature: t=,v1=,kid=` over `HMAC-SHA256("{t}.{rawBody}")` with timestamp
   tolerance, constant-time compare (`secretsMatch`), and kid-based key rotation (named kid must
   exist; absent kid tries all). Config helpers parse `AUTOMYND_WEBHOOK_KEYS` (kid:secret list),
   `WEBHOOK_TIMESTAMP_TOLERANCE_SEC` (default 300), `WEBHOOK_HMAC_MODE` (off|dual|required,
   default off). **Not called by the route** — webhook still uses the shared secret; no behavior
   change. Slice 3 wires `dual` mode (needs owner confirmation of Automynd's header format). See
   `code-concordance.md` UPDATE 24._
   _Status: implemented for Reality Understanding reads — `reasoning-engine/authorized-context.ts` routes evidence through the existing `RetrievalPermissionGate` before `assembleContext`; read-boundary adapters delegate to the real Consent/Participation/AI-Act modules. **Fact resolution added** (`reasoning-engine/fact-resolver.ts`): participation resolves from canonical relationship edges, ai-act from intended use, consent via an optional `ConsentFactSource`; a required-but-unresolved fact fails closed. **Consent store wired** (`consent-store/`): `ConsentRepository` reads canonical `Consent` objects and `GraphConsentFactSource` feeds `ConsentFactSource`, so valid consent allows and revoked/expired/missing fails closed. **Consent issuance/lifecycle wired** (`consent-store/engine.ts`): grant/revoke/expire `Consent` objects via the canonical object+event pattern; full loop proven (grant→allow, revoke/expire/missing→fail closed). **Consent capture wired** (`consent-store/capture.ts`): `ConsentCaptureService` validates intake/portal input and calls the canonical `ConsentEngine` (capture→grant, withdraw→revoke); full loop proven. **Consent surface wired** (`apps/api`): REST `POST /commands/consent` and `/commands/consent/withdraw` call `ConsentCaptureService` → `ConsentEngine`; full loop proven (capture→read allowed, withdraw→blocked). Remaining: REST only (no GraphQL); `apps/api` is not in the `workspaces` array but is now covered by standard root verification via `npm run verify` (core `--workspaces` + apps/api); **caller authorization added** (`consent-authority-policy.ts` + `ConsentAuthorizer`): who-may-grant/withdraw is decided by the RulesEngine (self or Owner/Actor participation), fails closed, API returns 403; **transport auth boundary added** (`apps/api/src/shared/auth.ts`): the consent endpoints authorize the authenticated actor from the `x-actor-id` header (a dev/test boundary — no login/session/JWT), fail closed with 401 when absent, and ignore body `capturedBy`. Remaining: real token/session authentication not built; no guardian model beyond participation; no automatic expiry sweep. The Permission Gate is unchanged (read/enforcement-only). See `code-concordance.md` §4 (UPDATES 7–8)._
7. Capabilities own cycle instances, **never** Objects.
8. Shared writes serialize through Object state machines.
9. Objecthood is a **design-time schema gate**, not runtime validation.
10. The cycle is **logical dependency order**, not a synchronous pipeline.
11. Persistence must support durable append-only storage and atomic write boundaries.
    _Tenancy posture (audited): RLS is **scaffolded but not a live backstop** — enabled
    with `tenant_isolation` policies on 29 tables, but no `FORCE ROW LEVEL SECURITY`
    (owner role bypasses RLS), the app never sets `app.tenant_id` (a non-owner role would
    return zero rows), and policies are `USING`-only (writes unconstrained). Tenant
    isolation is enforced by **application-level `WHERE tenant_id`**, guarded by
    `tests/tenancy-guard.test.ts`. Full RLS enablement (tenant-scoped DB helper +
    `SET LOCAL` + `WITH CHECK` + `FORCE` + real-Postgres harness) is a deferred milestone.
    See `tenancy-rls.md` and `code-concordance.md` UPDATE 12._
12. Identity Resolution requires its **own implementation spec** before production use.
    _Spec written (no code yet): `identity-resolution-spec.md` — resolves over the existing `Patient` object + external references, deterministic-first, non-destructive merges, human-gated conflicts/PHI._
13. Legal erasure must preserve audit integrity while making protected payload unrecoverable.
14. Confidence must be either canonical/composable or **explicitly** non-composable.
15. Failure Signatures must be classified as machine-evaluable predicates **or** human
    criteria before Assure automation.
