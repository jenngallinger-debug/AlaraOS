/**
 * Alara OS API — REST Request/Response Types
 */

// ─── POST /commands/referrals ─────────────────────────────────────────────────

export interface CreateReferralBody {
  tenantId: string;
  patientName: string;
  programType: string;
  referralSource: string;
  referralDate: string;
  automyndPatientId: string;
  automyndReferralId: string;
  actor?: string;
  /** Optional data integrity flags to pre-check before running the slice */
  dataIntegrityFlags?: {
    field: string;
    automyndValue: unknown;
    alaraValue: unknown;
  }[];
}

export interface CreateReferralResponse {
  success: boolean;
  patientId?: string;
  workflowId?: string;
  taskId?: string;
  promiseId?: string;
  communicationId?: string;
  projectionIds: {
    timeline?: string;
    digitalCareTwin?: string;
  };
  decisionSummary: {
    outcome: 'allowed' | 'denied';
    explanation?: string;
    appliedRules?: { ruleId: string; outcome: string; reason: string }[];
  };
  error?: string;
}

// ─── POST /commands/events ────────────────────────────────────────────────────

export interface EmitEventBody {
  tenantId: string;
  streamId: string;
  type: string;
  payload: Record<string, unknown>;
  actor: string;
}

export interface EmitEventResponse {
  eventId: string;
  seq: number;
  type: string;
  streamId: string;
}

// ─── POST /webhooks/automynd ──────────────────────────────────────────────────

export interface AutomyndWebhookBody {
  eventType: 'patient.observed' | 'referral.observed' | 'visit.observed' | 'order.observed';
  tenantId: string;
  payload: Record<string, unknown>;
}

export interface AutomyndWebhookResponse {
  received: boolean;
  alaraEventId?: string;
  message: string;
}

// ─── Error response ───────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}
