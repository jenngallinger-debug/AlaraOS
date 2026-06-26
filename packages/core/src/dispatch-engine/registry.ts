/**
 * Alara OS — Dispatch Rule Registry (M12)
 *
 * In-memory rule and template registries. All behavioral specificity lives
 * in rule rows — the DispatchEngine is generic. Adding a new (event,
 * stakeholder type) behavior is a data change, not a code change.
 *
 * Auto mode rules: only deterministic, pre-approved, non-AI-generated,
 * non-PHI template messages. No AI-generated content in auto rules.
 * If content is AI-generated, deliveryMode must be 'review'.
 *
 * PHI constraint: all external message bodies use {event_label} and {org}
 * placeholders only. Patient name appears in internal (inapp) messages only.
 */

import {
  CommunicationCategory,
  DeliveryMode,
  DispatchRule,
  MessageTemplate,
  MessageTone,
  RenderedMessage,
} from './types';
import { StakeholderType } from '../stakeholder-engine/types';

// ─── Event label map ──────────────────────────────────────────────────────────

export const EVENT_LABELS: Record<string, [string, string]> = {
  // [short label, plain description]
  PatientCreated:              ['Case opened',          'A new case has been opened'],
  ReferralReceived:            ['Referral received',    'A referral has been received'],
  ReferralAcknowledged:        ['Referral acknowledged','Your referral has been acknowledged'],
  CaseAccepted:                ['Case accepted',        'The case has been accepted'],
  CaseDeclined:                ['Case declined',        'The case has been declined'],
  EligibilityConfirmed:        ['Eligibility confirmed','Benefit eligibility has been confirmed'],
  AuthorizationApproved:       ['Authorization approved','Payer authorization has been approved'],
  AuthorizationDenied:         ['Authorization denied', 'Payer authorization has been denied'],
  AuthorizationSubmitted:      ['Authorization submitted','Authorization has been submitted to the payer'],
  ReauthWindowOpened:          ['Reauthorization window opened','Reauthorization is due'],
  ReauthApproved:              ['Reauthorization approved','Reauthorization has been approved'],
  AppealFiled:                 ['Appeal filed',         'An appeal has been filed'],
  CoverageExpansionApproved:   ['Coverage expanded',    'Coverage expansion has been approved'],
  OrderRequested:              ['Order required',       'A physician order is required'],
  SOCScheduled:                ['Start of care scheduled','Start of care has been scheduled'],
  SOCCompleted:                ['Start of care completed','Start of care has been completed'],
  CaseStaffed:                 ['Case staffed',         'The case has been staffed'],
  StaffingStarted:             ['Staffing underway',    'Staffing is underway'],
  VisitCompleted:              ['Visit completed',       'A visit has been completed'],
  MissedVisit:                 ['Missed visit',         'A visit was missed'],
  ClinicalConcernRaised:       ['Clinical concern raised','A clinical concern has been raised'],
  HospitalizationRiskRaised:   ['Hospitalization risk', 'A hospitalization risk has been identified'],
  MissingInformation:          ['Information needed',   'Additional information is needed'],
  Discharged:                  ['Discharged',           'The patient has been discharged'],
};

export const ALL_DISPATCH_EVENTS = new Set(Object.keys(EVENT_LABELS));

// ─── Tone by stakeholder type ─────────────────────────────────────────────────

export const TONE_BY_TYPE: Record<StakeholderType, MessageTone> = {
  patient:            'reassuring',
  family:             'reassuring',
  physician:          'operational',
  case_manager:       'operational',
  discharge_planner:  'operational',
  owcp_nurse_cm:      'operational',
  employer_feca:      'operational',
  attorney:           'benefit_execution',
  authorized_rep:     'benefit_execution',
  dol_resource_center:'neutral_compliant',
  care_guide:         'task_action',
  auth_specialist:    'task_action',
  don:                'task_action',
};

// ─── Generic templates by tone ────────────────────────────────────────────────

export const GENERIC_BY_TONE: Record<MessageTone, [string, string]> = {
  operational:       [
    '{event_label} — {org}',
    'This is to inform you that the following has occurred regarding the case: {event_plain}.',
  ],
  reassuring:        [
    'Update on your case — {org}',
    'We wanted to keep you informed: {event_plain}. {detail}Our team is managing next steps.',
  ],
  benefit_execution: [
    '{event_label} — {org}',
    'Please be advised: {event_plain}. {detail}Contact us if you need supporting documentation.',
  ],
  neutral_compliant: [
    '{event_label} — {org}',
    'Notification: {event_plain}. {detail}',
  ],
  task_action:       [
    'Action required: {event_label}',
    '{event_plain} — {detail}Please review and take the required action.',
  ],
};

// ─── Rule registry ────────────────────────────────────────────────────────────

export class DispatchRuleRegistry {
  private readonly rules = new Map<string, DispatchRule[]>();

  register(rule: DispatchRule): void {
    const existing = this.rules.get(rule.eventType) ?? [];
    existing.push(rule);
    this.rules.set(rule.eventType, existing);
  }

  getRulesForEvent(eventType: string): readonly DispatchRule[] {
    return this.rules.get(eventType) ?? [];
  }

  hasEvent(eventType: string): boolean {
    return ALL_DISPATCH_EVENTS.has(eventType);
  }

  allEventTypes(): readonly string[] {
    return [...ALL_DISPATCH_EVENTS];
  }
}

// ─── Message template registry ────────────────────────────────────────────────

export class MessageTemplateRegistry {
  private readonly templates = new Map<string, MessageTemplate>();

  register(template: MessageTemplate): void {
    this.templates.set(template.key, template);
  }

  getTemplate(key: string): MessageTemplate | null {
    return this.templates.get(key) ?? null;
  }
}

// ─── Message renderer ─────────────────────────────────────────────────────────

interface RenderContext {
  patientName: string;
  recipientFirstName: string;
  org: string;
  eventType: string;
  payload: Record<string, unknown>;
  isInternal: boolean;
}

class SafeMap {
  constructor(private readonly ctx: Record<string, string>) {}
  get(key: string): string { return this.ctx[key] ?? ''; }
}

function render(text: string, ctx: Record<string, string>): string {
  try {
    return text.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
  } catch {
    return text;
  }
}

export function renderMessage(
  templateRegistry: MessageTemplateRegistry,
  ruleTemplateKey: string | null,
  stakeholderType: StakeholderType,
  eventType: string,
  ctx: RenderContext,
): RenderedMessage {
  const [label, plain] = EVENT_LABELS[eventType] ?? [eventType, eventType];
  const detail = ctx.payload['detail'] ? String(ctx.payload['detail']) + ' ' : '';
  const tone = TONE_BY_TYPE[stakeholderType] ?? 'operational';

  const renderCtx: Record<string, string> = {
    event_label: label,
    event_plain: plain,
    detail,
    org: ctx.org,
    recipient_first: ctx.recipientFirstName,
    // Patient name only in internal (inapp) messages — no PHI in external bodies
    patient_name: ctx.isInternal ? ctx.patientName : 'the patient',
    action: String(ctx.payload['action'] ?? 'Review and handle this case event.'),
  };

  if (ruleTemplateKey) {
    const tmpl = templateRegistry.getTemplate(ruleTemplateKey);
    if (tmpl) {
      return {
        subject: render(tmpl.subject, renderCtx),
        body: render(tmpl.body, renderCtx),
        templateKey: ruleTemplateKey,
        tone: tmpl.tone,
      };
    }
  }

  const [subjectTpl, bodyTpl] = GENERIC_BY_TONE[tone];
  return {
    subject: render(subjectTpl, renderCtx),
    body: render(bodyTpl, renderCtx),
    templateKey: null,
    tone,
  };
}

// ─── Seed data ────────────────────────────────────────────────────────────────

/** Seed the rule registry with the initial high-value dispatch rules. */
export function seedDispatchRules(registry: DispatchRuleRegistry): void {
  const rules: Omit<DispatchRule, 'id'>[] = [
    // ── Patient / Family (reassuring, on_milestone) ─────────────────────────
    { eventType: 'EligibilityConfirmed',  stakeholderType: 'patient',   category: 'status',   deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'AuthorizationApproved', stakeholderType: 'patient',   category: 'status',   deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'SOCScheduled',          stakeholderType: 'patient',   category: 'scheduling',deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'SOCCompleted',          stakeholderType: 'patient',   category: 'status',   deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'AuthorizationDenied',   stakeholderType: 'patient',   category: 'status',   deliveryMode: 'review', templateKey: null, aiGenerated: false, followUp: true,  slaHours: 4,  active: true },
    { eventType: 'EligibilityConfirmed',  stakeholderType: 'family',    category: 'status',   deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'AuthorizationApproved', stakeholderType: 'family',    category: 'status',   deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'SOCCompleted',          stakeholderType: 'family',    category: 'status',   deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'MissedVisit',           stakeholderType: 'family',    category: 'status',   deliveryMode: 'review', templateKey: null, aiGenerated: false, followUp: true,  slaHours: 4,  active: true },

    // ── Physician (operational, fax in prod, inapp stub in M12) ────────────
    { eventType: 'OrderRequested',        stakeholderType: 'physician',  category: 'status',  deliveryMode: 'review', templateKey: null, aiGenerated: false, followUp: true,  slaHours: 4,  active: true },
    { eventType: 'SOCCompleted',          stakeholderType: 'physician',  category: 'status',  deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'MissedVisit',           stakeholderType: 'physician',  category: 'status',  deliveryMode: 'review', templateKey: null, aiGenerated: false, followUp: true,  slaHours: 4,  active: true },
    { eventType: 'ClinicalConcernRaised', stakeholderType: 'physician',  category: 'clinical',deliveryMode: 'review', templateKey: null, aiGenerated: false, followUp: true,  slaHours: 2,  active: true },

    // ── Case manager / Discharge planner (operational) ──────────────────────
    { eventType: 'AuthorizationApproved', stakeholderType: 'case_manager',    category: 'status', deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'CaseAccepted',          stakeholderType: 'case_manager',    category: 'status', deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'SOCScheduled',          stakeholderType: 'case_manager',    category: 'status', deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'SOCCompleted',          stakeholderType: 'case_manager',    category: 'status', deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'MissedVisit',           stakeholderType: 'case_manager',    category: 'status', deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'Discharged',            stakeholderType: 'case_manager',    category: 'status', deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'CaseAccepted',          stakeholderType: 'discharge_planner',category: 'status',deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'SOCCompleted',          stakeholderType: 'discharge_planner',category: 'status',deliveryMode: 'auto',   templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },

    // ── Attorney / Authorized rep (benefit_execution) ───────────────────────
    { eventType: 'AuthorizationApproved', stakeholderType: 'attorney',        category: 'benefits',deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'AuthorizationDenied',   stakeholderType: 'attorney',        category: 'benefits',deliveryMode: 'review',templateKey: null, aiGenerated: false, followUp: true,  slaHours: 12, active: true },
    { eventType: 'AppealFiled',           stakeholderType: 'attorney',        category: 'benefits',deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 12, active: true },
    { eventType: 'AuthorizationApproved', stakeholderType: 'authorized_rep',  category: 'benefits',deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },

    // ── DOL / OWCP / Employer (neutral_compliant / operational) ────────────
    { eventType: 'AuthorizationApproved', stakeholderType: 'dol_resource_center', category: 'benefits', deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'AuthorizationApproved', stakeholderType: 'owcp_nurse_cm',        category: 'status',   deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'SOCCompleted',          stakeholderType: 'owcp_nurse_cm',        category: 'status',   deliveryMode: 'auto',  templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'MissedVisit',           stakeholderType: 'owcp_nurse_cm',        category: 'status',   deliveryMode: 'review',templateKey: null, aiGenerated: false, followUp: true,  slaHours: 4,  active: true },
    { eventType: 'AuthorizationApproved', stakeholderType: 'employer_feca',        category: 'benefits', deliveryMode: 'manual',templateKey: null, aiGenerated: false, followUp: false, slaHours: 48, active: true },

    // ── Internal task rules (care_guide, auth_specialist, don) ─────────────
    { eventType: 'ReferralReceived',      stakeholderType: 'care_guide',       category: 'status', deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 4,  active: true },
    { eventType: 'MissedVisit',           stakeholderType: 'care_guide',       category: 'status', deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 2,  active: true },
    { eventType: 'ClinicalConcernRaised', stakeholderType: 'care_guide',       category: 'status', deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 1,  active: true },
    { eventType: 'HospitalizationRiskRaised', stakeholderType: 'care_guide',   category: 'status', deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 1,  active: true },
    { eventType: 'ReauthWindowOpened',    stakeholderType: 'auth_specialist',  category: 'benefits',deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 24, active: true },
    { eventType: 'AuthorizationDenied',   stakeholderType: 'auth_specialist',  category: 'benefits',deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 4,  active: true },
    { eventType: 'ClinicalConcernRaised', stakeholderType: 'don',              category: 'status', deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 1,  active: true },
    { eventType: 'HospitalizationRiskRaised', stakeholderType: 'don',          category: 'status', deliveryMode: 'task', templateKey: null, aiGenerated: false, followUp: false, slaHours: 1,  active: true },
  ];

  rules.forEach((r, i) => registry.register({ id: `rule-${String(i + 1).padStart(3, '0')}`, ...r }));
}
