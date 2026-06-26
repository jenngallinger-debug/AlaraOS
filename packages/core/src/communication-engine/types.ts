/**
 * Alara OS — Communication Engine Types
 *
 * Communications are first-class objects in the Alara OS operating system.
 * Every communication attempt is tracked: created → queued → sent → delivered/failed.
 *
 * Constitutional alignment:
 *   "Alara communicates on behalf of the organization with full organizational
 *    memory, context, and coordination." (Part XI)
 *
 * ADR-001 compliance: communications reference patients by Alara UUID only.
 * No clinical document content is embedded in communications.
 *
 * ADR-015: AI may DRAFT communications. It may NOT send them autonomously
 * to external recipients (communicate_external is a prohibited autonomous AI action).
 */

import { AlaraId } from '../shared/types';

// ─── Communication channel + recipient type ────────────────────────────────────

export type CommunicationChannel =
  | 'internal'       // within Alara OS (care team notification)
  | 'patient'        // to the patient directly
  | 'family'         // to a family member / authorized representative
  | 'physician'      // to the ordering/referring physician
  | 'referral_source'; // to the referral source organization

export type CommunicationStatus =
  | 'created'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed';

export type CommunicationPurpose =
  | 'referral_acknowledgement'
  | 'intake_notification'
  | 'task_assignment'
  | 'promise_confirmation'
  | 'care_coordination'
  | 'escalation'
  | 'general';

// ─── Communication object ─────────────────────────────────────────────────────

export interface Communication {
  readonly id: AlaraId;
  readonly tenantId: string;
  readonly channel: CommunicationChannel;
  readonly purpose: CommunicationPurpose;
  /** Alara UUID of the Patient this communication is about */
  readonly subjectId: AlaraId;
  /** Alara UUID of the Workflow this communication serves (if any) */
  readonly workflowId: AlaraId | null;
  /** Who receives this communication */
  readonly recipientType: CommunicationChannel;
  readonly recipientId: string;
  /** Human-readable subject line */
  readonly subject: string;
  /** Body — no clinical content (ADR-001) */
  readonly body: string;
  readonly status: CommunicationStatus;
  readonly createdAt: Date;
  readonly queuedAt: Date | null;
  readonly sentAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly failedAt: Date | null;
  readonly failureReason: string | null;
  /** Adapter that delivered this (e.g. 'internal', 'stub') */
  readonly adapterUsed: string | null;
  readonly version: number;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface CreateCommunicationCommand {
  readonly tenantId: string;
  readonly channel: CommunicationChannel;
  readonly purpose: CommunicationPurpose;
  readonly subjectId: AlaraId;
  readonly workflowId: AlaraId | null;
  readonly recipientType: CommunicationChannel;
  readonly recipientId: string;
  readonly subject: string;
  readonly body: string;
  readonly actor: string;
}

export interface QueueCommunicationCommand {
  readonly tenantId: string;
  readonly communicationId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface SendCommunicationCommand {
  readonly tenantId: string;
  readonly communicationId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface MarkDeliveredCommand {
  readonly tenantId: string;
  readonly communicationId: AlaraId;
  readonly actor: string;
  readonly expectedVersion: number;
}

export interface MarkFailedCommand {
  readonly tenantId: string;
  readonly communicationId: AlaraId;
  readonly reason: string;
  readonly actor: string;
  readonly expectedVersion: number;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface CommunicationCreatedPayload {
  communicationId: string;
  channel: CommunicationChannel;
  purpose: CommunicationPurpose;
  subjectId: string;
  workflowId: string | null;
  recipientType: CommunicationChannel;
  recipientId: string;
  subject: string;
}

export interface CommunicationQueuedPayload {
  communicationId: string;
  channel: CommunicationChannel;
  previousVersion: number;
}

export interface CommunicationSentPayload {
  communicationId: string;
  channel: CommunicationChannel;
  adapterUsed: string;
  previousVersion: number;
}

export interface CommunicationDeliveredPayload {
  communicationId: string;
  channel: CommunicationChannel;
  previousVersion: number;
}

export interface CommunicationFailedPayload {
  communicationId: string;
  channel: CommunicationChannel;
  reason: string;
  previousVersion: number;
}

// ─── Delivery adapter interface ────────────────────────────────────────────────

/**
 * Delivery adapters are plugged in per channel.
 * The stub adapter is used in tests and dev.
 * Future: EmailAdapter, SMSAdapter, FaxAdapter, SecureMessageAdapter.
 *
 * ADR-015: adapters may not autonomously send to external recipients
 * unless the communication was explicitly authorized by a human.
 */
export interface CommunicationDeliveryAdapter {
  readonly name: string;
  readonly supportedChannels: readonly CommunicationChannel[];
  deliver(communication: Communication): Promise<DeliveryResult>;
}

export interface DeliveryResult {
  readonly success: boolean;
  readonly adapterName: string;
  readonly externalReference?: string;
  readonly failureReason?: string;
}
