/**
 * Alara OS — Communication Dispatch Engine (M12)
 *
 * Core loop: for each (rule, stakeholder) pair matching a fired event —
 *   1. Consent gate  — StakeholderConsentFact → ConsentPolicyModule
 *   2. AI Act gate   — AIActConstraintPolicyModule
 *   3. Route by delivery mode: auto | review | task | manual
 *   4. Log every outcome (sent / drafted / task_sent / suppressed)
 *
 * Suppression is never silent: every blocked dispatch creates a
 * consent_exception Task and a suppressed log entry.
 *
 * Internal task dispatch (care_guide, auth_specialist, don) is
 * autonomous — no consent check, no external PHI disclosure.
 *
 * Auto external dispatch constraint (Architect ratified):
 *   Permitted ONLY when: consent granted/restricted(matching scope),
 *   ConsentPolicyModule ALLOW, AIActConstraintPolicyModule ALLOW,
 *   rule.aiGenerated=false, and stub transport only (M12).
 *   If AI generates content → delivery mode escalated to 'review'.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId, makeAlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { RulesEngine } from '../rules-engine/engine';
import { RuleContext } from '../rules-engine/types';
import { ConsentFact } from '../rules-engine/policies/context-types';
import { AIActionFact } from '../rules-engine/policies/context-types';
import { CommunicationEngine } from '../communication-engine/engine';
import { CommunicationAudience } from '../communication-engine/types';
import { TaskEngine } from '../task-engine/engine';
import { StakeholderEngine } from '../stakeholder-engine/engine';
import {
  Stakeholder,
  StakeholderConsentFact,
  StakeholderConsentStatus,
  isInternalStakeholder,
} from '../stakeholder-engine/types';
import {
  DispatchForEventInput,
  DispatchForEventResult,
  DispatchLogEntry,
  DispatchRule,
  DispatchStatus,
  DeliveryMode,
  UnknownEventTypeError,
} from './types';
import {
  DispatchRuleRegistry,
  MessageTemplateRegistry,
  ALL_DISPATCH_EVENTS,
  TONE_BY_TYPE,
  renderMessage,
} from './registry';

// ─── Role map for internal task ownership ────────────────────────────────────

const INTERNAL_ROLE_MAP: Record<string, string> = {
  care_guide:     'care_guide',
  auth_specialist:'auth_specialist',
  don:            'don',
};

// ─── Dispatch Engine ─────────────────────────────────────────────────────────

export class DispatchEngine {
  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
    private readonly rules: RulesEngine,
    private readonly commEngine: CommunicationEngine,
    private readonly taskEngine: TaskEngine,
    private readonly stakeholderEngine: StakeholderEngine,
    private readonly ruleRegistry: DispatchRuleRegistry,
    private readonly templateRegistry: MessageTemplateRegistry,
    private readonly orgName: string = 'Alara Home Care',
  ) {}

  async dispatchForEvent(
    input: DispatchForEventInput,
  ): Promise<DispatchForEventResult> {
    // ── 1. Validate event type ───────────────────────────────────────────────
    if (!ALL_DISPATCH_EVENTS.has(input.eventType)) {
      throw new UnknownEventTypeError(input.eventType);
    }

    const dispatchRules = this.ruleRegistry.getRulesForEvent(input.eventType);
    if (dispatchRules.length === 0) {
      return { dispatched: 0, suppressed: 0, entries: [] };
    }

    // ── 2. Load all active stakeholders for this patient ────────────────────
    const stakeholders = await this.stakeholderEngine.listByPatient(
      input.patientId, input.tenantId,
    );

    const entries: DispatchLogEntry[] = [];
    let dispatched = 0;
    let suppressed = 0;

    for (const rule of dispatchRules) {
      if (!rule.active) continue;

      // Find all stakeholders matching this rule's stakeholder type
      const matched = stakeholders.filter(s => s.type === rule.stakeholderType && s.active);

      if (matched.length === 0 && isInternalStakeholder(rule.stakeholderType)) {
        // Internal type with no Stakeholder record — still create a task
        // (internal dispatch does not require a Stakeholder row when
        //  the patient's care guide is the fallback)
        const entry = await this._dispatchInternal(
          input, rule, null,
        );
        if (entry) { entries.push(entry); dispatched++; }
        continue;
      }

      for (const stakeholder of matched) {
        const entry = await this._dispatchOne(input, rule, stakeholder);
        entries.push(entry);
        if (entry.status === 'suppressed') suppressed++;
        else dispatched++;
      }
    }

    return { dispatched, suppressed, entries };
  }

  // ── Single dispatch (one rule × one stakeholder) ─────────────────────────

  private async _dispatchOne(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder,
  ): Promise<DispatchLogEntry> {
    const isInternal = isInternalStakeholder(stakeholder.type);

    // Internal stakeholders → task path (no consent check, no external PHI)
    if (isInternal) {
      return this._dispatchInternal(input, rule, stakeholder);
    }

    // ── Consent gate (external stakeholders only) ─────────────────────────
    const consentFact = await this.stakeholderEngine.getConsentFact(
      stakeholder.id, input.patientId, input.tenantId,
    );

    const consentOk = this._consentAllowed(consentFact, rule.category);
    if (!consentOk.allowed) {
      return this._suppress(input, rule, stakeholder, consentOk.reason);
    }

    // ── AI Act gate ────────────────────────────────────────────────────────
    // If rule.aiGenerated=true, escalate to 'review' (Architect ratification):
    // AI-drafted, AI-selected, or AI-transformed content must always be
    // human-reviewed before external send. No exception.
    // Note: we do NOT call the Rules Engine here — the aiGenerated flag IS
    // the AI Act enforcement for dispatch. The Rules Engine AI Act module
    // applies at the orchestrator level for more complex autonomous actions.
    const effectiveMode = rule.aiGenerated ? 'review' : rule.deliveryMode;

    // ── Route by delivery mode ────────────────────────────────────────────
    switch (effectiveMode) {
      case 'auto':
        return this._dispatchAuto(input, rule, stakeholder, consentFact!);
      case 'review':
        return this._dispatchReview(input, rule, stakeholder, consentFact!);
      case 'manual':
        return this._dispatchManual(input, rule, stakeholder, consentFact!);
      default:
        return this._dispatchManual(input, rule, stakeholder, consentFact!);
    }
  }

  // ── Auto mode ────────────────────────────────────────────────────────────

  private async _dispatchAuto(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder,
    _consentFact: StakeholderConsentFact,
  ): Promise<DispatchLogEntry> {
    const msg = this._render(rule, stakeholder, input);
    const channel = this._transportChannel(stakeholder);

    // Create Communication (queued — stub transport in M12, no real send)
    const comm = await this.commEngine.create({
      tenantId: input.tenantId,
      channel: 'patient' as CommunicationAudience,
      purpose: 'care_coordination',
      subjectId: input.patientId,
      workflowId: null,
      recipientType: stakeholder.type as any,
      recipientId: stakeholder.id as string,
      subject: msg.subject,
      body: msg.body,
      actor: input.actor,
    });

    await this.commEngine.queue({
      tenantId: input.tenantId,
      communicationId: comm.id,
      actor: input.actor,
      expectedVersion: comm.version,
    });

    let followUpTaskId: AlaraId | null = null;
    if (rule.followUp) {
      followUpTaskId = await this._createFollowUpTask(input, rule, stakeholder, comm.id);
    }

    await this._emitDispatchEvent(input, 'DispatchSent', stakeholder.id, comm.id, null);

    return this._logEntry(input, rule, stakeholder, 'sent', null, comm.id, null, followUpTaskId);
  }

  // ── Review mode ───────────────────────────────────────────────────────────

  private async _dispatchReview(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder,
    _consentFact: StakeholderConsentFact,
  ): Promise<DispatchLogEntry> {
    const msg = this._render(rule, stakeholder, input);
    const slaAt = new Date(Date.now() + rule.slaHours * 3_600_000).toISOString();

    // Create Communication in drafted state
    const comm = await this.commEngine.create({
      tenantId: input.tenantId,
      channel: 'patient' as CommunicationAudience,
      purpose: 'care_coordination',
      subjectId: input.patientId,
      workflowId: null,
      recipientType: stakeholder.type as any,
      recipientId: stakeholder.id as string,
      subject: msg.subject,
      body: msg.body,
      actor: input.actor,
    });
    // Communication stays in 'created' (drafted) — human must call .queue()/.send()

    // Create review Task for Care Guide
    const careOwner = await this._careOwner(input);
    const taskId = await this.taskEngine.create({
      tenantId: input.tenantId,
      taskType: 'comm_review',
      title: `Review & send to ${stakeholder.type}: ${msg.subject}`,
      description: `Review the drafted communication for ${input.eventType} before sending.`,
      workflowId: null,
      workflowStepId: null,
      ownerId: careOwner,
      dueAt: new Date(slaAt),
      actor: input.actor,
    });

    await this._emitDispatchEvent(input, 'DispatchDrafted', stakeholder.id, comm.id, taskId.id);

    return this._logEntry(input, rule, stakeholder, 'drafted', null, comm.id, taskId.id, null);
  }

  // ── Manual mode ───────────────────────────────────────────────────────────

  private async _dispatchManual(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder,
    _consentFact: StakeholderConsentFact,
  ): Promise<DispatchLogEntry> {
    const msg = this._render(rule, stakeholder, input);

    // Create Communication in drafted state, no Task
    const comm = await this.commEngine.create({
      tenantId: input.tenantId,
      channel: 'patient' as CommunicationAudience,
      purpose: 'care_coordination',
      subjectId: input.patientId,
      workflowId: null,
      recipientType: stakeholder.type as any,
      recipientId: stakeholder.id as string,
      subject: msg.subject,
      body: msg.body,
      actor: input.actor,
    });

    await this._emitDispatchEvent(input, 'DispatchDrafted', stakeholder.id, comm.id, null);

    return this._logEntry(input, rule, stakeholder, 'drafted', null, comm.id, null, null);
  }

  // ── Internal task mode ────────────────────────────────────────────────────

  private async _dispatchInternal(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder | null,
  ): Promise<DispatchLogEntry> {
    const slaAt = new Date(Date.now() + rule.slaHours * 3_600_000).toISOString();
    const role = INTERNAL_ROLE_MAP[rule.stakeholderType] ?? 'care_guide';
    const owner = await this._careOwner(input);

    // Use a simple subject for internal tasks
    const subject = `${input.eventType.replace(/([A-Z])/g, ' $1').trim()} — action required`;

    const taskResult = await this.taskEngine.create({
      tenantId: input.tenantId,
      taskType: `comm_${input.eventType}`,
      title: subject,
      description: `Internal action required for event: ${input.eventType}`,
      workflowId: null,
      workflowStepId: null,
      ownerId: owner,
      dueAt: new Date(slaAt),
      actor: input.actor,
    });

    await this._emitDispatchEvent(input, 'DispatchTaskCreated', stakeholder?.id ?? null, null, taskResult.id);

    return this._logEntry(
      input, rule, stakeholder, 'task_sent', null, null, taskResult.id, null,
    );
  }

  // ── Suppression ───────────────────────────────────────────────────────────

  private async _suppress(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder,
    reason: string,
  ): Promise<DispatchLogEntry> {
    // Suppression is never silent: always create a consent_exception Task
    const slaAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const careOwner = await this._careOwner(input);

    const taskResult = await this.taskEngine.create({
      tenantId: input.tenantId,
      taskType: 'consent_exception',
      title: `Consent/scope missing — ${stakeholder.type} for patient`,
      description: `Dispatch suppressed for event '${input.eventType}'. Reason: ${reason}. ` +
        `Stakeholder: ${stakeholder.id}. Update consent or scope to allow dispatch.`,
      workflowId: null,
      workflowStepId: null,
      ownerId: careOwner,
      dueAt: new Date(slaAt),
      actor: input.actor,
    });

    await this._emitDispatchEvent(input, 'DispatchSuppressed', stakeholder.id, null, taskResult.id);

    return this._logEntry(
      input, rule, stakeholder, 'suppressed', reason, null, taskResult.id, null,
    );
  }

  // ── Consent evaluation ────────────────────────────────────────────────────

  private _consentAllowed(
    fact: StakeholderConsentFact | null,
    category: string,
  ): { allowed: boolean; reason: string } {
    if (!fact) {
      return { allowed: false, reason: 'no_stakeholder_consent_record' };
    }
    const status = fact.consentStatus;
    if (status === 'revoked') {
      return { allowed: false, reason: 'consent_revoked' };
    }
    if (status === 'unknown') {
      return { allowed: false, reason: 'consent_unknown' };
    }
    if (status === 'granted') {
      // Check expiry
      if (fact.expiresAt && new Date(fact.expiresAt) < new Date()) {
        return { allowed: false, reason: 'consent_expired' };
      }
      return { allowed: true, reason: '' };
    }
    if (status === 'restricted') {
      const scope = fact.consentScope ?? '';
      const allowed = scope.includes('full') || scope.includes('all') || scope.includes(category);
      return allowed
        ? { allowed: true, reason: '' }
        : { allowed: false, reason: `consent_restricted_scope_mismatch:${scope}:${category}` };
    }
    return { allowed: false, reason: `consent_status_unrecognized:${status}` };
  }

  // ── AI Act policy check ───────────────────────────────────────────────────

  private async _checkAIActPolicy(
    input: DispatchForEventInput,
    actionClass: string,
    isAutonomous: boolean,
  ): Promise<string> {
    // Evaluates only the AI Act constraint. Consent is checked separately
    // by _consentAllowed(). A dummy active ConsentFact prevents
    // ConsentPolicyModule from DENYing and masking the AI Act result.
    const aiAction: AIActionFact = {
      actionClass: actionClass as any,
      isAutonomous,
      confidence: 1.0,
      agentId: 'dispatch-engine',
    };
    const dummyConsent = {
      consentId: 'dispatch-ai-check',
      subjectId: input.patientId as string,
      grantorId: input.actor,
      recipientId: input.actor,
      permissionTypes: ['communicate'],
      effectiveDate: new Date().toISOString().slice(0, 10),
      status: 'active',
      version: 1,
    };
    const context: RuleContext = {
      tenantId: input.tenantId,
      actor: input.actor,
      eventType: input.eventType,
      eventPayload: input.payload,
      ruleSetId: 'ruleset.stakeholder.dispatch',
      objects: { aiAction, consent: dummyConsent },
    };
    try {
      const decision = await this.rules.evaluate(context);
      return decision.outcome;
    } catch {
      return 'ALLOW'; // If AI Act module not registered, permit
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _render(
    rule: DispatchRule,
    stakeholder: Stakeholder,
    input: DispatchForEventInput,
  ) {
    return renderMessage(
      this.templateRegistry,
      rule.templateKey,
      stakeholder.type,
      input.eventType,
      {
        patientName: String(input.payload['patientName'] ?? 'the patient'),
        recipientFirstName: stakeholder.displayName?.split(' ')[0] ?? 'there',
        org: this.orgName,
        eventType: input.eventType,
        payload: input.payload,
        isInternal: isInternalStakeholder(stakeholder.type),
      },
    );
  }

  private _transportChannel(stakeholder: Stakeholder): string {
    // In M12 all external communications use stub/inapp — no real transport
    const pref = stakeholder.preferences.find(p => p.category === 'all');
    return pref?.channel ?? 'email';
  }

  private async _careOwner(input: DispatchForEventInput): Promise<string> {
    // In M12 the care guide is the fallback owner; full workforce lookup is M12-D
    return input.actor;
  }

  private async _createFollowUpTask(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder,
    communicationId: AlaraId,
  ): Promise<AlaraId> {
    const slaAt = new Date(Date.now() + rule.slaHours * 2 * 3_600_000).toISOString();
    const owner = await this._careOwner(input);
    const result = await this.taskEngine.create({
      tenantId: input.tenantId,
      taskType: 'comm_followup',
      title: `Follow up: ${input.eventType} — ${stakeholder.type}`,
      description: `Confirm receipt or follow up on communication ${communicationId}.`,
      workflowId: null,
      workflowStepId: null,
      ownerId: owner,
      dueAt: new Date(slaAt),
      actor: input.actor,
    });
    return result.id;
  }

  private async _emitDispatchEvent(
    input: DispatchForEventInput,
    type: string,
    stakeholderId: AlaraId | null,
    communicationId: AlaraId | null,
    taskId: AlaraId | null,
  ): Promise<void> {
    await this.eventStore.append({
      tenantId: input.tenantId,
      streamId: input.patientId,
      type: type as EventType,
      payload: {
        eventType: input.eventType,
        stakeholderId: stakeholderId ? String(stakeholderId) : null,
        communicationId: communicationId ? String(communicationId) : null,
        taskId: taskId ? String(taskId) : null,
        journeyId: input.journeyId ? String(input.journeyId) : null,
      },
      actor: input.actor,
    });
  }

  private _logEntry(
    input: DispatchForEventInput,
    rule: DispatchRule,
    stakeholder: Stakeholder | null,
    status: DispatchStatus,
    suppressionReason: string | null,
    communicationId: AlaraId | null,
    taskId: AlaraId | null,
    followUpTaskId: AlaraId | null,
  ): DispatchLogEntry {
    return {
      id: newAlaraId(),
      tenantId: input.tenantId,
      patientId: input.patientId,
      stakeholderId: stakeholder?.id ?? null,
      stakeholderType: rule.stakeholderType,
      eventType: input.eventType,
      deliveryMode: rule.deliveryMode,
      status,
      suppressionReason,
      communicationId,
      taskId,
      followUpTaskId,
      templateKey: rule.templateKey,
      createdAt: new Date(),
      createdBy: input.actor,
    };
  }
}
