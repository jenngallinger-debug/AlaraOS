/**
 * Alara OS API — deprecation signal (PHI-safe operational warning)
 *
 * A small, spy-able sink for emitting deprecation/operational signals. Used by the auth boundary
 * to flag when `AUTH_MODE=dual` admits a request via the legacy `x-actor-id` fallback instead of a
 * verified Bearer token — the metric operators watch to drive legacy usage to zero before flipping
 * to `AUTH_MODE=required`.
 *
 * PHI-safety is a hard rule: a signal carries ONLY bounded, non-sensitive metadata
 * (event name, mode, reason category, and a length-bounded principal id). NEVER the request body,
 * tenantId, token, raw headers, or any PHI. The default sink is silent under `NODE_ENV=test`
 * (matching the Fastify logger convention); tests capture emissions via `setDeprecationSinkForTests`.
 */

/** A structured, PHI-safe deprecation event. */
export interface DeprecationSignal {
  /** Stable event name, e.g. `auth.legacy_fallback`. */
  readonly event: string;
  /** Operating mode, e.g. `dual`. */
  readonly mode: string;
  /** Bounded reason category, e.g. `legacy_actor_fallback`. */
  readonly reason: string;
  /** The authenticated actor/principal id (NOT PHI; length-bounded). */
  readonly principalId?: string;
}

export type DeprecationSink = (signal: DeprecationSignal) => void;

/** Default sink: one structured warn line. Silent under tests (matches the Fastify logger toggle). */
function defaultSink(signal: DeprecationSignal): void {
  if (process.env.NODE_ENV === 'test') return;
  console.warn(
    `[deprecation] ${signal.event} mode=${signal.mode} reason=${signal.reason}` +
      (signal.principalId ? ` principalId=${signal.principalId}` : ''),
  );
}

let sink: DeprecationSink = defaultSink;

/** TEST ONLY: install a capturing sink (or pass `undefined` to restore the default). */
export function setDeprecationSinkForTests(s: DeprecationSink | undefined): void {
  sink = s ?? defaultSink;
}

/** Bound a principal id to a safe length (defensive against oversized header input). */
function boundedId(id: string): string {
  return id.length > 64 ? `${id.slice(0, 64)}…` : id;
}

/** Emit a PHI-safe deprecation signal. The principal id (if any) is length-bounded before sinking. */
export function emitDeprecation(signal: DeprecationSignal): void {
  sink(signal.principalId !== undefined ? { ...signal, principalId: boundedId(signal.principalId) } : signal);
}
