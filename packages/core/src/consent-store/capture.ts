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

import { AlaraId } from '../shared/types';
import { ConsentPermissionType } from '../rules-engine/policies/context-types';
import { ConsentEngine } from './engine';

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
}

export interface CaptureConsentResult {
  readonly captured: true;
  readonly consentId: AlaraId;
  readonly status: 'active';
  readonly eventId: string;
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
  readonly eventId: string;
}

export class ConsentCaptureValidationError extends Error {
  constructor(message: string) {
    super(`Consent capture rejected: ${message}`);
    this.name = 'ConsentCaptureValidationError';
  }
}

export class ConsentCaptureService {
  constructor(private readonly engine: ConsentEngine) {}

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

    const result = await this.engine.grant({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      grantorId: input.grantorId,
      recipientId: input.recipientId,
      permissionTypes: input.permissionTypes,
      effectiveDate: input.effectiveDate,
      expirationDate: input.expirationDate,
      actor: input.capturedBy,
    });

    return { captured: true, consentId: result.consentId, status: 'active', eventId: result.eventId };
  }

  /** Capture a withdrawal / decline → revoke the canonical consent via ConsentEngine.revoke. */
  async withdraw(input: WithdrawConsentInput): Promise<WithdrawConsentResult> {
    requireField('tenantId', input.tenantId);
    requireField('consentId', input.consentId);
    requireField('capturedBy', input.capturedBy);

    const result = await this.engine.revoke({
      tenantId: input.tenantId,
      consentId: input.consentId,
      actor: input.capturedBy,
    });

    return { withdrawn: true, consentId: result.consentId, status: 'revoked', eventId: result.eventId };
  }
}

function requireField(name: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    throw new ConsentCaptureValidationError(`${name} is required`);
  }
}
