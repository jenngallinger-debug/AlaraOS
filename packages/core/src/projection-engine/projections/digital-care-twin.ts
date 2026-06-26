/**
 * Alara OS — Digital Care Twin v0 Projection
 *
 * "The Digital Care Twin is a Computed Projection — a computed intelligence
 *  composite assembled from Alara-owned objects and permitted external
 *  references. It is not a clinical record, not a source of truth, and
 *  not a shadow chart." (ADR-001 reaffirmation + ADR-016)
 *
 * v0 assembles: patient attributes, external references, active workflows,
 * open tasks, open promises, and timeline summary.
 *
 * NEVER contains: clinical visit notes, POC content, assessment text,
 * order content, or any Automynd clinical documentation.
 */

import { DomainEvent } from '../../events/types';
import {
  DigitalCareTwinValue,
  ProjectionBuildResult,
  ProjectionDefinition,
  ProjectionDependency,
} from '../types';

// ─── Input type ────────────────────────────────────────────────────────────────

export interface DigitalCareTwinInput {
  readonly patientId: string;
  /** Patient object attributes (never clinical document content) */
  readonly patientAttributes: Record<string, unknown>;
  /** External references (ExternalReference pattern, BD-013-B) */
  readonly externalReferences: readonly { system: string; extType: string; value: string }[];
  /** Active workflow summaries */
  readonly activeWorkflows: readonly {
    workflowId: string;
    templateId: string;
    status: string;
    currentStepId: string | null;
  }[];
  /** Open tasks */
  readonly openTasks: readonly {
    taskId: string;
    taskType: string;
    ownerId: string;
    dueAt: string | null;
  }[];
  /** Open promises */
  readonly openPromises: readonly {
    promiseId: string;
    description: string;
    dueAt: string;
  }[];
  /** Events from this patient's stream (for timeline summary) */
  readonly events: readonly DomainEvent[];
}

// ─── Clinical content guard (ADR-001) ─────────────────────────────────────────

const CLINICAL_CONTENT_KEYS = new Set([
  'visitNotes', 'clinicalNotes', 'assessmentText', 'planOfCare', 'orderContent',
  'diagnosisCode', 'icd10', 'procedureCode', 'cpt', 'medications_full',
]);

function stripClinicalContent(attrs: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!CLINICAL_CONTENT_KEYS.has(k)) {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

// ─── Projection Definition ─────────────────────────────────────────────────────

export const DigitalCareTwinProjectionDefinition: ProjectionDefinition<DigitalCareTwinInput, DigitalCareTwinValue> = {
  type: 'DigitalCareTwin',
  methodName: 'digital-care-twin-composite',
  methodVersion: '0.1.0',

  declareDependencies(patientId: string): readonly ProjectionDependency[] {
    return [
      { name: 'Patient object',          kind: 'object',       sourceId: patientId },
      { name: 'Patient event stream',    kind: 'event_stream', sourceId: patientId },
      { name: 'External references',     kind: 'external_reference', sourceId: patientId },
      { name: 'Active workflows',        kind: 'object',       sourceId: `${patientId}::workflows` },
      { name: 'Open tasks',              kind: 'object',       sourceId: `${patientId}::tasks` },
      { name: 'Open promises',           kind: 'object',       sourceId: `${patientId}::promises` },
    ];
  },

  build(input: DigitalCareTwinInput): ProjectionBuildResult<DigitalCareTwinValue> {
    // ADR-001: strip any clinical content from patient attributes
    const safeAttributes = stripClinicalContent(input.patientAttributes);

    const value: DigitalCareTwinValue = {
      patientId: input.patientId,
      patientAttributes: safeAttributes,
      externalReferences: input.externalReferences,
      activeWorkflows: input.activeWorkflows,
      openTasks: input.openTasks,
      openPromises: input.openPromises,
      timelineSummary: {
        eventCount: input.events.length,
        lastEventAt: input.events.length > 0
          ? [...input.events].sort((a, b) =>
              new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
            )[0].occurredAt.toISOString()
          : null,
      },
      disclaimer: 'computed-projection-advisory-only',
    };

    return {
      value,
      confidence: input.events.length > 0 ? 'moderate' : 'low',
      inferenceBasis: 'fact',
      aiInvolved: false,
      sourceEventIds: input.events.map(e => e.id),
      freshUntil: null,
    };
  },
};
