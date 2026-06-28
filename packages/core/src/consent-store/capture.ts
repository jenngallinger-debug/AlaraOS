/**
 * Alara OS — Consent Capture Service (intake / portal application boundary)
 *
 * The application-service path where consent is actually CAPTURED during an
 * intake or portal interaction. It validates the captured input and delegates to
 * the canonical `ConsentEngine` (grant / revoke). It owns NO consent lifecycle
 * logic and NO authorization decisions — it is the experience/application path
 * that calls the engine; the engine owns canonical consent state and the
 * Permission Gate / RulesEngine own enforcement.
 *
 * Why a dedicated service (not IntakeOrchestrator): IntakeOrchestrator is a
 * referral-received pipeline (workflow/task/promise/communication/projection)
 * that owns zero business rules and sequences that specific flow. Consent capture
 * is a distinct, smaller, reusable concern shared by intake AND portal surfaces,
 * so the smallest correct boundary is this focused service that only validates
 * and calls ConsentEngine — no new model, no new object type.
 */

import { AlaraId, makeAlaraId } from '../shared/types';
import { deterministicId } from '../shared/ids';
import { EventStore } from '../events/store';
import { ConsentPermissionType } from '../rules-engine/policies/context-types';
import { ConsentEngine } from './engine';
import { ConsentAuthorizer } from './authorizer';

export interface CaptureConsentInput {
  readonly tenantId: string;
  readonly subjectId: string;
  /** Who is granting consent (patient or authorized representative). */
  readonly grantorId: string;
  /** The actor permitted to act under this consent (or '*'). */
  readonly recipientId: string;
  readonly permissionTypes: readonly ConsentPermissionType[];
  readonly effectiveDate?: string;
  readonly expirationDate?: string;
  /** The staff / portal actor recording the capture (the ConsentEngine actor). */
  readonly capturedBy: string;
  /** Optional provenance, e.g. 'intake' | 'portal'. */
  readonly source?: string;
  /**
   * Optional explicit idempotency key (e.g. the `idempotency-key` header). When absent, a
   * key is derived from the material consent content, so a duplicate submit is deduped
   * either way. An explicit key reused with DIFFERENT content is a conflict.
   */
  readonly idempotencyKey?: string;
}

export interface CaptureConsentResult {
  readonly captured: true;
  readonly consentId: AlaraId;
  readonly status: 'active';
  readonly eventId: string;
  /** True when this result was replayed from a prior capture (no new consent created). */
  readonly idempotentReplay?: boolean;
}

export interface WithdrawConsentInput {
  readonly tenantId: string;
  readonly consentId: AlaraId;
  readonly capturedBy: string;
}

export interface WithdrawConsentResult {
  readonly withdrawn: true;
  readonly consentId: AlaraId;
  readonly status: 'revoked';
  /** The revoke event id, or '' on an idempotent no-op (consent was already revoked). */
  readonly eventId: string;
  /** True when the consent was already revoked, so no new event was appended. */
  readonly idempotentReplay?: boolean;
}

export class ConsentCaptureValidationError extends Error {
  constructor(message: string) {
    super(`Consent capture rejected: ${message}`);
    this.name = 'ConsentCaptureValidationError';
  }
}

/** Raised when an explicit idempotency key is reused with materially different consent content. */
export class ConsentIdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Consent capture conflict: idempotency key "${idempotencyKey}" was already used for different consent content`);
    this.name = 'ConsentIdempotencyConflictError';
  }
}

export class ConsentCaptureService {
  /**
   * @param engine    canonical consent lifecycle (grant/revoke)
   * @param authority optional caller-authorization (who may grant/withdraw). When
   *   provided, capture/withdraw are authorized via the RulesEngine before any
   *   canonical write. When omitted, behaviour is unchanged (no authz) — surfaces
   *   that require authorization (e.g. the API) must supply it.
   */
  /**
   * @param engine     canonical consent lifecycle (grant/revoke)
   * @param authority  optional caller-authorization (who may grant/withdraw)
   * @param eventStore optional event store enabling capture idempotency. When provided, a
   *   per-capture receipt stream (keyed by tenant + idempotency/content key) makes a
   *   duplicate submit a safe replay instead of a second Consent object. When omitted,
   *   behaviour is unchanged (no dedup) — surfaces that need it (e.g. the API) supply it.
   */
  constructor(
    private readonly engine: ConsentEngine,
    private readonly authority?: ConsentAuthorizer,
    private readonly eventStore?: EventStore,
  ) {}

  /** Capture granted consent → canonical Consent object via ConsentEngine.grant. */
  async capture(input: CaptureConsentInput): Promise<CaptureConsentResult> {
    requireField('tenantId', input.tenantId);
    requireField('subjectId', input.subjectId);
    requireField('grantorId', input.grantorId);
    requireField('recipientId', input.recipientId);
    requireField('capturedBy', input.capturedBy);
    if (!input.permissionTypes || input.permissionTypes.length === 0) {
      throw new ConsentCaptureValidationError('permissionTypes must be a non-empty list');
    }

    // Authorization decision lives in the RulesEngine/policy layer (delegated). It runs
    // BEFORE the idempotency replay so an unauthorized actor is rejected (403) and never
    // learns whether a matching consent already exists.
    if (this.authority) {
      await this.authority.assertMayGrant({
        tenantId: input.tenantId,
        actor: input.capturedBy,
        subjectId: input.subjectId,
      });
    }

    // ── Idempotency (when an event store is wired) ──────────────────────────────
    // A content fingerprint identifies the material consent; the idempotency key is the
    // caller's explicit key when given, else the fingerprint (so identical submits dedup
    // regardless). A per-capture receipt stream records the first result; a retry replays
    // it (no second Consent), and an explicit key reused with different content conflicts.
    if (this.eventStore) {
      const fingerprint = consentFingerprint(input);
      const idemKey = input.idempotencyKey?.trim() || fingerprint;
      const receiptStreamId = makeAlaraId(
        deterministicId(input.tenantId, 'consent-capture', idemKey),
      );
      const prior = await this.eventStore.loadStream(input.tenantId, receiptStreamId);
      if (prior.length > 0) {
        const r = prior[0].payload as Record<string, string>;
        if (r.fingerprint !== fingerprint) {
          throw new ConsentIdempotencyConflictError(idemKey);
        }
        return {
          captured: true,
          consentId: makeAlaraId(r.consentId),
          status: 'active',
          eventId: r.eventId,
          idempotentReplay: true,
        };
      }

      const result = await this.engine.grant(this.toGrant(input));
      await this.eventStore.append({
        tenantId: input.tenantId,
        streamId: receiptStreamId,
        type: 'ConsentCaptureReceiptRecorded',
        payload: {
          fingerprint,
          idempotencyKey: idemKey,
          consentId: String(result.consentId),
          eventId: result.eventId,
          actor: input.capturedBy,
          recordedAt: new Date().toISOString(),
        },
        actor: input.capturedBy,
      });
      return { captured: true, consentId: result.consentId, status: 'active', eventId: result.eventId };
    }

    const result = await this.engine.grant(this.toGrant(input));
    return { captured: true, consentId: result.consentId, status: 'active', eventId: result.eventId };
  }

  private toGrant(input: CaptureConsentInput) {
    return {
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      grantorId: input.grantorId,
      recipientId: input.recipientId,
      permissionTypes: input.permissionTypes,
      effectiveDate: input.effectiveDate,
      expirationDate: input.expirationDate,
      actor: input.capturedBy,
    };
  }

  /** Capture a withdrawal / decline → revoke the canonical consent via ConsentEngine.revoke. */
  async withdraw(input: WithdrawConsentInput): Promise<WithdrawConsentResult> {
    requireField('tenantId', input.tenantId);
    requireField('consentId', input.consentId);
    requireField('capturedBy', input.capturedBy);

    // Authorization decision lives in the RulesEngine/policy layer (delegated).
    if (this.authority) {
      await this.authority.assertMayWithdraw({
        tenantId: input.tenantId,
        actor: input.capturedBy,
        consentId: input.consentId,
      });
    }

    const result = await this.engine.revoke({
      tenantId: input.tenantId,
      consentId: input.consentId,
      actor: input.capturedBy,
    });

    return {
      withdrawn: true,
      consentId: result.consentId,
      status: 'revoked',
      eventId: result.eventId,
      idempotentReplay: result.idempotentReplay,
    };
  }
}

function requireField(name: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    throw new ConsentCaptureValidationError(`${name} is required`);
  }
}

/**
 * Stable fingerprint of the material consent content (not the recording actor or source).
 * permissionTypes are sorted so order does not change the fingerprint; missing optional
 * dates normalize to '' so the same omission deduplicates consistently.
 */
function consentFingerprint(input: CaptureConsentInput): string {
  return deterministicId(
    input.tenantId,
    input.subjectId,
    input.grantorId,
    input.recipientId,
    JSON.stringify([...input.permissionTypes].sort()),
    input.effectiveDate ?? '',
    input.expirationDate ?? '',
  );
}
