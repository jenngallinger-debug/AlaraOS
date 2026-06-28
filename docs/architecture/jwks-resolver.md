# AlaraOS — Production JWKS Resolver (DECISION PACKET — design only, NOT implemented)

> **Status: DESIGN ONLY.** No runtime change. Records the design for moving token-key
> resolution from a single static `AUTH_PUBLIC_KEY` to JWKS-by-`kid` so `AUTH_MODE=dual` can be
> turned on against a real managed IdP. Companion to `idp-token-decision.md` (UPDATE 29) and
> `identity-tenant-boundary.md`.

## 1. Current token verification behavior

- **`apps/api/src/shared/jwt.ts` — `verifyJwt(opts)` is PURE and SYNCHRONOUS.** It verifies an
  RS256 signature against a single `publicKey: string | KeyObject`, then validates `alg=RS256`,
  signature-before-claims, `iss`/`aud`/`exp`/`nbf`, and maps claims onto a `Principal`. It already
  decodes the JWT **header** (so `kid` is *available*) but does **not** read or use `kid` today.
- **`apps/api/src/shared/auth.ts` — `authenticatePrincipal` / `tokenAuthenticate` are SYNCHRONOUS.**
  They resolve `getAuthIssuer()`/`getAuthAudience()`/`getAuthPublicKey()` from env; if any is
  missing, no token principal is produced (in `dual` this falls back to legacy `x-actor-id`).
- **Config (`config.ts`):** `AUTH_MODE` (`legacy|dual|required`), `AUTH_ISSUER`, `AUTH_AUDIENCE`,
  `AUTH_PUBLIC_KEY` (one PEM, `\n` un-escaped).
- **Hot path is synchronous:** every REST mutating handler and the GraphQL Mercurius `context`
  factory call `authenticatePrincipal(req)` per request, with no `await`.

## 2. Why a single `AUTH_PUBLIC_KEY` is insufficient for production

- **No key rotation.** Managed IdPs rotate signing keys regularly and keep multiple keys live
  during overlap. A single pinned PEM cannot verify tokens signed by the new key — every rotation
  becomes an outage unless someone copies the new PEM into env and redeploys *in time*.
- **No `kid` selection.** With more than one active key, we cannot pick the right one to verify a
  given token.
- **Manual distribution / operational risk.** The PEM must be hand-managed per environment; a
  missed rotation = a hard auth outage.
- **Ignores standard discovery.** Production IdPs publish a JWKS endpoint
  (`.well-known/jwks.json`, RFC 7517); the current setup ignores it.

Conclusion: `AUTH_PUBLIC_KEY` is correct for **local/dev/test** (the scaffold), but production
requires fetching the current key set by `kid` from JWKS, with caching and rotation handling.

## 3. Proposed JWKS config

- **`AUTH_JWKS_URL`** — the IdP's JWKS endpoint. *The only vendor-specific value, and it is config,
  not code* (see §10).
- **`iss`/`aud` validation unchanged** — still `AUTH_ISSUER` / `AUTH_AUDIENCE`. JWKS only changes
  how the verification **key** is resolved; claim validation is byte-identical to today.
- **`AUTH_JWKS_CACHE_TTL_SEC`** — cache freshness window (default **600s / 10 min**).
- **Fetch failure / retry:** bounded fetch **timeout** (≈3–5s) and a small bounded **retry** (≈2
  attempts, backoff). On failure, serve the **last-known-good** cached keys if still usable; if no
  usable key → **fail closed** (token rejected). A **min-refresh-interval** (negative-cache) throttles
  refresh so a flood of unknown-`kid` tokens cannot stampede the JWKS endpoint.

## 4. Key selection by `kid`

- Read `kid` from the (already-decoded) JWT header; look it up in the cached JWKS.
- **`kid` present, in cache** → verify with that key.
- **`kid` present, not in cache** → trigger at most one bounded refresh (respecting the
  min-interval), re-check; still missing → reject (an `unknown_kid`-style failure).
- **No `kid`, exactly one cached key** → use it. **No `kid`, multiple keys** → reject (ambiguous).
- Refactor: `verifyJwt` takes a **synchronous key resolver** `(kid?) => KeyObject | undefined`
  instead of a single key. The current `AUTH_PUBLIC_KEY` becomes a degenerate one-key resolver; the
  JWKS path provides a **cache-backed** resolver. **`verifyJwt` stays synchronous** — it reads an
  in-memory cache, never the network.

## 5. Cache & rotation strategy

- In-memory `Map<kid, KeyObject>` (+ last-fetch timestamp), **process-local** (like the rate
  limiter). Refresh when stale (TTL) or on unknown-`kid` (rate-limited).
- **Rotation (no deploy, no env change):** IdP publishes new key alongside old (overlap) → a cache
  refresh ingests both → tokens under either `kid` verify → IdP retires the old key → the next
  refresh drops it. Same philosophy as the webhook HMAC keyset (UPDATE 24).
- **JWK → KeyObject** via Node `crypto.createPublicKey({ format: 'jwk', key: jwk })` — **no
  dependency**. Accept only RSA keys intended for signing (`kty: RSA`, `use: sig`/`alg: RS256`);
  ignore others.

## 6. Startup vs lazy fetch

**Decision: non-blocking warm + background refresh; verification never awaits.**
- Do **NOT** block server startup on a successful JWKS fetch — that would couple AlaraOS liveness
  to the IdP being reachable at boot. Instead, kick off a **non-blocking** warm at server build and
  keep the cache fresh with a background refresher (timer) and on-demand (rate-limited) refresh on
  unknown-`kid`.
- The hot path (`authenticatePrincipal`) reads the cache **synchronously** — this is what lets the
  current sync call signatures (REST handlers + GraphQL context) stay unchanged. Making
  `authenticatePrincipal` async would ripple `await` through every handler and the GraphQL context
  — a large, risky change we explicitly avoid.
- If the cache is still empty at verify time (pre-warm or total JWKS outage) → **fail closed** for
  that request (see §7).

## 7. Fail-closed behavior for dual / required

When the token's `kid` cannot be resolved to a verified key (unconfigured JWKS, outage, empty
cache, or unknown `kid` after a throttled refresh):
- **`dual`** → no token principal → **fall back to legacy `x-actor-id`** (today's fail-safe).
  This is *fail-open to legacy*, acceptable only while legacy is still trusted during rollout; move
  to `required` to remove that window.
- **`required`** → **401** (reject). True fail-closed: a JWKS outage means no token logins succeed,
  but **no one is wrongly admitted**.
- A token with a good signature under a cached key but bad `iss`/`aud`/`exp` is rejected exactly as
  today (unchanged). **Never** accept a token whose `kid` we cannot resolve.

## 8. Test strategy (no real network)

- **Resolver (pure):** inject a `Map<kid, KeyObject>` — correct `kid` verifies; unknown `kid`
  rejected; rotation overlap (two keys) both verify; no-`kid`+single-key works; no-`kid`+multiple
  rejects.
- **Cache:** a **fake fetcher** returning a JWKS — assert TTL refresh, last-known-good on fetch
  failure, min-interval throttle on unknown-`kid`, and fail-closed when empty.
- **Wiring:** `AUTH_MODE=dual|required` with a JWKS-backed (injected-fetcher) resolver — mirrors the
  existing `jwt-auth` / `tenant-block` tests (generate an RS256 keypair, build the JWKS from
  `publicKey.export({ format: 'jwk' })`). No real HTTP in tests.

## 9. Rollout from `AUTH_PUBLIC_KEY` to `AUTH_JWKS_URL`

- Support both during transition. **Resolver precedence:** `AUTH_JWKS_URL` set → JWKS resolver;
  else `AUTH_PUBLIC_KEY` set → static resolver; else → no token verification.
- **Phase A:** keep `AUTH_PUBLIC_KEY` (dev/test). **Phase B:** set `AUTH_JWKS_URL` in staging against
  the chosen IdP, `AUTH_MODE=dual`, soak. **Phase C:** production `dual` → `required`.
  `AUTH_PUBLIC_KEY` stays the local/test path indefinitely.
- **Instant rollback:** unset `AUTH_JWKS_URL` (back to static key) or `AUTH_MODE=legacy`.

## 10. How this avoids hardcoding an IdP vendor

The only vendor-specific values are `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE` — **all
configuration, never code**. The resolver speaks standard JWKS (RFC 7517) and standard RS256, so
Auth0 / Cognito / Clerk / Okta / WorkOS / Keycloak all work through the **same code path** with no
vendor SDK and no vendor name in the codebase.

## 11. Open owner decisions

1. **Production IdP** (feeds the JWKS URL + issuer/audience) — still the open UPDATE 29 decision.
2. **Cache TTL + refresh cadence** (default 10 min) and the fetch timeout/retry budget.
3. **`dual` fail-open-to-legacy window** vs moving to `required` sooner (accepted risk window).
4. **Non-blocking startup warm** — confirm AlaraOS liveness must not depend on the IdP at boot.
5. **Multiple issuers/audiences** (more than one client app) — single value vs list.
6. **Node built-in `fetch`** (recommended, no dependency) — confirm the production runtime is
   Node ≥18.

## 12. Exact implementation slices (if approved)

1. **Key-resolver refactor (NO behavior change).** `verifyJwt` accepts a sync resolver
   `(kid?) => KeyObject | undefined` and reads `kid` from the header; `AUTH_PUBLIC_KEY` becomes a
   one-entry resolver. Pure, unit-tested, default behavior identical. *(Same staging pattern as the
   HMAC verifier — safe seam, no network, no IdP decision needed.)* **✅ DONE (UPDATE 34).**
2. **JWKS cache + fetcher (dependency-free, injectable).** Pure cache module
   (`Map<kid,KeyObject>` + TTL + last-known-good + min-interval) with an injectable fetch (Node
   `fetch`); JWK→KeyObject via `createPublicKey({ format: 'jwk' })`. Unit-tested with a fake
   fetcher; NOT wired. **✅ DONE (UPDATE 35).**
3. **Wire JWKS resolver behind config.** `AUTH_JWKS_URL` selects the JWKS resolver; non-blocking
   warm + background refresh; `authenticatePrincipal` stays synchronous (cache read). Fail-closed
   per mode. Integration tests with an injected fetcher.
4. **Rollout / retire static key.** Staging→prod env + docs; keep `AUTH_PUBLIC_KEY` for dev/test.

---

### Recommendation for the next implementation slice

**Slice 1 — the key-resolver refactor** (synchronous, no behavior change, no network, no new
dependency, no IdP decision required). It turns the single-key assumption into a `kid`-aware
resolver seam so JWKS becomes a drop-in, and it unblocks slices 2–4 without touching the hot-path
call signatures. The genuine prerequisites for *enabling* JWKS in production — the IdP/JWKS URL and
confirming a Node ≥18 runtime — remain owner decisions and can be settled in parallel.

---

## Appendix A — Slice 3 runtime-wiring READINESS AUDIT (implementation spec; NOT wired)

Audit of what remains to wire `JwksCache` into runtime auth, recorded so slice 3 has an exact
spec. Slices 1–2 are committed (`code-concordance.md` UPDATE 34/35); this is **audit-only**.

### A.1 What is already implemented

- **`verifyJwt`** takes a synchronous `KeyResolver` and fails closed (`unknown_kid`) when it
  returns nothing (UPDATE 34).
- **`JwksCache`/`parseJwks`** (UPDATE 35, tested, unwired): injected `JwksFetcher`,
  `Map<kid,KeyObject>`, **synchronous** `resolve(kid?)`/`resolver(): KeyResolver`, `size()`, async
  `refresh()`/`maybeRefresh()`, TTL staleness, min-interval throttle, last-known-good.
- **Config:** `getAuthMode` (`legacy|dual|required`), `getAuthIssuer`, `getAuthAudience`,
  `getAuthPublicKey`. `authenticatePrincipal` already honors `AUTH_MODE`.
- **The swap point already exists:** `tokenAuthenticate` builds
  `resolveKey: singleKeyResolver(publicKey)` — a one-line change to choose a resolver.

### A.2 Exact runtime wiring that remains (the whole of slice 3)

1. **Config helpers:** `getAuthJwksUrl()` (new — does not exist today), plus optional
   `getAuthJwksCacheTtlSec()` (default 600) and `getAuthJwksTimeoutMs()` (default 3000).
2. **Node `fetch` adapter** (the only new I/O, ~8 lines, dependency-free):
   `fetch(url, { signal: AbortSignal.timeout(ms) })` → `res.ok` check → `res.json()`; throws on
   timeout/non-2xx (so `JwksCache` keeps last-known-good). Uses the built-in global `fetch`
   (Node ≥18) — **no dependency**.
3. **Process-singleton `JwksCache`** (module-level, keyed by URL) so all requests share one cache;
   the fetcher is **injectable** (default = the adapter) so tests never touch the network.
4. **Non-blocking warm** in `buildServer`: when `AUTH_JWKS_URL` is set,
   `getJwksCache().maybeRefresh().catch(() => {})` — **not awaited** (startup must not depend on the
   IdP). Plus a fire-and-forget `maybeRefresh()` from `tokenAuthenticate` to keep the cache warm
   under traffic — never awaited, so the hot path stays synchronous.
5. **Resolver precedence in `tokenAuthenticate`:**

   | `AUTH_JWKS_URL` | `AUTH_PUBLIC_KEY` | resolver |
   |---|---|---|
   | set | (any) | JWKS cache resolver |
   | unset | set | `singleKeyResolver` (today) |
   | unset | unset | none → no token principal |

   The config guard changes from "require publicKey" to "require issuer + audience + *a* key
   source". `authenticatePrincipal` stays **synchronous**.

### A.3 Required configuration

`AUTH_JWKS_URL` (IdP JWKS endpoint) + the existing `AUTH_ISSUER`/`AUTH_AUDIENCE` + `AUTH_MODE=dual`
(or `required`). Optional: `AUTH_JWKS_CACHE_TTL_SEC` (600), `AUTH_JWKS_TIMEOUT_MS` (3000).
`AUTH_PUBLIC_KEY` remains the local/dev/test path.

### A.4 Is implementation blocked by the production IdP / JWKS URL?

**No.** The wiring is generic (any RFC-7517 JWKS). It can be fully built and tested **with no
vendor and no real network** — the cache already takes an injected fetcher, and tests use a fake
fetcher / local in-process JWKS (as `jwks.test.ts` already does). The production IdP/JWKS URL is
only a **config value needed to ENABLE** it in a real environment, not to implement or test it.

### A.5 Can a test/local JWKS or injected fetcher support implementation before vendor choice?

**Yes — fully.** Integration tests inject a fake `JwksFetcher` returning a JWKS built from a local
RSA keypair (the established pattern). The singleton factory takes an injectable fetcher (default =
the Node adapter) so tests bypass the network entirely. No vendor required to reach green.

### A.6 Risks of wiring before the production IdP is known

Low **if strictly flag-gated**: the JWKS path activates ONLY when `AUTH_JWKS_URL` is set AND
`AUTH_MODE` is `dual`/`required`. With those unset (default), behavior is byte-identical
(legacy / static key). Risks to manage (all testable with an injected fetcher): the fetch
timeout/error handling must never block the event loop or startup; the hot path must never `await`;
fail-closed must hold when the cache is cold/unreachable; and a typo'd URL must **fail closed**, not
fail open. The one thing untestable without the vendor is the IdP's exact JWKS quirks — mitigated by
RFC-7517 conformance and the `parseJwks` filters.

### A.7 Fail-closed behavior (wired)

Cold cache, unreachable JWKS, or unknown `kid` → `resolver()` returns `undefined` → `verifyJwt` →
`unknown_kid` → no token principal → **`dual` falls back to legacy `x-actor-id`; `required` → 401**.
Identical to the verifier's existing fail-closed path; no special-casing.

### A.8 Test plan

Injected fake fetcher + local RSA keypair (no network): valid token verifies via JWKS; unknown
`kid` → fail closed (dual→legacy, required→401); cold cache (pre-warm) → fail closed;
`AUTH_JWKS_URL` unset → static-key path unchanged; precedence (both set → JWKS wins); warm is
non-blocking; default `legacy` byte-identical.

### A.9 Rollback

Unset `AUTH_JWKS_URL` (revert to the static key) or `AUTH_MODE=legacy` — instant, no deploy.
Additive and flag-gated, so there is no hard cutover.

### A.10 Safest next implementation slice

Slice 3 as specified above: **strictly flag-gated on `AUTH_JWKS_URL`, fetcher injectable
(default Node `fetch`), non-blocking warm, synchronous hot-path preserved, fail-closed, integration
tests via injected fetcher.** No vendor required to implement or verify; default/legacy behavior
byte-identical. The production IdP/JWKS URL and a confirmed Node ≥18 runtime gate only *enablement*,
and can be settled in parallel.
