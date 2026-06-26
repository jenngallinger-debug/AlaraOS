/**
 * Alara OS — Workflow Template Registry
 *
 * Templates define the structure of workflow types.
 * Instances are the running copies — they inherit a template at creation
 * and then evolve independently.
 */

import { WorkflowTemplate } from './types';

export class WorkflowTemplateRegistry {
  private readonly templates = new Map<string, WorkflowTemplate>();

  register(template: WorkflowTemplate): void {
    if (this.templates.has(template.id)) {
      throw new Error(`Workflow template "${template.id}" already registered.`);
    }
    this.templates.set(template.id, template);
  }

  getById(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  getAll(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }
}

// ─── Built-in templates ───────────────────────────────────────────────────────

export const INTAKE_WORKFLOW_TEMPLATE: WorkflowTemplate = {
  id: 'template.intake',
  name: 'Referral Intake Workflow',
  description: 'Standard intake process for new patient referrals.',
  version: '1.0.0',
  ruleSetId: 'ruleset.intake',
  defaultOwnerPool: 'care-guide-pool',
  steps: [
    {
      id: 'step.intake.acknowledge',
      name: 'Acknowledge Referral',
      description: 'Contact the referral source and acknowledge receipt.',
      order: 1,
      required: true,
      slaHours: 4,
      taskType: 'AcknowledgeReferral',
      createsPromise: true,
      promiseDescription: 'Alara will respond to the referral source within 4 hours.',
    },
    {
      id: 'step.intake.qualify',
      name: 'Qualify Patient',
      description: 'Verify eligibility and program fit.',
      order: 2,
      required: true,
      slaHours: 24,
      taskType: 'QualifyPatient',
      createsPromise: false,
    },
    {
      id: 'step.intake.schedule-soc',
      name: 'Schedule Start of Care',
      description: 'Coordinate SOC visit with patient and clinical team.',
      order: 3,
      required: true,
      slaHours: 48,
      taskType: 'ScheduleSOC',
      createsPromise: true,
      promiseDescription: 'Alara will schedule the Start of Care visit.',
    },
  ],
};

export const BUILT_IN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  INTAKE_WORKFLOW_TEMPLATE,
];
