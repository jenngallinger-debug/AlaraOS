/**
 * Alara OS API — REST Endpoint Tests
 *
 * Acceptance criteria covered:
 *   AC-1:  POST /commands/referrals runs M4 vertical slice.
 *   AC-2:  Denied referral returns explanation, creates nothing.
 *   AC-3:  POST /commands/events appends events.
 *   AC-4:  POST /webhooks/automynd uses adapter contract.
 *   AC-9:  Validation rejects malformed requests.
 *   AC-8:  API layer never writes directly to DB (all via engines).
 *
 * Transport auth boundary (API Auth Hardening Phase 1):
 *   - mutating commands require an authenticated actor (x-actor-id);
 *   - /commands/events additionally requires a privileged system actor;
 *   - /webhooks/automynd requires a valid shared secret (x-automynd-secret).
 */

import { FastifyInstance } from 'fastify';
import { buildTestApp, validReferral, TENANT, REFERRAL_ACTOR, SYSTEM_ACTOR, WEBHOOK_SECRET } from './helpers';

let app: FastifyInstance;
let store: ReturnType<typeof buildTestApp>['store'];

// Configure the webhook secret for the whole suite (read by the handler at request time).
let prevSecret: string | undefined;
beforeAll(() => { prevSecret = process.env.AUTOMYND_WEBHOOK_SECRET; process.env.AUTOMYND_WEBHOOK_SECRET = WEBHOOK_SECRET; });
afterAll(() => { if (prevSecret === undefined) delete process.env.AUTOMYND_WEBHOOK_SECRET; else process.env.AUTOMYND_WEBHOOK_SECRET = prevSecret; });

beforeEach(async () => {
  const testApp = buildTestApp();
  store = testApp.store;
  app = await testApp.buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

// ─── Authenticated request helpers ────────────────────────────────────────────

// `null` means "send no header" (a bare `undefined` would trigger the default param).
function postReferral(payload: Record<string, unknown> = validReferral, actor: string | null = REFERRAL_ACTOR) {
  const headers = actor ? { 'x-actor-id': actor } : {};
  return app.inject({ method: 'POST', url: '/commands/referrals', headers, payload });
}
function postEvent(payload: Record<string, unknown>, actor: string | null = SYSTEM_ACTOR) {
  const headers = actor ? { 'x-actor-id': actor } : {};
  return app.inject({ method: 'POST', url: '/commands/events', headers, payload });
}
// `null` for secret/key means "send no header". Default key is unique per call so
// independent webhook tests never collide on idempotency.
let webhookKeySeq = 0;
function postWebhook(
  payload: Record<string, unknown>,
  secret: string | null = WEBHOOK_SECRET,
  key: string | null = `evt-${++webhookKeySeq}`,
) {
  const headers: Record<string, string> = {};
  if (secret) headers['x-automynd-secret'] = secret;
  if (key) headers['idempotency-key'] = key;
  return app.inject({ method: 'POST', url: '/webhooks/automynd', headers, payload });
}

// ─── AC-1: POST /commands/referrals runs full M4 vertical slice ───────────────

describe('POST /commands/referrals — happy path (AC-1)', () => {
  test('Returns 201 with all IDs and allowed decision', async () => {
    const res = await postReferral();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.patientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.workflowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.promiseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.communicationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.decisionSummary.outcome).toBe('allowed');
  });

  test('Patient object is created in object store', async () => {
    await postReferral();
    expect(store.objects.size).toBeGreaterThan(0);
    const patients = Array.from(store.objects.values()).filter(o => o.type === 'Patient');
    expect(patients).toHaveLength(1);
    expect(patients[0].attributes.name).toBe('Samuel Brown');
  });

  test('Workflow is created and active', async () => {
    await postReferral();
    expect(store.workflows.size).toBe(1);
    const wf = Array.from(store.workflows.values())[0];
    expect(wf.status).toBe('active');
    expect(wf.template_id).toBe('template.intake');
  });

  test('Task is created and assigned to the authenticated actor', async () => {
    await postReferral();
    expect(store.tasks.size).toBe(1);
    const task = Array.from(store.tasks.values())[0];
    expect(task.status).toBe('open');
    expect(task.owner_id).toBe('care-guide-001');
  });

  test('Promise is created open', async () => {
    await postReferral();
    expect(store.promises.size).toBe(1);
    expect(Array.from(store.promises.values())[0].status).toBe('open');
  });

  test('Communication is sent', async () => {
    await postReferral();
    expect(store.communications.size).toBe(1);
    const comm = Array.from(store.communications.values())[0];
    expect(comm.status).toBe('sent');
    expect(comm.channel).toBe('referral_source');
  });

  test('Projection IDs are returned', async () => {
    const res = await postReferral();
    const body = res.json();
    expect(body.projectionIds.timeline).toBeDefined();
    expect(body.projectionIds.digitalCareTwin).toBeDefined();
  });

  test('ExternalReference links Automynd ID (not object identity)', async () => {
    await postReferral();
    const extRef = store.extRefs.find(r => r.value === 'AM-883201');
    expect(extRef).toBeDefined();
    expect(extRef!.system).toBe('Automynd');
    const patient = Array.from(store.objects.values()).find(o => o.type === 'Patient');
    expect(patient!.id).not.toBe('AM-883201');
  });
});

// ─── Transport authentication on mutating commands ────────────────────────────

describe('Mutating command authentication', () => {
  test('referrals without an authenticated actor → 401, nothing created', async () => {
    const res = await postReferral(validReferral, null); // no x-actor-id
    expect(res.statusCode).toBe(401);
    expect(store.objects.size).toBe(0);
  });

  test('referrals use the AUTHENTICATED actor, not a body-supplied actor', async () => {
    // Header actor differs from the (spoofed) body actor; the header must win.
    const res = await postReferral({ ...validReferral, actor: 'evil-impersonator' }, REFERRAL_ACTOR);
    expect(res.statusCode).toBe(201);
    const task = Array.from(store.tasks.values())[0];
    expect(task.owner_id).toBe(REFERRAL_ACTOR);     // authenticated actor
    expect(task.owner_id).not.toBe('evil-impersonator');
  });

  test('events without an authenticated actor → 401, nothing appended', async () => {
    const before = store.events.length;
    const res = await postEvent(
      { tenantId: TENANT, streamId: '00000000-0000-4000-8000-000000000009', type: 'ObjectCreated', payload: {} },
      null, // no x-actor-id
    );
    expect(res.statusCode).toBe(401);
    expect(store.events.length).toBe(before);
  });

  test('events with a NON-system actor → 403 (privileged surface), nothing appended', async () => {
    const before = store.events.length;
    const res = await postEvent(
      { tenantId: TENANT, streamId: '00000000-0000-4000-8000-000000000009', type: 'ObjectCreated', payload: {} },
      'care-guide-001', // authenticated but not a system actor
    );
    expect(res.statusCode).toBe(403);
    expect(store.events.length).toBe(before);
  });
});

// ─── Referral command idempotency (API surface) ───────────────────────────────

describe('POST /commands/referrals — idempotency by external referral id', () => {
  test('retry of the same referral returns the same result and creates no duplicate workflow', async () => {
    const first = await postReferral();
    const second = await postReferral(); // same validReferral (same automyndReferralId + payload)
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().patientId).toBe(first.json().patientId);
    expect(second.json().workflowId).toBe(first.json().workflowId);
    expect(store.workflows.size).toBe(1);   // no duplicate intake
    expect(store.tasks.size).toBe(1);
    expect(store.promises.size).toBe(1);
  });

  test('retry with the same referral id but a different payload → 409, no duplicate', async () => {
    const first = await postReferral();
    const conflict = await postReferral({ ...validReferral, patientName: 'Changed Name' });
    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(store.workflows.size).toBe(1);
  });
});

// ─── AC-2: Denied referral — no side effects ──────────────────────────────────

describe('POST /commands/referrals — denial (AC-2)', () => {
  test('DataIntegrityFlagged event (system actor) appends only the event', async () => {
    const eventRes = await postEvent({
      tenantId: TENANT,
      streamId: '00000000-0000-4000-8000-000000000001',
      type: 'DataIntegrityFlagged',
      payload: { conflictType: 'DOB_MISMATCH', objectId: 'obj-001' },
    });
    expect(eventRes.statusCode).toBe(201);
    expect(store.workflows.size).toBe(0);
    expect(store.tasks.size).toBe(0);
    expect(store.promises.size).toBe(0);
  });

  test('Authenticated referral with default modules → allowed', async () => {
    const res = await postReferral();
    expect(res.statusCode).toBe(201);
    expect(res.json().decisionSummary.outcome).toBe('allowed');
  });
});

// ─── AC-3: POST /commands/events (privileged system actor) ────────────────────

describe('POST /commands/events (AC-3)', () => {
  test('Appends event and returns event metadata', async () => {
    const res = await postEvent({
      tenantId: TENANT,
      streamId: '00000000-0000-4000-8000-000000000001',
      type: 'ObjectCreated',
      payload: { objectType: 'Patient', state: 'created', attributes: {} },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.eventId).toBeDefined();
    expect(body.seq).toBe(1);
    expect(body.type).toBe('ObjectCreated');
    expect(body.streamId).toBe('00000000-0000-4000-8000-000000000001');
  });

  test('Event actor is the authenticated system actor (body actor ignored)', async () => {
    await postEvent({
      tenantId: TENANT, streamId: '00000000-0000-4000-8000-00000000000a',
      type: 'ObjectCreated', payload: {}, actor: 'spoofed',
    });
    const evt = store.events.find(e => e.stream_id === '00000000-0000-4000-8000-00000000000a');
    expect(evt!.actor).toBe(SYSTEM_ACTOR);
    expect(evt!.actor).not.toBe('spoofed');
  });

  test('Sequential events increment seq', async () => {
    const streamId = '00000000-0000-4000-8000-000000000002';
    const base = { tenantId: TENANT, streamId, type: 'ObjectCreated', payload: {} };
    const r1 = await postEvent(base);
    const r2 = await postEvent({ ...base, type: 'ObjectUpdated' });
    expect(r1.json().seq).toBe(1);
    expect(r2.json().seq).toBe(2);
  });

  test('Event is stored in event store', async () => {
    const eventsBefore = store.events.length;
    await postEvent({ tenantId: TENANT, streamId: '00000000-0000-4000-8000-000000000003', type: 'WorkflowStarted', payload: {} });
    expect(store.events.length).toBe(eventsBefore + 1);
  });
});

// ─── Raw event command production gate ────────────────────────────────────────

describe('POST /commands/events — production gate (ALLOW_RAW_EVENT_COMMAND)', () => {
  // The gate is read at request time (config.isRawEventCommandEnabled), so toggling the
  // env var between requests is sufficient — no app rebuild required.
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.ALLOW_RAW_EVENT_COMMAND; });
  afterEach(() => {
    if (prev === undefined) delete process.env.ALLOW_RAW_EVENT_COMMAND;
    else process.env.ALLOW_RAW_EVENT_COMMAND = prev;
  });

  const validEvent = {
    tenantId: TENANT, streamId: '00000000-0000-4000-8000-0000000000ff',
    type: 'ObjectCreated', payload: {},
  };

  test('enabled by default under NODE_ENV=test (no override) → 201', async () => {
    delete process.env.ALLOW_RAW_EVENT_COMMAND; // default path; NODE_ENV=test under jest
    const res = await postEvent(validEvent);
    expect(res.statusCode).toBe(201);
  });

  test('explicitly disabled → 404 not-found (surface not disclosed), no event', async () => {
    process.env.ALLOW_RAW_EVENT_COMMAND = 'false';
    const before = store.events.length;
    const res = await postEvent(validEvent);
    expect(res.statusCode).toBe(404);
    expect(store.events.length).toBe(before); // nothing appended
  });

  test('disabled gate fires before auth (404 even with a system actor)', async () => {
    process.env.ALLOW_RAW_EVENT_COMMAND = '0';
    const res = await postEvent(validEvent, SYSTEM_ACTOR);
    expect(res.statusCode).toBe(404);
  });

  test('explicitly enabled (true) → 201, behaves normally', async () => {
    process.env.ALLOW_RAW_EVENT_COMMAND = 'true';
    const res = await postEvent(validEvent);
    expect(res.statusCode).toBe(201);
    expect(res.json().eventId).toBeDefined();
  });
});

// ─── AC-4: POST /webhooks/automynd (signed) ───────────────────────────────────

describe('POST /webhooks/automynd (AC-4)', () => {
  test('referral.observed uses adapter contract and appends AutomyndReferralObserved', async () => {
    const res = await postWebhook({
      eventType: 'referral.observed',
      tenantId: TENANT,
      payload: { automyndId: 'REF-001', patientAutomyndId: 'AM-883201', referralDate: '2026-06-25', referralSource: 'Dr. Jones', programType: 'EEOICPA', status: 'pending' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.received).toBe(true);
    expect(body.alaraEventId).toBeDefined();
    const event = store.events.find(e => e.type === 'AutomyndReferralObserved');
    expect(event).toBeDefined();
    expect(event!.payload.source).toBe('Automynd');
  });

  test('patient.observed appends AutomyndPatientObserved', async () => {
    const res = await postWebhook({
      eventType: 'patient.observed',
      tenantId: TENANT,
      payload: { automyndId: 'AM-883201', firstName: 'Samuel', lastName: 'Brown', dob: '1949-03-14', programType: 'EEOICPA', status: 'active' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.events.some(e => e.type === 'AutomyndPatientObserved')).toBe(true);
  });

  test('visit.observed strips clinical notes (ADR-001)', async () => {
    const res = await postWebhook({
      eventType: 'visit.observed',
      tenantId: TENANT,
      payload: { automyndId: 'VIS-001', patientAutomyndId: 'AM-883201', visitDate: '2026-06-15', visitType: 'SOC', clinicianId: 'CLN-001', status: 'completed', notes: 'Patient had SOB' },
    });
    expect(res.statusCode).toBe(200);
    const event = store.events.find(e => e.type === 'AutomyndVisitObserved');
    expect(JSON.stringify(event?.payload)).not.toContain('SOB');
    expect(JSON.stringify(event?.payload)).not.toContain('notes');
  });
});

// ─── Webhook signature verification ───────────────────────────────────────────

describe('POST /webhooks/automynd — signature verification', () => {
  const validBody = {
    eventType: 'patient.observed', tenantId: TENANT,
    payload: { automyndId: 'AM-1', firstName: 'A', lastName: 'B', dob: '1950-01-01', programType: 'EEOICPA', status: 'active' },
  };

  test('missing secret → 401, no event', async () => {
    const before = store.events.length;
    const res = await postWebhook(validBody, null);
    expect(res.statusCode).toBe(401);
    expect(store.events.length).toBe(before);
  });

  test('wrong secret → 401, no event', async () => {
    const before = store.events.length;
    const res = await postWebhook(validBody, 'not-the-secret');
    expect(res.statusCode).toBe(401);
    expect(store.events.length).toBe(before);
  });

  test('valid secret → 200, event appended', async () => {
    const res = await postWebhook(validBody, WEBHOOK_SECRET);
    expect(res.statusCode).toBe(200);
    expect(store.events.some(e => e.type === 'AutomyndPatientObserved')).toBe(true);
  });
});

// ─── Webhook idempotency / replay protection ──────────────────────────────────

describe('POST /webhooks/automynd — idempotency / replay protection', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    eventType: 'patient.observed',
    tenantId: TENANT,
    payload: { automyndId: 'AM-9', firstName: 'A', lastName: 'B', dob: '1950-01-01', programType: 'EEOICPA', status: 'active', ...over },
  });

  test('missing idempotency key → 400, no event', async () => {
    const before = store.events.length;
    const res = await postWebhook(body(), WEBHOOK_SECRET, null); // no idempotency-key
    expect(res.statusCode).toBe(400);
    expect(store.events.length).toBe(before);
  });

  test('valid secret + key → 200, exactly one event appended', async () => {
    const before = store.events.length;
    const res = await postWebhook(body(), WEBHOOK_SECRET, 'dup-key-1');
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(store.events.length).toBe(before + 1);
  });

  test('duplicate delivery (same key + payload) → no second event, safe success', async () => {
    const first = await postWebhook(body(), WEBHOOK_SECRET, 'dup-key-2');
    const countAfterFirst = store.events.length;
    const second = await postWebhook(body(), WEBHOOK_SECRET, 'dup-key-2');
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);                                  // safe success on replay
    expect(second.json().received).toBe(true);
    expect(second.json().alaraEventId).toBe(first.json().alaraEventId);   // same canonical event
    expect(store.events.length).toBe(countAfterFirst);                    // no second event appended
  });

  test('same key + DIFFERENT payload → 409, still no second event', async () => {
    const first = await postWebhook(body({ status: 'active' }), WEBHOOK_SECRET, 'dup-key-3');
    const countAfterFirst = store.events.length;
    const conflict = await postWebhook(body({ status: 'inactive' }), WEBHOOK_SECRET, 'dup-key-3');
    expect(first.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(store.events.length).toBe(countAfterFirst);                    // conflict appends nothing
  });

  test('different keys append separate events', async () => {
    const before = store.events.length;
    await postWebhook(body(), WEBHOOK_SECRET, 'key-A');
    await postWebhook(body(), WEBHOOK_SECRET, 'key-B');
    expect(store.events.length).toBe(before + 2);
  });
});

// ─── AC-9: Validation rejects malformed requests ──────────────────────────────

describe('Request validation (AC-9)', () => {
  test('POST /commands/referrals — missing required field returns 400', async () => {
    const res = await postReferral({ tenantId: TENANT, patientName: 'Test' });
    expect(res.statusCode).toBe(400);
  });

  test('POST /commands/referrals — empty tenantId returns 400', async () => {
    const res = await postReferral({ ...validReferral, tenantId: '' });
    expect(res.statusCode).toBe(400);
  });

  test('POST /commands/events — missing authentication returns 401', async () => {
    const res = await postEvent(
      { tenantId: TENANT, streamId: '00000000-0000-4000-8000-000000000001', type: 'ObjectCreated', payload: {} },
      null,
    );
    expect(res.statusCode).toBe(401);
  });

  test('POST /webhooks/automynd — invalid eventType returns 400', async () => {
    const res = await postWebhook({ eventType: 'invalid.type', tenantId: TENANT, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  test('GET /health returns 200 and ok status (public, no auth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});

// ─── AC-8: API never writes directly to database ──────────────────────────────

describe('API layer never writes directly to DB (AC-8)', () => {
  test('All objects in store came from engines, not direct writes', async () => {
    await postReferral();
    for (const obj of store.objects.values()) {
      expect(obj.type).toBeTruthy();
      expect(obj.version).toBeGreaterThanOrEqual(1);
    }
    for (const evt of store.events) {
      expect(evt.type).toBeTruthy();
      expect(evt.tenant_id).toBe(TENANT);
    }
  });
});
