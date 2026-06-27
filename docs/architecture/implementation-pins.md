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
   _Status: implemented for Reality Understanding reads — `reasoning-engine/authorized-context.ts` routes evidence through the existing `RetrievalPermissionGate` before `assembleContext`; read-boundary adapters delegate to the real Consent/Participation/AI-Act modules. **Fact resolution added** (`reasoning-engine/fact-resolver.ts`): participation resolves from canonical relationship edges, ai-act from intended use, consent via an optional `ConsentFactSource`; a required-but-unresolved fact fails closed. **Consent store wired** (`consent-store/`): `ConsentRepository` reads canonical `Consent` objects and `GraphConsentFactSource` feeds `ConsentFactSource`, so valid consent allows and revoked/expired/missing fails closed. **Consent issuance/lifecycle wired** (`consent-store/engine.ts`): grant/revoke/expire `Consent` objects via the canonical object+event pattern; full loop proven (grant→allow, revoke/expire/missing→fail closed). **Consent capture wired** (`consent-store/capture.ts`): `ConsentCaptureService` validates intake/portal input and calls the canonical `ConsentEngine` (capture→grant, withdraw→revoke); full loop proven. **Consent surface wired** (`apps/api`): REST `POST /commands/consent` and `/commands/consent/withdraw` call `ConsentCaptureService` → `ConsentEngine`; full loop proven (capture→read allowed, withdraw→blocked). Remaining: REST only (no GraphQL); `apps/api` is not in the `workspaces` array but is now covered by standard root verification via `npm run verify` (core `--workspaces` + apps/api); **caller authorization added** (`consent-authority-policy.ts` + `ConsentAuthorizer`): who-may-grant/withdraw is decided by the RulesEngine (self or Owner/Actor participation), fails closed, API returns 403; **transport auth boundary added** (`apps/api/src/shared/auth.ts`): the consent endpoints authorize the authenticated actor from the `x-actor-id` header (a dev/test boundary — no login/session/JWT), fail closed with 401 when absent, and ignore body `capturedBy`. Remaining: real token/session authentication not built; no guardian model beyond participation; no automatic expiry sweep. The Permission Gate is unchanged (read/enforcement-only). See `code-concordance.md` §4 (UPDATES 7–8)._
7. Capabilities own cycle instances, **never** Objects.
8. Shared writes serialize through Object state machines.
9. Objecthood is a **design-time schema gate**, not runtime validation.
10. The cycle is **logical dependency order**, not a synchronous pipeline.
11. Persistence must support durable append-only storage and atomic write boundaries.
12. Identity Resolution requires its **own implementation spec** before production use.
    _Spec written (no code yet): `identity-resolution-spec.md` — resolves over the existing `Patient` object + external references, deterministic-first, non-destructive merges, human-gated conflicts/PHI._
13. Legal erasure must preserve audit integrity while making protected payload unrecoverable.
14. Confidence must be either canonical/composable or **explicitly** non-composable.
15. Failure Signatures must be classified as machine-evaluable predicates **or** human
    criteria before Assure automation.
