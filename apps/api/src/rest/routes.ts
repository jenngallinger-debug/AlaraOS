/**
 * Alara OS API — REST Command Routes
 *
 * All routes delegate to engines/orchestrators.
 * No direct database writes. No business logic here.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EngineContainer } from '../shared/container';
import {
  AutomyndWebhookBody, AutomyndWebhookResponse,
  CreateReferralBody, CreateReferralResponse,
  EmitEventBody, EmitEventResponse,
} from './types';
import {
  FixtureAutomyndAdapter,
  EventType,
  makeAlaraId,
} from '@alara-os/core';

// ─── JSON Schemas for validation ──────────────────────────────────────────────

const createReferralSchema = {
  body: {
    type: 'object',
    required: ['tenantId', 'patientName', 'programType', 'referralSource', 'referralDate', 'automyndPatientId', 'automyndReferralId'],
    properties: {
      tenantId:           { type: 'string', minLength: 1 },
      patientName:        { type: 'string', minLength: 1 },
      programType:        { type: 'string', minLength: 1 },
      referralSource:     { type: 'string', minLength: 1 },
      referralDate:       { type: 'string', format: 'date' },
      automyndPatientId:  { type: 'string', minLength: 1 },
      automyndReferralId: { type: 'string', minLength: 1 },
      actor:              { type: 'string' },
      dataIntegrityFlags: {
        type: 'array',
        items: {
          type: 'object',
          required: ['field'],
          properties: {
            field: { type: 'string' },
            automyndValue: {},
            alaraValue: {},
          },
        },
      },
    },
    additionalProperties: false,
  },
};

const emitEventSchema = {
  body: {
    type: 'object',
    required: ['tenantId', 'streamId', 'type', 'payload', 'actor'],
    properties: {
      tenantId: { type: 'string', minLength: 1 },
      streamId: { type: 'string', minLength: 1 },
      type:     { type: 'string', minLength: 1 },
      payload:  { type: 'object' },
      actor:    { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
};

const automyndWebhookSchema = {
  body: {
    type: 'object',
    required: ['eventType', 'tenantId', 'payload'],
    properties: {
      eventType: { type: 'string', enum: ['patient.observed', 'referral.observed', 'visit.observed', 'order.observed'] },
      tenantId:  { type: 'string', minLength: 1 },
      payload:   { type: 'object' },
    },
    additionalProperties: false,
  },
};

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerRestRoutes(
  app: FastifyInstance,
  container: EngineContainer,
): Promise<void> {

  // ── POST /commands/referrals ────────────────────────────────────────────────
  app.post<{ Body: CreateReferralBody }>(
    '/commands/referrals',
    { schema: createReferralSchema },
    async (req, reply): Promise<CreateReferralResponse> => {
      const body = req.body;

      const result = await container.orchestrator.handleReferralReceived({
        tenantId:           body.tenantId,
        automyndReferralId: body.automyndReferralId,
        automyndPatientId:  body.automyndPatientId,
        patientName:        body.patientName,
        programType:        body.programType,
        referralSource:     body.referralSource,
        referralDate:       body.referralDate,
        actor:              body.actor ?? 'api',
      });

      if (!result.success) {
        reply.status(422);
        return {
          success: false,
          projectionIds: {},
          decisionSummary: {
            outcome: 'denied',
            explanation: result.denialReason,
            appliedRules: result.denialExplanation?.appliedRules?.map(r => ({
              ruleId: r.ruleId,
              outcome: r.outcome,
              reason: r.reason,
            })),
          },
          error: result.denialReason,
        };
      }

      // Retrieve projection IDs from store (projections were built by orchestrator)
      const timelineProj = await container.projectionStore.get(
        body.tenantId, 'Timeline', String(result.patientId),
      );
      const twinProj = await container.projectionStore.get(
        body.tenantId, 'DigitalCareTwin', String(result.patientId),
      );

      reply.status(201);
      return {
        success: true,
        patientId:       String(result.patientId),
        workflowId:      String(result.workflowId),
        taskId:          String(result.taskId),
        promiseId:       String(result.promiseId),
        communicationId: String(result.communicationId),
        projectionIds: {
          timeline:       timelineProj?.id ? String(timelineProj.id) : undefined,
          digitalCareTwin: twinProj?.id ? String(twinProj.id) : undefined,
        },
        decisionSummary: { outcome: 'allowed' },
      };
    },
  );

  // ── POST /commands/events ───────────────────────────────────────────────────
  app.post<{ Body: EmitEventBody }>(
    '/commands/events',
    { schema: emitEventSchema },
    async (req, reply): Promise<EmitEventResponse> => {
      const { tenantId, streamId, type, payload, actor } = req.body;

      const streamAlaraId = makeAlaraId(streamId);
      const event = await container.eventStore.append({
        tenantId,
        streamId: streamAlaraId,
        type: type as EventType,
        payload,
        actor,
      });

      reply.status(201);
      return {
        eventId:  event.id,
        seq:      event.seq,
        type:     event.type,
        streamId: String(event.streamId),
      };
    },
  );

  // ── POST /webhooks/automynd ─────────────────────────────────────────────────
  app.post<{ Body: AutomyndWebhookBody }>(
    '/webhooks/automynd',
    { schema: automyndWebhookSchema },
    async (req, reply): Promise<AutomyndWebhookResponse> => {
      const { eventType, tenantId, payload } = req.body;
      const adapter = new FixtureAutomyndAdapter();

      let adapterPayload: Record<string, unknown>;
      let alaraEventType: EventType;

      switch (eventType) {
        case 'patient.observed': {
          adapterPayload = await adapter.emitPatientObserved(payload as unknown as Parameters<typeof adapter.emitPatientObserved>[0]) as unknown as Record<string, unknown>;
          alaraEventType = 'AutomyndPatientObserved';
          break;
        }
        case 'referral.observed': {
          adapterPayload = await adapter.emitReferralObserved(payload as unknown as Parameters<typeof adapter.emitReferralObserved>[0]) as unknown as Record<string, unknown>;
          alaraEventType = 'AutomyndReferralObserved';
          break;
        }
        case 'visit.observed': {
          adapterPayload = await adapter.emitVisitObserved(payload as unknown as Parameters<typeof adapter.emitVisitObserved>[0]) as unknown as Record<string, unknown>;
          alaraEventType = 'AutomyndVisitObserved';
          break;
        }
        case 'order.observed': {
          adapterPayload = await adapter.emitOrderObserved(payload as unknown as Parameters<typeof adapter.emitOrderObserved>[0]) as unknown as Record<string, unknown>;
          alaraEventType = 'AutomyndOrderObserved';
          break;
        }
        default:
          reply.status(400);
          return { received: false, message: `Unknown eventType: ${eventType}` };
      }

      // Append the Automynd observation event to the system stream
      const systemStreamId = makeAlaraId('00000000-0000-4000-8000-000000000000');
      const event = await container.eventStore.append({
        tenantId,
        streamId: systemStreamId,
        type: alaraEventType,
        payload: adapterPayload,
        actor: 'automynd-webhook',
      });

      reply.status(200);
      return { received: true, alaraEventId: event.id, message: `${eventType} processed` };
    },
  );
}
