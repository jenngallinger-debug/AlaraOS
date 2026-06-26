"""Seed data for the Stakeholder Trust Engine — the event/rule/message contract.

This is the *data* the engine runs on. Adding a row here teaches the engine a new
behaviour; the engine code itself is generic. Sending is stubbed everywhere.

Three datasets:
  PROMISE_DEFAULTS  — per stakeholder type: job-to-be-done, responsibility
                      transferred, success, anxiety, communication promise.
  RULES             — per event: which stakeholder types hear about it, how
                      (auto/review/task/manual), the category, follow-up, SLA.
  TEMPLATES         — specific messages for high-value (event, type) pairs;
                      everything else falls back to GENERIC_BY_TONE.
"""

# Which stakeholder types are internal (create tasks for a role, not external sends).
INTERNAL_TYPES = ("care_guide", "auth_specialist", "don")

# Stakeholder type -> message tone.
TONE_BY_TYPE = {
    "patient": "reassuring", "family": "reassuring",
    "physician": "operational", "case_manager": "operational",
    "discharge_planner": "operational", "owcp_nurse_cm": "operational",
    "employer_feca": "operational",
    "attorney": "benefit_execution", "authorized_rep": "benefit_execution",
    "dol_resource_center": "neutral_compliant",
    "care_guide": "task_action", "auth_specialist": "task_action", "don": "task_action",
}

# Internal stakeholder type -> app_user role used as the task owner.
TYPE_TO_ROLE = {"care_guide": "care_guide", "auth_specialist": "auth_specialist", "don": "don"}

STAKEHOLDER_LABELS = {
    "patient": "Patient", "family": "Family / caregiver", "physician": "Physician",
    "case_manager": "Case manager", "discharge_planner": "Discharge planner",
    "dol_resource_center": "DOL Resource Center", "attorney": "Attorney",
    "authorized_rep": "Authorized representative", "owcp_nurse_cm": "OWCP nurse case manager",
    "employer_feca": "Employer / FECA stakeholder", "care_guide": "Care Guide (internal)",
    "auth_specialist": "Authorization Specialist (internal)", "don": "Clinical Lead / DON (internal)",
}

# ── promise profiles (the responsibility-transfer contract per type) ──────────
PROMISE_DEFAULTS = {
    "patient": {
        "job": "Get help and the maximum benefits I've earned, without managing the system.",
        "responsibility": "Alara confirms eligibility, handles paperwork, and coordinates all care.",
        "success": "Care arrives, costs nothing out of pocket, and I never chase anyone.",
        "anxiety": "That I'll be denied, billed, or left to coordinate it alone.",
        "promise": "Plain-English updates at each milestone; you never manage the process.",
        "triggers": ["EligibilityConfirmed", "AuthorizationApproved", "SOCScheduled", "ReauthApproved"],
    },
    "family": {
        "job": "Keep my loved one safe and well cared for without becoming the unpaid coordinator.",
        "responsibility": "Alara manages benefits and care coordination end to end.",
        "success": "My loved one is safe, benefits are handled, and I'm kept informed.",
        "anxiety": "That something falls through the cracks and lands on me.",
        "promise": "Reassuring updates at milestones; we flag anything that needs you.",
        "triggers": ["EligibilityConfirmed", "AuthorizationApproved", "SOCCompleted", "MissedVisit"],
    },
    "physician": {
        "job": "Manage the patient safely in the community with Alara monitoring and coordinating.",
        "responsibility": "Alara monitors at home and coordinates; you handle orders and medical decisions.",
        "success": "Patient stays stable at home; I'm told only when action is needed.",
        "anxiety": "Being surprised by a deterioration or an unsigned order I wasn't told about.",
        "promise": "Concise operational updates; immediate flag when physician action is required.",
        "triggers": ["OrderRequested", "SOCCompleted", "ClinicalConcernRaised", "HospitalizationRiskRaised", "MissedVisit"],
    },
    "case_manager": {
        "job": "Place the patient with the best option and reduce readmission risk and my burden.",
        "responsibility": "Alara executes intake, authorization, staffing, and follow-through.",
        "success": "Smooth placement, no readmission, rigorous updates without chasing.",
        "anxiety": "A placement that bounces back to me or goes quiet.",
        "promise": "Proactive status at every stage; you never have to chase the case.",
        "triggers": ["CaseAccepted", "SOCScheduled", "SOCCompleted", "MissedVisit", "Discharged"],
    },
    "discharge_planner": {
        "job": "Discharge to a reliable provider who handles timing, paperwork, and care.",
        "responsibility": "Alara takes the case from referral through start of care.",
        "success": "Clean discharge, fast acceptance, no bounce-back.",
        "anxiety": "Discharging to a provider who drops the ball.",
        "promise": "Acknowledged referral and status through to active care.",
        "triggers": ["ReferralAcknowledged", "CaseAccepted", "SOCScheduled", "SOCCompleted"],
    },
    "dol_resource_center": {
        "job": "Help beneficiaries access benefits accurately while staying neutral.",
        "responsibility": "Alara handles authorization and delivery; you stay informational.",
        "success": "Beneficiaries served, my workload reduced, neutrality preserved.",
        "anxiety": "Being seen to endorse a vendor or give inaccurate info.",
        "promise": "Factual, neutral, non-promotional status notifications only.",
        "triggers": ["EligibilityConfirmed", "AuthorizationApproved"],
    },
    "attorney": {
        "job": "Ensure the benefits I fought for are fully used and preserved.",
        "responsibility": "Alara executes the care/benefits piece; you're pulled in only for legal/payer issues.",
        "success": "Benefits maximized and used; I'm only engaged when law/payer requires.",
        "anxiety": "Hard-won benefits going unused or being eroded.",
        "promise": "Benefit-execution updates; escalation to you only for government/payer issues.",
        "triggers": ["AuthorizationApproved", "AuthorizationDenied", "AppealFiled", "CoverageExpansionApproved"],
    },
    "authorized_rep": {
        "job": "Get fast, expert execution that uses the benefits we secured.",
        "responsibility": "Alara executes intake, authorization, and delivery.",
        "success": "Fast turnaround, expert execution, benefits put to use.",
        "anxiety": "Slow or sloppy execution that reflects on me.",
        "promise": "Fast benefit-execution updates and clear documentation.",
        "triggers": ["AuthorizationApproved", "AuthorizationDenied", "CoverageExpansionApproved"],
    },
    "owcp_nurse_cm": {
        "job": "Wake up to full updates on every case and never have to follow up.",
        "responsibility": "Alara proactively reports status, authorizations, visits, and risks.",
        "success": "Complete visibility with zero follow-up required from me.",
        "anxiety": "Having to chase a provider for case status.",
        "promise": "Rigorous, unprompted status — you never follow up.",
        "triggers": ["AuthorizationSubmitted", "AuthorizationApproved", "ReauthSubmitted", "ReauthApproved", "HospitalizationRiskRaised"],
    },
    "employer_feca": {
        "job": "Work with a provider who understands the program and improves function.",
        "responsibility": "Alara manages care and avoids unnecessary utilization.",
        "success": "Improved function, no administrative confusion, appropriate utilization.",
        "anxiety": "Administrative confusion or unnecessary cost.",
        "promise": "Program-fluent, low-confusion status updates.",
        "triggers": ["CaseAccepted", "SOCCompleted", "Discharged"],
    },
    "care_guide": {
        "job": "Own stakeholder trust and communicate proactively.",
        "responsibility": "Single accountable owner of stakeholder communication for the case.",
        "success": "Every stakeholder knows what they need, when they need it.",
        "anxiety": "A stakeholder going dark or chasing me.",
        "promise": "Drive every communication to sent, on SLA.",
        "triggers": ["MissingInformation", "AuthorizationDenied", "MissedVisit", "CaseDeclined"],
    },
    "auth_specialist": {
        "job": "Know what documentation, authorization, denial, appeal, or reauth action is required.",
        "responsibility": "Owns the authorization lifecycle.",
        "success": "No authorization lapses; every action handled on time.",
        "anxiety": "A reauth lapsing or a denial missing its appeal window.",
        "promise": "Act on every authorization signal within SLA.",
        "triggers": ["AuthorizationDenied", "ReauthWindowOpened", "ReauthLapseRisk", "ConsequentialConditionCandidate"],
    },
    "don": {
        "job": "Know clinical risks, care gaps, med-rec issues, SOC status, and escalations.",
        "responsibility": "Clinical oversight and escalation authority.",
        "success": "Clinical risks caught early; SOC reviewed; no avoidable hospitalization.",
        "anxiety": "A clinical signal missed until it becomes a hospitalization.",
        "promise": "Review every clinical signal and SOC.",
        "triggers": ["SOCCompleted", "ClinicalConcernRaised", "MedicationReconciliationIssue", "HospitalizationRiskRaised", "CareGapDetected"],
    },
}

# ── event labels: (operational label, plain/reassuring phrasing) ──────────────
EVENT_LABELS = {
    "ReferralReceived": ("Referral received", "we received the referral"),
    "ReferralAcknowledged": ("Referral acknowledged", "we've confirmed the referral"),
    "PatientCreated": ("Case opened", "your case is open"),
    "EligibilityStarted": ("Eligibility check started", "we've started confirming your benefits"),
    "EligibilityConfirmed": ("Eligibility confirmed", "your benefits are confirmed"),
    "MissingInformation": ("Information needed", "we need one detail to keep things moving"),
    "PhysicianIdentified": ("Physician identified", "we've identified the ordering physician"),
    "OrderRequested": ("Order requested", "we've requested the order"),
    "OrderSigned": ("Order signed", "the doctor's order is signed"),
    "AuthorizationSubmitted": ("Authorization submitted", "we've submitted the authorization"),
    "AuthorizationApproved": ("Authorization approved", "your care is authorized"),
    "AuthorizationDenied": ("Authorization denied", "there's a coverage issue we're handling"),
    "AppealFiled": ("Appeal filed", "we've filed an appeal on your behalf"),
    "CaseAccepted": ("Case accepted", "we've accepted the case"),
    "CaseDeclined": ("Case declined", "we're unable to take this case"),
    "StaffingStarted": ("Staffing started", "we're assigning your care team"),
    "CaseStaffed": ("Case staffed", "your care team is assigned"),
    "SOCScheduled": ("Start of care scheduled", "your first visit is scheduled"),
    "SOCCompleted": ("Start of care completed", "your first visit is done"),
    "VisitCompleted": ("Visit completed", "a visit was completed"),
    "MissedVisit": ("Missed visit", "a visit was missed and we're on it"),
    "ClinicalConcernRaised": ("Clinical concern raised", "our nurse flagged something to review"),
    "MedicationReconciliationIssue": ("Medication reconciliation issue", "a medication question came up"),
    "HospitalizationRiskRaised": ("Hospitalization risk raised", "we're acting to keep you out of the hospital"),
    "CareGapDetected": ("Care gap detected", "we spotted a gap and are closing it"),
    "ReauthWindowOpened": ("Reauthorization window opened", "we're getting ahead of your renewal"),
    "ReauthSubmitted": ("Reauthorization submitted", "we've submitted your renewal"),
    "ReauthApproved": ("Reauthorization approved", "your care is renewed"),
    "ReauthLapseRisk": ("Reauthorization lapse risk", "a renewal needs attention"),
    "ConsequentialConditionCandidate": ("Consequential condition candidate", "we may be able to expand your benefits"),
    "CoverageExpansionSubmitted": ("Coverage expansion submitted", "we've requested expanded coverage"),
    "CoverageExpansionApproved": ("Coverage expansion approved", "your covered care has grown"),
    "Discharged": ("Discharged", "care has concluded"),
}
ALL_EVENTS = list(EVENT_LABELS.keys())

# Event -> referrer-facing referral stage (req 9).
EVENT_TO_STAGE = {
    "ReferralReceived": "received", "ReferralAcknowledged": "under_review",
    "MissingInformation": "need_information", "CaseAccepted": "accepted",
    "AuthorizationSubmitted": "authorization_pending", "AuthorizationApproved": "authorization_pending",
    "StaffingStarted": "staffing", "CaseStaffed": "staffing",
    "SOCScheduled": "soc_scheduled", "SOCCompleted": "active_care",
    "CaseDeclined": "closed_declined", "Discharged": "closed_declined",
}

# ── generic fallback templates by tone ────────────────────────────────────────
GENERIC_BY_TONE = {
    "operational":
        ("Alara update — {patient_name}: {event_label}",
         "{event_label} for {patient_name}.{detail} Alara is handling the next steps and "
         "will flag anything that needs you."),
    "reassuring":
        ("An update on {patient_name}",
         "Hi {recipient_first}, a quick update: {event_plain}.{detail} Your Alara care team "
         "is handling everything — there's nothing you need to do right now."),
    "benefit_execution":
        ("Benefit execution — {patient_name}: {event_label}",
         "Re: {patient_name} — {event_label}.{detail} Alara is executing on the benefits in "
         "place. We'll escalate to you only if a government or payer issue requires it."),
    "neutral_compliant":
        ("Case status notification — {patient_name}",
         "Factual status update regarding {patient_name}: {event_label}. This is an "
         "informational notification from Alara Home Care. No action is required."),
    "task_action":
        ("[{event_label}] {patient_name}",
         "{event_label} on {patient_name}.{detail} Action: {action}"),
}

# ── specific templates (key = "EVENT.stakeholder_type") ───────────────────────
# Only high-value pairs; everything else uses GENERIC_BY_TONE.
TEMPLATES = {
    "AuthorizationApproved.patient": (
        "Good news about your care, {patient_name}",
        "Hi {recipient_first}, good news — your care is authorized and covered. There's "
        "nothing for you to pay or do; we'll schedule your first visit and keep you posted."),
    "AuthorizationApproved.physician": (
        "Authorization approved — {patient_name}",
        "{patient_name}'s home health is authorized. Alara will begin care and monitor at "
        "home. We'll contact you only if physician action is needed."),
    "AuthorizationApproved.owcp_nurse_cm": (
        "Authorization approved — {patient_name}",
        "Status: authorization approved for {patient_name}. Care is proceeding to staffing "
        "and start of care. No action needed; full status will follow at each milestone."),
    "AuthorizationDenied.attorney": (
        "Coverage issue requiring awareness — {patient_name}",
        "Re: {patient_name} — the authorization was denied. Alara is preparing the appeal and "
        "handling the payer process. We'll engage you only if the matter requires legal action."),
    "AuthorizationDenied.patient": (
        "We're handling a coverage step for you, {patient_name}",
        "Hi {recipient_first}, there's a coverage step we're taking care of with the program. "
        "You don't need to do anything — we're on it and will update you."),
    "HospitalizationRiskRaised.physician": (
        "Action may be needed — {patient_name}",
        "{patient_name}: our team identified elevated hospitalization risk. Please review — "
        "physician input may be needed. Details and our actions are attached in the case."),
    "MissedVisit.case_manager": (
        "Missed visit handled — {patient_name}",
        "A scheduled visit for {patient_name} was missed. Alara has already begun reschedule "
        "and outreach to prevent a gap. No action needed from you."),
    "SOCScheduled.patient": (
        "Your first visit is scheduled, {patient_name}",
        "Hi {recipient_first}, your first home visit is scheduled. Your nurse will introduce "
        "themselves and walk you through everything — nothing to prepare."),
    "EligibilityConfirmed.dol_resource_center": (
        "Case status — eligibility confirmed",
        "Informational notification: eligibility has been confirmed for a beneficiary's home "
        "health benefit. This is a factual case-status update from Alara Home Care. No action "
        "is required and no endorsement is implied."),
}


# ── the rule contract: event -> [(type, delivery_mode, category, follow_up, sla_hours)] ─
A, R, T, M = "auto", "review", "task", "manual"  # delivery modes
RULES = {
    "ReferralReceived": [("care_guide", T, "status", 1, 2)],
    "ReferralAcknowledged": [("physician", A, "status", 0, 4), ("case_manager", A, "status", 0, 4),
                             ("discharge_planner", A, "status", 0, 4)],
    "EligibilityStarted": [("patient", A, "status", 0, 24), ("auth_specialist", T, "benefits", 0, 24)],
    "EligibilityConfirmed": [("patient", A, "status", 0, 24), ("family", A, "status", 0, 24),
                             ("case_manager", A, "status", 0, 24), ("attorney", A, "benefits", 0, 24),
                             ("dol_resource_center", R, "status", 0, 24)],
    "MissingInformation": [("care_guide", T, "status", 1, 4), ("patient", R, "status", 1, 12),
                           ("case_manager", A, "status", 0, 12)],
    "PhysicianIdentified": [("auth_specialist", T, "benefits", 0, 24)],
    "OrderRequested": [("physician", R, "clinical", 1, 24), ("care_guide", T, "status", 0, 24)],
    "OrderSigned": [("auth_specialist", T, "benefits", 0, 12), ("patient", A, "status", 0, 24)],
    "AuthorizationSubmitted": [("owcp_nurse_cm", A, "benefits", 0, 12), ("attorney", A, "benefits", 0, 24),
                               ("authorized_rep", A, "benefits", 0, 24), ("auth_specialist", T, "benefits", 0, 24)],
    "AuthorizationApproved": [("patient", A, "status", 0, 12), ("family", A, "status", 0, 12),
                              ("physician", A, "clinical", 0, 12), ("case_manager", A, "status", 0, 12),
                              ("attorney", A, "benefits", 0, 24), ("authorized_rep", A, "benefits", 0, 24),
                              ("owcp_nurse_cm", A, "benefits", 0, 12), ("dol_resource_center", R, "status", 0, 24)],
    "AuthorizationDenied": [("care_guide", T, "benefits", 1, 4), ("auth_specialist", T, "benefits", 1, 4),
                            ("attorney", R, "benefits", 1, 12), ("authorized_rep", R, "benefits", 1, 12),
                            ("patient", R, "status", 1, 24)],
    "AppealFiled": [("attorney", A, "benefits", 0, 12), ("authorized_rep", A, "benefits", 0, 12),
                    ("owcp_nurse_cm", A, "benefits", 0, 12), ("patient", A, "status", 0, 24)],
    "CaseAccepted": [("case_manager", A, "status", 0, 4), ("discharge_planner", A, "status", 0, 4),
                     ("physician", A, "status", 0, 12), ("patient", A, "status", 0, 12),
                     ("employer_feca", A, "status", 0, 24)],
    "CaseDeclined": [("care_guide", T, "status", 1, 4), ("case_manager", R, "status", 1, 8),
                     ("discharge_planner", R, "status", 1, 8)],
    "StaffingStarted": [("case_manager", A, "status", 0, 12), ("patient", A, "status", 0, 24)],
    "CaseStaffed": [("patient", A, "status", 0, 12), ("family", A, "status", 0, 12),
                    ("case_manager", A, "status", 0, 12)],
    "SOCScheduled": [("patient", A, "scheduling", 0, 12), ("family", A, "scheduling", 0, 12),
                     ("physician", A, "clinical", 0, 12), ("case_manager", A, "status", 0, 12)],
    "SOCCompleted": [("physician", A, "clinical", 0, 12), ("case_manager", A, "status", 0, 12),
                     ("patient", A, "status", 0, 24), ("don", T, "clinical", 1, 12),
                     ("employer_feca", A, "status", 0, 48)],
    "VisitCompleted": [("case_manager", M, "status", 0, 48)],
    "MissedVisit": [("care_guide", T, "scheduling", 1, 4), ("physician", R, "clinical", 1, 8),
                    ("case_manager", A, "status", 0, 8), ("family", R, "status", 0, 12)],
    "ClinicalConcernRaised": [("don", T, "clinical", 1, 4), ("physician", R, "clinical", 1, 8),
                              ("family", R, "clinical", 0, 12)],
    "MedicationReconciliationIssue": [("don", T, "clinical", 1, 8), ("physician", R, "clinical", 1, 12)],
    "HospitalizationRiskRaised": [("don", T, "clinical", 1, 2), ("physician", R, "clinical", 1, 4),
                                  ("case_manager", A, "status", 0, 8), ("family", R, "clinical", 0, 8),
                                  ("owcp_nurse_cm", A, "status", 0, 12)],
    "CareGapDetected": [("don", T, "clinical", 1, 8), ("care_guide", T, "status", 0, 12),
                        ("physician", R, "clinical", 1, 24)],
    "ReauthWindowOpened": [("auth_specialist", T, "benefits", 1, 24)],
    "ReauthSubmitted": [("owcp_nurse_cm", A, "benefits", 0, 12), ("auth_specialist", T, "benefits", 0, 24),
                        ("attorney", A, "benefits", 0, 24)],
    "ReauthApproved": [("patient", A, "status", 0, 24), ("family", A, "status", 0, 24),
                       ("owcp_nurse_cm", A, "benefits", 0, 12), ("case_manager", A, "status", 0, 24)],
    "ReauthLapseRisk": [("auth_specialist", T, "benefits", 1, 2), ("don", T, "clinical", 0, 8),
                        ("care_guide", T, "status", 0, 8)],
    "ConsequentialConditionCandidate": [("don", T, "clinical", 1, 24), ("auth_specialist", T, "benefits", 1, 24),
                                        ("attorney", R, "benefits", 0, 48), ("authorized_rep", R, "benefits", 0, 48)],
    "CoverageExpansionSubmitted": [("attorney", A, "benefits", 0, 24), ("authorized_rep", A, "benefits", 0, 24),
                                   ("owcp_nurse_cm", A, "benefits", 0, 24), ("auth_specialist", T, "benefits", 0, 24)],
    "CoverageExpansionApproved": [("patient", A, "status", 0, 24), ("family", A, "status", 0, 24),
                                  ("attorney", A, "benefits", 0, 24), ("authorized_rep", A, "benefits", 0, 24),
                                  ("case_manager", A, "status", 0, 24)],
    "Discharged": [("patient", A, "status", 0, 24), ("family", A, "status", 0, 24),
                   ("physician", A, "clinical", 0, 24), ("case_manager", A, "status", 0, 24),
                   ("attorney", A, "benefits", 0, 48), ("employer_feca", A, "status", 0, 48),
                   ("care_guide", T, "status", 1, 24)],
}
