/**
 * Alara OS — Built-in Triggers
 *
 * These triggers are loaded at startup. They cover the core operational
 * events defined in the constitutional event model (Part V, BD-016).
 *
 * Each trigger declares: which event it listens on, what conditions make
 * it interesting, and which rule set should evaluate it.
 */

import { TriggerDefinition } from './types';

export const BUILT_IN_TRIGGERS: TriggerDefinition[] = [
  // ── Object lifecycle ───────────────────────────────────────────────────────

  {
    id: 'trigger.patient.created',
    name: 'Patient Created',
    description: 'Fires when a new Patient object is created — initiates intake evaluation.',
    eventTypes: ['ObjectCreated'],
    conditions: [
      { field: 'payload.objectType', operator: 'eq', value: 'Patient' },
    ],
    logic: 'ALL',
    rationale: 'Every new patient requires intake workflow evaluation.',
    targetRuleSetId: 'ruleset.intake',
    enabled: true,
    priority: 10,
  },

  {
    id: 'trigger.workflow.created',
    name: 'Workflow Created',
    description: 'Fires when a Workflow object is created — evaluates assignment rules.',
    eventTypes: ['ObjectCreated'],
    conditions: [
      { field: 'payload.objectType', operator: 'eq', value: 'Workflow' },
    ],
    logic: 'ALL',
    rationale: 'New workflows need ownership and notification evaluation.',
    targetRuleSetId: 'ruleset.workflow.assignment',
    enabled: true,
    priority: 20,
  },

  {
    id: 'trigger.promise.created',
    name: 'Promise Created',
    description: 'Fires when a Promise is created — schedules follow-up evaluation.',
    eventTypes: ['ObjectCreated'],
    conditions: [
      { field: 'payload.objectType', operator: 'eq', value: 'Promise' },
    ],
    logic: 'ALL',
    rationale: 'Promises require tracking and deadline awareness.',
    targetRuleSetId: 'ruleset.promise.tracking',
    enabled: true,
    priority: 30,
  },

  // ── Automynd boundary events (ADR-001) ────────────────────────────────────

  {
    id: 'trigger.referral.observed',
    name: 'Referral Observed from Automynd',
    description: 'Fires when Automynd signals a new referral. Creates Patient + Workflow.',
    eventTypes: ['AutomyndReferralObserved'],
    conditions: [],
    logic: 'ALL',
    rationale: 'ADR-001: Automynd is clinical SoR. Referral observation triggers intake.',
    targetRuleSetId: 'ruleset.intake',
    enabled: true,
    priority: 5,
  },

  {
    id: 'trigger.visit.observed',
    name: 'Visit Observed from Automynd',
    description: 'Fires when a completed visit is observed — updates patient timeline.',
    eventTypes: ['AutomyndVisitObserved'],
    conditions: [
      { field: 'payload.status', operator: 'eq', value: 'completed' },
    ],
    logic: 'ALL',
    rationale: 'Completed visits are meaningful state transitions for patient journey.',
    targetRuleSetId: 'ruleset.visit.completed',
    enabled: true,
    priority: 10,
  },

  {
    id: 'trigger.data.integrity.flagged',
    name: 'Data Integrity Conflict Detected',
    description: 'Fires when Automynd data conflicts with Alara records. Routes to human.',
    eventTypes: ['DataIntegrityFlagged'],
    conditions: [],
    logic: 'ALL',
    rationale: 'ADR-001: Alara never overwrites Automynd. Conflicts route to human review.',
    targetRuleSetId: 'ruleset.data.integrity',
    enabled: true,
    priority: 1, // highest priority — data integrity is first-class
  },

  // ── External reference events ──────────────────────────────────────────────

  {
    id: 'trigger.external.ref.added',
    name: 'External Reference Added',
    description: 'Fires when an Automynd or other system ID is linked to an Alara object.',
    eventTypes: ['ExternalReferenceAdded'],
    conditions: [
      { field: 'payload.system', operator: 'in', value: ['Automynd', 'VA', 'OWCP'] },
    ],
    logic: 'ALL',
    rationale: 'ExternalReference rule: new external links may require sync evaluation.',
    targetRuleSetId: 'ruleset.external.sync',
    enabled: true,
    priority: 50,
  },
];
