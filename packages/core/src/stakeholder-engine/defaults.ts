/**
 * Alara OS — Stakeholder Promise Profile Defaults (M11)
 *
 * The standing relational contract per stakeholder type.
 * Auto-seeded on Stakeholder creation. Operator-configurable post-creation.
 *
 * These defaults encode the organizational intelligence about what each
 * stakeholder type needs, fears, and expects. They are owned configuration
 * on the Stakeholder Object — not Promise Engine commitments.
 */

import { CommunicationCadence, CommunicationChannel, StakeholderPromiseProfile, StakeholderType } from './types';

export interface StakeholderDefaults {
  readonly profile: StakeholderPromiseProfile;
  readonly preferredChannel: CommunicationChannel;
  readonly preferredCadence: CommunicationCadence;
}

export const STAKEHOLDER_DEFAULTS: Partial<Record<StakeholderType, StakeholderDefaults>> = {
  patient: {
    preferredChannel: 'phone',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Get help and the maximum benefits I\'ve earned, without managing the system.',
      responsibilityTransferred: 'Alara confirms eligibility, handles paperwork, and coordinates all care.',
      successDefinition: 'Care arrives, costs nothing out of pocket, and I never chase anyone.',
      anxietyRisk: 'That I\'ll be denied, billed, or left to coordinate it alone.',
      communicationPromise: 'Plain-English updates at each milestone; you never manage the process.',
      updateTriggers: ['EligibilityConfirmed', 'AuthorizationApproved', 'SOCScheduled', 'ReauthApproved'],
    },
  },
  family: {
    preferredChannel: 'phone',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Keep my loved one safe and well cared for without becoming the unpaid coordinator.',
      responsibilityTransferred: 'Alara manages benefits and care coordination end to end.',
      successDefinition: 'My loved one is safe, benefits are handled, and I\'m kept informed.',
      anxietyRisk: 'That something falls through the cracks and lands on me.',
      communicationPromise: 'Reassuring updates at milestones; we flag anything that needs you.',
      updateTriggers: ['EligibilityConfirmed', 'AuthorizationApproved', 'SOCCompleted', 'MissedVisit'],
    },
  },
  physician: {
    preferredChannel: 'fax',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Manage the patient safely in the community with Alara monitoring and coordinating.',
      responsibilityTransferred: 'Alara monitors at home and coordinates; you handle orders and medical decisions.',
      successDefinition: 'Patient stays stable at home; I\'m told only when action is needed.',
      anxietyRisk: 'Being surprised by a deterioration or an unsigned order I wasn\'t told about.',
      communicationPromise: 'Concise operational updates; immediate flag when physician action is required.',
      updateTriggers: ['OrderRequested', 'SOCCompleted', 'ClinicalConcernRaised', 'MissedVisit'],
    },
  },
  case_manager: {
    preferredChannel: 'email',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Place the patient with the best option and reduce readmission risk.',
      responsibilityTransferred: 'Alara executes intake, authorization, staffing, and follow-through.',
      successDefinition: 'Smooth placement, no readmission, rigorous updates without chasing.',
      anxietyRisk: 'A placement that bounces back to me or goes quiet.',
      communicationPromise: 'Proactive status at every stage; you never have to chase the case.',
      updateTriggers: ['CaseAccepted', 'SOCScheduled', 'SOCCompleted', 'MissedVisit', 'Discharged'],
    },
  },
  discharge_planner: {
    preferredChannel: 'email',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Discharge to a reliable provider who handles timing, paperwork, and care.',
      responsibilityTransferred: 'Alara takes the case from referral through start of care.',
      successDefinition: 'Clean discharge, fast acceptance, no bounce-back.',
      anxietyRisk: 'Discharging to a provider who drops the ball.',
      communicationPromise: 'Acknowledged referral and status through to active care.',
      updateTriggers: ['CaseAccepted', 'SOCScheduled', 'SOCCompleted'],
    },
  },
  attorney: {
    preferredChannel: 'email',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Maximize my client\'s benefit entitlement without managing the medical logistics.',
      responsibilityTransferred: 'Alara handles care delivery and benefit execution; I handle legal strategy.',
      successDefinition: 'Client receives full authorized benefits; documentation is clean for appeals.',
      anxietyRisk: 'Gaps in authorization or documentation that compromise my client\'s case.',
      communicationPromise: 'Updates on authorization decisions and milestone events with documentation.',
      updateTriggers: ['AuthorizationApproved', 'AuthorizationDenied', 'AppealFiled', 'ReauthApproved'],
    },
  },
  authorized_rep: {
    preferredChannel: 'email',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Ensure the patient\'s interests are represented and care is properly authorized.',
      responsibilityTransferred: 'Alara coordinates authorization and care delivery on behalf of the patient.',
      successDefinition: 'Authorized care delivered; patient receives full entitled benefits.',
      anxietyRisk: 'Unauthorized actions or missed entitlements.',
      communicationPromise: 'Milestone updates requiring representative awareness or signature.',
      updateTriggers: ['AuthorizationApproved', 'AuthorizationDenied', 'ConsentRequired'],
    },
  },
  dol_resource_center: {
    preferredChannel: 'email',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Verify that the worker receives appropriate authorized home health benefits.',
      responsibilityTransferred: 'Alara executes the authorized care plan within the DOL framework.',
      successDefinition: 'Authorized services delivered; proper documentation maintained.',
      anxietyRisk: 'Non-compliant care or documentation gaps.',
      communicationPromise: 'Compliant, factual status updates on authorized care delivery.',
      updateTriggers: ['AuthorizationApproved', 'SOCCompleted', 'Discharged'],
    },
  },
  owcp_nurse_cm: {
    preferredChannel: 'email',
    preferredCadence: 'on_milestone',
    profile: {
      jobToBeDone: 'Ensure the injured worker receives medically necessary home health services.',
      responsibilityTransferred: 'Alara coordinates with the treating physician and delivers authorized services.',
      successDefinition: 'Worker stable at home; services within authorized scope; clear documentation.',
      anxietyRisk: 'Services exceeding authorization or clinical deterioration without notification.',
      communicationPromise: 'Prompt updates on start of care, visits, and any clinical concerns.',
      updateTriggers: ['SOCCompleted', 'MissedVisit', 'ClinicalConcernRaised', 'ReauthWindowOpened'],
    },
  },
  employer_feca: {
    preferredChannel: 'email',
    preferredCadence: 'weekly',
    profile: {
      jobToBeDone: 'Manage claim costs and ensure medically necessary services are delivered efficiently.',
      responsibilityTransferred: 'Alara delivers authorized services within the FECA claim framework.',
      successDefinition: 'Appropriate services, clear documentation, claim moving toward resolution.',
      anxietyRisk: 'Unauthorized services or prolonged claims.',
      communicationPromise: 'Periodic status updates on service delivery and authorization status.',
      updateTriggers: ['AuthorizationApproved', 'ReauthApproved', 'Discharged'],
    },
  },
  // Internal stakeholder types — minimal profiles (receive tasks, not external comms)
  care_guide: {
    preferredChannel: 'inapp',
    preferredCadence: 'realtime',
    profile: {
      jobToBeDone: 'Own the patient relationship and coordinate all care activities.',
      responsibilityTransferred: null,
      successDefinition: 'Patient receives complete, authorized, timely care. Zero dropped tasks.',
      anxietyRisk: 'Missed deadlines or authorization gaps that delay care.',
      communicationPromise: 'Real-time task assignments; daily digest for case status.',
      updateTriggers: [],
    },
  },
  auth_specialist: {
    preferredChannel: 'inapp',
    preferredCadence: 'realtime',
    profile: {
      jobToBeDone: 'Obtain and maintain payer authorization for all ordered services.',
      responsibilityTransferred: null,
      successDefinition: 'Every service has valid authorization before delivery.',
      anxietyRisk: 'Authorization lapse causing care disruption or denial.',
      communicationPromise: 'Task assignments for authorization actions with SLA.',
      updateTriggers: [],
    },
  },
  don: {
    preferredChannel: 'inapp',
    preferredCadence: 'daily_digest',
    profile: {
      jobToBeDone: 'Clinical oversight and escalation point for complex or at-risk cases.',
      responsibilityTransferred: null,
      successDefinition: 'Clinical concerns addressed before they become adverse events.',
      anxietyRisk: 'Clinical deterioration or unaddressed escalations.',
      communicationPromise: 'Escalation tasks and daily digest of flagged cases.',
      updateTriggers: [],
    },
  },
};

export function getDefaults(type: StakeholderType): StakeholderDefaults {
  return STAKEHOLDER_DEFAULTS[type] ?? {
    preferredChannel: 'email' as CommunicationChannel,
    preferredCadence: 'on_milestone' as CommunicationCadence,
    profile: {
      jobToBeDone: null,
      responsibilityTransferred: null,
      successDefinition: null,
      anxietyRisk: null,
      communicationPromise: null,
      updateTriggers: [],
    },
  };
}
