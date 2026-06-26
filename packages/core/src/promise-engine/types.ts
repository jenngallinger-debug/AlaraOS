/**
 * Alara OS — Promise Engine Types
 *
 * "Every promise made by Alara becomes an object." (Part XI)
 * "Patients should never remind Alara about promises." (Part XI)
 *
 * A Promise is a commitment — tracked from creation to fulfillment or void.
 * No promise disappears silently. Every terminal transition emits an event.
 */

import { AlaraId } from '../shared/types';

export type PromiseStatus = 'open' | 'kept' | 'missed' | 'voided';

export type VoidReason =
  | 'consent-revoked'   // JV-004: consent revocation may void promises
  | 'workflow-suppressed'
  | 'patient-discharged'
  | 'duplicate'
  | 'manual'
  | string;             // extensible

export interface AlaraPromise {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly description: string;
  /** Alara UUID of the Patient / subject */
  readonly subjectId: AlaraId;
  /** Alara UUID of the recipient (family member, referral source, etc.) */
  readonly recipientId: string;
  /** Alara UUID of the workforce member responsible */
  readonly ownerId: string;
  readonly status: PromiseStatus;
  readonly dueAt: Date;
  readonly keptAt: Date | null;
  readonly missedAt: Date | null;
  readonly voidedAt: Date | null;
  readonly voidReason: VoidReason | null;
  /** Alara UUID of the workflow that created this promise */
  readonly workflowId: AlaraId | null;
  readonly workflowStepId: string | null;
  readonly version: number;
}

export interface CreatePromiseCommand {
  readonly tenantId: string;
  readonly description: string;
  readonly subjectId: AlaraId;
  readonly recipientId: string;
  readonly ownerId: string;
  readonly dueAt: Date;
  readonly workflowId: AlaraId | null;
  readonly workflowStepId: string | null;
  readonly actor: string;
}

export interface KeepPromiseCommand {
  readonly tenantId: string;
  readonly promiseId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface MissPromiseCommand {
  readonly tenantId: string;
  readonly promiseId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface VoidPromiseCommand {
  readonly tenantId: string;
  readonly promiseId: AlaraId;
  readonly reason: VoidReason;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface PromiseCreatedPayload {
  promiseId: string; description: string; subjectId: string;
  recipientId: string; ownerId: string; dueAt: string;
  workflowId: string | null; workflowStepId: string | null;
}

export interface PromiseKeptPayload {
  promiseId: string; description: string; previousVersion: number;
}

export interface PromiseMissedPayload {
  promiseId: string; description: string; dueAt: string; previousVersion: number;
}

export interface PromiseVoidedPayload {
  promiseId: string; description: string; reason: VoidReason; previousVersion: number;
}
