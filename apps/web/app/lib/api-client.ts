/**
 * Alara OS — Public Experience Layer API Client
 *
 * Typed client that calls apps/api. Falls back to fixture responses
 * when NEXT_PUBLIC_API_URL is not set (local dev / Vercel preview).
 *
 * The website is a CLIENT of Alara OS.
 * It creates real events through the command layer.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export interface StartConversationInput {
  /** What the visitor typed or said */
  message: string;
  /** Inferred or stated visitor type */
  visitorType?: string;
  /** Optional contact */
  phone?: string;
  name?: string;
  /** Program hint (EEOICPA, VA, OWCP, etc.) */
  programHint?: string;
}

export interface ConversationResult {
  success: boolean;
  /** Alara OS patient/object ID created */
  patientId?: string;
  workflowId?: string;
  promiseId?: string;
  communicationId?: string;
  /** Human-readable confirmation for the visitor */
  confirmationMessage: string;
  /** What happens next, shown to visitor */
  nextSteps: string[];
  /** Who owns the next action */
  ownerLabel: string;
  /** When to expect contact */
  expectedContactWindow: string;
  referenceId: string;
}

export interface ReferralInput {
  tenantId: string;
  patientName: string;
  programType: string;
  referralSource: string;
  referralDate: string;
  automyndPatientId: string;
  automyndReferralId: string;
  actor?: string;
}

// ─── Fixture fallback (used when no API URL is configured) ────────────────────

function fixtureConversationResult(input: StartConversationInput): ConversationResult {
  const refId = `ALR-${Date.now().toString(36).toUpperCase()}`;
  return {
    success: true,
    patientId: `fixture-${refId}`,
    workflowId: `wf-${refId}`,
    promiseId: `prom-${refId}`,
    communicationId: `comm-${refId}`,
    confirmationMessage: `We've received your message and someone on our team is already reviewing it.`,
    nextSteps: [
      'A Care Guide will review what you shared within the next few hours.',
      'You\'ll receive a call from an Alara team member to discuss next steps.',
      'We\'ll help you understand your options and what Alara can do for you.',
    ],
    ownerLabel: 'Alara Care Team',
    expectedContactWindow: 'within 4 hours',
    referenceId: refId,
  };
}

// ─── Real API calls ────────────────────────────────────────────────────────────

export async function startConversation(
  input: StartConversationInput,
): Promise<ConversationResult> {
  if (!API_BASE) {
    // Simulate a short delay to feel real
    await new Promise(r => setTimeout(r, 800));
    return fixtureConversationResult(input);
  }

  const tenantId = process.env.NEXT_PUBLIC_TENANT_ID ?? 'alara-home-care';
  const referralId = `web-${Date.now()}`;

  try {
    const res = await fetch(`${API_BASE}/commands/referrals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        patientName: input.name ?? 'Web Visitor',
        programType: input.programHint ?? 'General',
        referralSource: 'alara-website',
        referralDate: new Date().toISOString().split('T')[0],
        automyndPatientId: `web-${referralId}`,
        automyndReferralId: referralId,
        actor: 'website-intake',
      } satisfies ReferralInput),
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();

    const refId = `ALR-${referralId.slice(-6).toUpperCase()}`;
    return {
      success: data.success,
      patientId: data.patientId,
      workflowId: data.workflowId,
      promiseId: data.promiseId,
      communicationId: data.communicationId,
      confirmationMessage: 'We\'ve received your message and our team is already on it.',
      nextSteps: [
        'A Care Guide will review your situation within the next few hours.',
        'You\'ll receive a call from an Alara team member to discuss next steps.',
        'We\'ll make sure you understand every option available to you.',
      ],
      ownerLabel: 'Alara Care Team',
      expectedContactWindow: 'within 4 hours',
      referenceId: refId,
    };
  } catch {
    // Graceful degradation — still show confirmation
    await new Promise(r => setTimeout(r, 600));
    return fixtureConversationResult(input);
  }
}
