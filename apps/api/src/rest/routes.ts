/**
 * Alara OS API — REST Command Routes
 *
 * All routes delegate to engines/orchestrators.
 * No direct database writes. No business logic here.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EngineContainer } from '../shared/container';
import {
  authenticatePrincipal, principalHasScope, SYSTEM_SCOPE, isTenantAllowed,
  getHeader, secretsMatch,
} from '../shared/auth';
import { registerRawBodyJsonParser } from '../shared/raw-body';
import {
  AUTOMYND_SECRET_HEADER, getAutomyndWebhookSecret,
  IDEMPOTENCY_KEY_HEADER, deterministicEventId, isRawEventCommandEnabled,
} from '../shared/config';
import {
  AutomyndWebhookBody, AutomyndWebhookResponse,
  CreateReferralBody, CreateReferralResponse,
  EmitEventBody, EmitEventResponse,
  CaptureConsentBody, CaptureConsentResponse,
  WithdrawConsentBody, WithdrawConsentResponse,
} from './types';
import {
  FixtureAutomyndAdapter,
  EventType,
  makeAlaraId,
  ConsentCaptureValidationError,
  ConsentIdempotencyConflictError,
  ConsentAuthorizationError,
  ConsentNotFoundError,
} from '@alara-os/core';
import type { ConsentPermissionType } from '@alara-os/core';

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
    // `actor` is NOT required here: the event actor is the AUTHENTICATED principal
    // (x-actor-id), never a body field. A body `actor` is accepted but ignored.
    required: ['tenantId', 'streamId', 'type', 'payload'],
    properties: {
      tenantId: { type: 'string', minLength: 1 },
      streamId: { type: 'string', minLength: 1 },
      type:     { type: 'string', minLength: 1 },
      payload:  { type: 'object' },
      actor:    { type: 'string' },
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

const captureConsentSchema = {
  body: {
    type: 'object',
    required: ['tenantId', 'subjectId', 'grantorId', 'recipientId', 'permissionTypes'],
    properties: {
      tenantId:        { type: 'string', minLength: 1 },
      subjectId:       { type: 'string', minLength: 1 },
      grantorId:       { type: 'string', minLength: 1 },
      recipientId:     { type: 'string', minLength: 1 },
      // No minItems here on purpose: an empty list is a business-rule failure that
      // ConsentCaptureService rejects (→ 422), keeping validation in the service.
      permissionTypes: { type: 'array', items: { type: 'string' } },
      effectiveDate:   { type: 'string' },
      expirationDate:  { type: 'string' },
      capturedBy:      { type: 'string' },
      source:          { type: 'string' },
    },
    additionalProperties: false,
  },
};

const withdrawConsentSchema = {
  body: {
    type: 'object',
    required: ['tenantId', 'consentId'],
    properties: {
      tenantId:   { type: 'string', minLength: 1 },
      consentId:  { type: 'string', minLength: 1 },
      capturedBy: { type: 'string' },
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
      // Transport authentication: a mutating command requires an authenticated actor.
      // The authenticated principal is the intake actor — body `actor` is not trusted.
      const principal = authenticatePrincipal(req);
      if (!principal) {
        reply.status(401);
        return {
          success: false,
          projectionIds: {},
          decisionSummary: { outcome: 'denied', explanation: 'unauthenticated' },
          error: 'unauthenticated: missing x-actor-id',
        };
      }
      const body = req.body;
      // Tenant boundary: a VERIFIED token principal may only act in a tenant it is a member of
      // (empty membership fails closed). Legacy principals are not yet enforced (unchanged).
      if (!isTenantAllowed(principal, body.tenantId)) {
        reply.status(403);
        return {
          success: false,
          projectionIds: {},
          decisionSummary: { outcome: 'denied', explanation: 'tenant not permitted' },
          error: 'forbidden: tenant not permitted for this principal',
        };
      }
      const actor = principal.principalId;

      const result = await container.orchestrator.handleReferralReceived({
        tenantId:           body.tenantId,
        automyndReferralId: body.automyndReferralId,
        automyndPatientId:  body.automyndPatientId,
        patientName:        body.patientName,
        programType:        body.programType,
        referralSource:     body.referralSource,
        referralDate:       body.referralDate,
        actor, // authenticated actor — body `actor` is ignored
      });

      if (!result.success) {
        // An idempotency conflict (referral id reused with a different payload) is 409;
        // any other non-success (denial / review-required / validation) is 422.
        reply.status(result.conflict ? 409 : 422);
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
    async (req, reply): Promise<EmitEventResponse | void> => {
      // Production gate: raw append is OFF unless explicitly enabled (or under tests).
      // When disabled we answer with the framework's standard 404 — identical to an
      // unregistered route — so the privileged surface is not even disclosed to exist.
      if (!isRawEventCommandEnabled()) {
        reply.callNotFound();
        return;
      }
      // Raw event append is a PRIVILEGED command (it can write any canonical event to
      // any stream). Require an authenticated principal, and restrict it to one carrying the
      // system scope — authorize on the principal's scope rather than the raw actor string.
      // (In legacy mode the system scope is granted to configured ALARA_SYSTEM_ACTORS, so the
      // allow/deny decision is identical to the previous isSystemActor check.)
      const principal = authenticatePrincipal(req);
      if (!principal) {
        reply.status(401);
        return { error: 'unauthenticated: missing x-actor-id' };
      }
      if (!principalHasScope(principal, SYSTEM_SCOPE)) {
        reply.status(403);
        return { error: 'forbidden: raw event append requires a system actor' };
      }
      const actor = principal.principalId;
      const { tenantId, streamId, type, payload } = req.body;
      // Tenant boundary (verified principals only; legacy unchanged) — see referrals handler.
      if (!isTenantAllowed(principal, tenantId)) {
        reply.status(403);
        return { error: 'forbidden: tenant not permitted for this principal' };
      }

      const streamAlaraId = makeAlaraId(streamId);
      const event = await container.eventStore.append({
        tenantId,
        streamId: streamAlaraId,
        type: type as EventType,
        payload,
        actor, // authenticated system actor — body `actor` is ignored
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

  // ── POST /commands/consent (capture / grant) ────────────────────────────────
  // The surface collects consent input; ConsentCaptureService validates and calls
  // ConsentEngine; the engine writes canonical state. No authorization here.
  app.post<{ Body: CaptureConsentBody }>(
    '/commands/consent',
    { schema: captureConsentSchema },
    async (req, reply): Promise<CaptureConsentResponse> => {
      // Transport authentication: authorize the AUTHENTICATED actor, never a
      // body-supplied field. Missing principal → fail closed (401).
      const principal = authenticatePrincipal(req);
      if (!principal) {
        reply.status(401);
        return { captured: false, error: 'unauthenticated: missing x-actor-id' };
      }
      const actor = principal.principalId;
      const b = req.body;
      // Tenant boundary (verified principals only; legacy unchanged) — see referrals handler.
      if (!isTenantAllowed(principal, b.tenantId)) {
        reply.status(403);
        return { captured: false, error: 'forbidden: tenant not permitted for this principal' };
      }
      try {
        const result = await container.consentCapture.capture({
          tenantId:       b.tenantId,
          subjectId:      b.subjectId,
          grantorId:      b.grantorId,
          recipientId:    b.recipientId,
          permissionTypes: b.permissionTypes as ConsentPermissionType[],
          effectiveDate:  b.effectiveDate,
          expirationDate: b.expirationDate,
          capturedBy:     actor, // authenticated actor — body `capturedBy` is not trusted
          source:         b.source,
          // Optional idempotency key (header). Absent → the service derives one from the
          // consent content, so a duplicate submit is deduped to a safe replay either way.
          idempotencyKey: getHeader(req, IDEMPOTENCY_KEY_HEADER),
        });
        // A replay returns the original consent (200, not 201 — nothing new was created).
        reply.status(result.idempotentReplay ? 200 : 201);
        return {
          captured:  true,
          consentId: String(result.consentId),
          status:    result.status,
          eventId:   result.eventId,
        };
      } catch (err) {
        if (err instanceof ConsentAuthorizationError) {
          reply.status(403);
          return { captured: false, error: err.message };
        }
        if (err instanceof ConsentIdempotencyConflictError) {
          // Same idempotency key reused with different consent content.
          reply.status(409);
          return { captured: false, error: err.message };
        }
        if (err instanceof ConsentCaptureValidationError) {
          reply.status(422);
          return { captured: false, error: err.message };
        }
        throw err;
      }
    },
  );

  // ── POST /commands/consent/withdraw (revoke) ────────────────────────────────
  app.post<{ Body: WithdrawConsentBody }>(
    '/commands/consent/withdraw',
    { schema: withdrawConsentSchema },
    async (req, reply): Promise<WithdrawConsentResponse> => {
      const principal = authenticatePrincipal(req);
      if (!principal) {
        reply.status(401);
        return { withdrawn: false, error: 'unauthenticated: missing x-actor-id' };
      }
      const actor = principal.principalId;
      const b = req.body;
      // Tenant boundary (verified principals only; legacy unchanged) — see referrals handler.
      if (!isTenantAllowed(principal, b.tenantId)) {
        reply.status(403);
        return { withdrawn: false, error: 'forbidden: tenant not permitted for this principal' };
      }
      try {
        const result = await container.consentCapture.withdraw({
          tenantId:   b.tenantId,
          consentId:  makeAlaraId(b.consentId),
          capturedBy: actor, // authenticated actor — body `capturedBy` is not trusted
        });
        reply.status(200);
        return {
          withdrawn: true,
          consentId: String(result.consentId),
          status:    result.status,
          eventId:   result.eventId,
        };
      } catch (err) {
        if (err instanceof ConsentAuthorizationError) {
          reply.status(403);
          return { withdrawn: false, error: err.message };
        }
        if (err instanceof ConsentCaptureValidationError) {
          reply.status(422);
          return { withdrawn: false, error: err.message };
        }
        if (err instanceof ConsentNotFoundError) {
          reply.status(404);
          return { withdrawn: false, error: err.message };
        }
        throw err;
      }
    },
  );

  // ── POST /webhooks/automynd ─────────────────────────────────────────────────
  // Registered in an ENCAPSULATED context so the raw-body JSON parser applies to this route
  // ONLY (every other route keeps the framework default parser). The parser stashes the exact
  // received bytes on `req.rawBody` for the future HMAC check (code-concordance UPDATE 22),
  // then delegates to the default JSON parser — so auth, validation, and idempotency behaviour
  // are unchanged by this slice. No HMAC, no shared-secret change here.
  await app.register(async (webhook) => {
    registerRawBodyJsonParser(webhook);

    webhook.post<{ Body: AutomyndWebhookBody }>(
    '/webhooks/automynd',
    { schema: automyndWebhookSchema },
    async (req, reply): Promise<AutomyndWebhookResponse> => {
      // Webhook ingress authentication (MVP boundary): a configured shared secret must
      // be presented in the x-automynd-secret header. Fails closed when the secret is
      // unconfigured or absent/mismatched. (Production: HMAC over the raw request body.)
      if (!secretsMatch(getHeader(req, AUTOMYND_SECRET_HEADER), getAutomyndWebhookSecret())) {
        reply.status(401);
        return { received: false, message: 'unauthorized: invalid or missing webhook secret' };
      }

      // Replay protection: a delivery MUST carry an idempotency key. The canonical event
      // id is derived from (tenant, source, key) — a replay therefore maps to the same id
      // and the Event Store dedups it (no second event). Fail closed when absent.
      const idempotencyKey = getHeader(req, IDEMPOTENCY_KEY_HEADER);
      if (!idempotencyKey) {
        reply.status(400);
        return { received: false, message: `bad request: missing ${IDEMPOTENCY_KEY_HEADER} header` };
      }
      const { eventType, tenantId, payload } = req.body;
      const eventId = deterministicEventId(tenantId, 'automynd', idempotencyKey);
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

      // Append to the system stream with the deterministic event id. On a replay, the
      // Event Store returns the EXISTING event without inserting a duplicate.
      const systemStreamId = makeAlaraId('00000000-0000-4000-8000-000000000000');
      const event = await container.eventStore.append({
        tenantId,
        streamId: systemStreamId,
        type: alaraEventType,
        payload: adapterPayload,
        actor: 'automynd-webhook',
        eventId,
      });

      // Conflict detection: if this key already produced a DIFFERENT event (different
      // payload/type), the stored event will not match what we just computed. Reject
      // rather than silently treat it as a successful (different) delivery.
      if (stableStringify(event.payload) !== stableStringify(adapterPayload)) {
        reply.status(409);
        return {
          received: false,
          alaraEventId: event.id,
          message: 'conflict: idempotency key already used for a different payload',
        };
      }

      reply.status(200);
      return { received: true, alaraEventId: event.id, message: `${eventType} processed` };
    },
    );
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic JSON with sorted keys — used to compare payloads for idempotency conflicts. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
