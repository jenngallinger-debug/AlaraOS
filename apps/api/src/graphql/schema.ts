/**
 * Alara OS API — GraphQL Schema
 *
 * Read-only. No mutations. Projections and engine read models only.
 * GraphQL never writes canonical state — all writes go through REST commands.
 */

export const schema = `
  type Query {
    "Get a canonical Alara object by its UUID"
    object(tenantId: String!, id: ID!): AlaraObject

    "Get a workflow by its UUID"
    workflow(tenantId: String!, id: ID!): Workflow

    "Get tasks belonging to a workflow"
    tasksByWorkflow(tenantId: String!, workflowId: ID!): [Task!]!

    "Get promises belonging to a workflow"
    promisesByWorkflow(tenantId: String!, workflowId: ID!): [Promise!]!

    "Get communications for a patient/subject"
    communicationsBySubject(tenantId: String!, subjectId: ID!): [Communication!]!

    "Timeline projection for a subject (rebuilt on demand if stale)"
    timeline(tenantId: String!, subjectId: ID!): TimelineProjection

    "Digital Care Twin projection for a patient"
    digitalCareTwin(tenantId: String!, patientId: ID!): DigitalCareTwinProjection

    "Referral Source Strength projection"
    referralSourceStrength(tenantId: String!, referralSourceId: ID!): ReferralSourceStrengthProjection
  }

  # ── Canonical objects ────────────────────────────────────────────────────────

  type AlaraObject {
    id: ID!
    tenantId: String!
    type: String!
    state: String!
    attributes: JSONObject!
    version: Int!
    externalReferences: [ExternalReference!]!
  }

  type ExternalReference {
    system: String!
    extType: String!
    value: String!
  }

  # ── Workflow ──────────────────────────────────────────────────────────────────

  type Workflow {
    id: ID!
    tenantId: String!
    templateId: String!
    name: String!
    status: String!
    currentStepId: String
    ownerId: String!
    version: Int!
    steps: [WorkflowStep!]!
  }

  type WorkflowStep {
    stepId: String!
    stepName: String!
    status: String!
  }

  # ── Task ─────────────────────────────────────────────────────────────────────

  type Task {
    id: ID!
    tenantId: String!
    taskType: String!
    title: String!
    status: String!
    ownerId: String!
    dueAt: String
    workflowId: ID
    workflowStepId: String
    version: Int!
  }

  # ── Promise ───────────────────────────────────────────────────────────────────

  type Promise {
    id: ID!
    tenantId: String!
    description: String!
    status: String!
    ownerId: String!
    dueAt: String!
    workflowId: ID
    voidReason: String
    version: Int!
  }

  # ── Communication ─────────────────────────────────────────────────────────────

  type Communication {
    id: ID!
    tenantId: String!
    channel: String!
    purpose: String!
    status: String!
    recipientId: String!
    subject: String!
    sentAt: String
    version: Int!
  }

  # ── Projections ───────────────────────────────────────────────────────────────

  type TimelineProjection {
    subjectId: String!
    methodVersion: String!
    confidence: String!
    lastBuiltAt: String!
    buildNumber: Int!
    eventCount: Int!
    entries: [TimelineEntry!]!
  }

  type TimelineEntry {
    eventId: String!
    eventType: String!
    occurredAt: String!
    actor: String!
    summary: String!
  }

  type DigitalCareTwinProjection {
    patientId: String!
    methodVersion: String!
    confidence: String!
    lastBuiltAt: String!
    aiInvolved: Boolean!
    disclaimer: String!
    patientAttributes: JSONObject!
    externalReferences: [ExternalReference!]!
    activeWorkflows: [WorkflowSummary!]!
    openTasks: [TaskSummary!]!
    openPromises: [PromiseSummary!]!
    timelineSummary: TimelineSummary!
  }

  type WorkflowSummary {
    workflowId: String!
    templateId: String!
    status: String!
    currentStepId: String
  }

  type TaskSummary {
    taskId: String!
    taskType: String!
    ownerId: String!
    dueAt: String
  }

  type PromiseSummary {
    promiseId: String!
    description: String!
    dueAt: String!
  }

  type TimelineSummary {
    eventCount: Int!
    lastEventAt: String
  }

  type ReferralSourceStrengthProjection {
    referralSourceId: String!
    methodVersion: String!
    confidence: String!
    strengthScore: Float!
    trend: String!
    totalReferrals: Int!
    keptPromises: Int!
    missedPromises: Int!
    dataIntegrityFlags: Int!
  }

  "Arbitrary JSON object"
  scalar JSONObject
`;
