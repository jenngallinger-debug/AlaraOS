/**
 * Alara OS — Communication Dispatch Engine Types (M12)
 *
 * Constitutional alignment:
 *   "Alara communicates on behalf of the organization with full organizational
 *    memory, context, and coordination." (Part XI)
 *
 * Dispatch OWNS:
 *   - The routing decision (whether to dispatch, to whom, in which mode)
 *   - Delivery mode determination (auto / review / task / manual)
 *   - The consent gate (reads StakeholderConsentFact → ConsentPolicyModule)
 *   - The suppression record (suppressed log + consent_exception Task)
 *   - The communication draft creation (handoff to CommunicationEngine)
 *   - The internal task creation (handoff to TaskEngine)
 *   - The follow-up task when a rule requires post-send confirmation
 *
 * Dispatch does NOT own:
 *   - Transport (email/SMS/fax/portal) — M13+ CommunicationDeliveryAdapter
 *   - Communication object lifecycle — owned by CommunicationEngine
 *   - Task lifecycle — owned by TaskEngine
 *   - Consent state — owned by StakeholderEngine
 *   - Stakeholder identity — owned by StakeholderEngine
 *   - Journey event emission — owned by JourneyEngine
 *   - Clinical content — owned by Automynd, never enters dispatch
 *
 * Auto mode constraint (Architect ratified):
 *   Auto external dispatch is permitted ONLY when ALL of:
 *   1. Stakeholder consent is 'granted' or 'restricted' with matching category
 *   2. ConsentPolicyModule returns ALLOW
 *   3. AIActConstraintPolicyModule returns ALLOW for the exact action class
 *   4. The rule is explicitly configured for 'auto'
 *   5. The resulting Communication only queues through stub/no-real-transport (M12)
 *   If AI drafts, selects, personalizes, or materially transforms content:
 *   delivery mode MUST be 'review', not 'auto'.
 *
 * PHI constraint (M12):
 *   No PHI in external message bodies. Messages reference events by label only.
 *   Patient name in subject line for internal communications only.
 *
 * Not built in M12:
 *   Real transport, PHI bodies, public portal messaging, PEL/website wiring,
 *   payer/DOL integrations, digest cron, M13+ work.
 */

import { AlaraId } from '../shared/types';
import { StakeholderType } from '../stakeholder-engine/types';

// ─── Delivery mode ────────────────────────────────────────────────────────────

export type DeliveryMode = 'auto' | 'review' | 'task' | 'manual';

export type CommunicationCategory =
  | 'all' | 'clinical' | 'benefits' | 'status' | 'scheduling';

// ─── Dispatch rule ────────────────────────────────────────────────────────────

/**
 * A dispatch rule defines what happens when a given event fires for a given
 * stakeholder type. Rules are seeded data — the engine is generic.
 * Adding a new (event, stakeholder) behavior is a data change, not a code change.
 *
 * Auto mode: only permitted for deterministic, pre-approved, non-AI-generated,
 * non-PHI template messages (Architect ratified constraint).
 */
export interface DispatchRule {
  readonly id: string;
  readonly eventType: string;
  readonly stakeholderType: StakeholderType;
  /** Category used for restricted consent scope matching */
  readonly category: CommunicationCategory;
  readonly deliveryMode: DeliveryMode;
  /** Key into MessageTemplateRegistry; null = generic tone-based fallback */
  readonly templateKey: string | null;
  /**
   * aiGenerated: if true, delivery mode must be 'review' regardless of rule config.
   * Enforced by DispatchEngine before routing.
   */
  readonly aiGenerated: boolean;
  /** Whether to create a follow-up Task after auto/manual send */
  readonly followUp: boolean;
  readonly slaHours: number;
  readonly active: boolean;
}

// ─── Message template ─────────────────────────────────────────────────────────

export type MessageTone =
  | 'operational'
  | 'reassuring'
  | 'benefit_execution'
  | 'neutral_compliant'
  | 'task_action';

export interface MessageTemplate {
  readonly key: string;
  readonly eventType: string;
  readonly stakeholderType: StakeholderType;
  readonly tone: MessageTone;
  /**
   * Subject and body use {event_label} and {org} placeholders only.
   * No PHI placeholders. External templates may not include patient name,
   * DOB, MRN, payer IDs, or clinical detail.
   * Internal templates (channel=inapp) may include {patient_name}.
   */
  readonly subject: string;
  readonly body: string;
}

// ─── Rendered message ─────────────────────────────────────────────────────────

export interface RenderedMessage {
  readonly subject: string;
  readonly body: string;
  readonly templateKey: string | null;
  readonly tone: MessageTone;
}

// ─── Dispatch log ─────────────────────────────────────────────────────────────

export type DispatchStatus =
  | 'sent'        // auto or human-sent: Communication queued
  | 'drafted'     // review or manual: Communication in drafted state
  | 'task_sent'   // internal: Task created, inapp log
  | 'suppressed'; // consent/scope/policy blocked dispatch

export interface DispatchLogEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: AlaraId;
  readonly stakeholderId: AlaraId | null;
  readonly stakeholderType: StakeholderType;
  readonly eventType: string;
  readonly deliveryMode: DeliveryMode;
  readonly status: DispatchStatus;
  readonly suppressionReason: string | null;
  readonly communicationId: AlaraId | null;   // if Communication was created
  readonly taskId: AlaraId | null;            // if Task was created
  readonly followUpTaskId: AlaraId | null;
  readonly templateKey: string | null;
  readonly createdAt: Date;
  readonly createdBy: string;
}

// ─── Dispatch input / output ──────────────────────────────────────────────────

export interface DispatchForEventInput {
  readonly tenantId: string;
  readonly patientId: AlaraId;
  readonly eventType: string;
  readonly eventId: string;
  readonly payload: Record<string, unknown>;
  readonly actor: string;
  /** Journey ID if this event originated from a Journey (optional) */
  readonly journeyId?: AlaraId;
}

export interface DispatchForEventResult {
  readonly dispatched: number;
  readonly suppressed: number;
  readonly entries: readonly DispatchLogEntry[];
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class UnknownEventTypeError extends Error {
  constructor(eventType: string) {
    super(`Unknown dispatch event type: '${eventType}'`);
    this.name = 'UnknownEventTypeError';
  }
}

export class DispatchConsentError extends Error {
  constructor(stakeholderId: string, reason: string) {
    super(`Dispatch suppressed for stakeholder ${stakeholderId}: ${reason}`);
    this.name = 'DispatchConsentError';
  }
}
