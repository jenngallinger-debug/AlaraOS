/**
 * Alara OS API — raw-body capture tests
 *
 * Covers packet implementation slice 1 (code-concordance UPDATE 22): the Automynd webhook
 * is registered in an encapsulated context whose JSON parser stashes the EXACT received
 * bytes on `req.rawBody` before delegating to Fastify's default parser.
 *
 * Two layers:
 *   1. the shared `registerRawBodyJsonParser` helper (the exact code production wires) is
 *      exercised directly in a mini app — proving raw capture, faithful JSON parse,
 *      400-on-malformed, and that the parser is ENCAPSULATED (a sibling route is unaffected);
 *   2. the real `/webhooks/automynd` route still behaves exactly as before.
 */

import Fastify, { FastifyInstance } from 'fastify';
import { registerRawBodyJsonParser, getRawBody } from '../src/shared/raw-body';
import { buildTestApp, TENANT, WEBHOOK_SECRET } from './helpers';

// ─── Layer 1: the helper in an encapsulated mini app ──────────────────────────

describe('registerRawBodyJsonParser (encapsulated parser)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    // Child context with the raw-body parser — mirrors how routes.ts wires the webhook.
    await app.register(async (child) => {
      registerRawBodyJsonParser(child);
      child.post('/in', async (req) => ({ raw: getRawBody(req) ?? null, parsed: req.body }));
    });
    // Sibling route on the PARENT (default parser) — must be unaffected by the child parser.
    app.post('/out', async (req) => ({ raw: getRawBody(req) ?? null, parsed: req.body }));
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  test('captures the exact raw bytes AND parses JSON faithfully', async () => {
    // Deliberately irregular whitespace so a re-serialized object would NOT match.
    const body = '{ "a" :   1,\n  "b": "x" }';
    const res = await app.inject({
      method: 'POST', url: '/in', headers: { 'content-type': 'application/json' }, payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().raw).toBe(body);                 // byte-for-byte preserved
    expect(res.json().parsed).toEqual({ a: 1, b: 'x' }); // still parsed as before
  });

  test('malformed JSON still fails with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/in', headers: { 'content-type': 'application/json' }, payload: '{ bad',
    });
    expect(res.statusCode).toBe(400);
  });

  test('encapsulation: a sibling route on the parent does NOT capture rawBody (and parses normally)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/out', headers: { 'content-type': 'application/json' }, payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().raw).toBeNull();        // default parser → no rawBody on this route
    expect(res.json().parsed).toEqual({ a: 1 });
  });
});

// ─── Layer 2: the real /webhooks/automynd route is unchanged ──────────────────

describe('POST /webhooks/automynd — behaviour unchanged under raw-body parser', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof buildTestApp>['store'];

  let prevSecret: string | undefined;
  beforeAll(() => { prevSecret = process.env.AUTOMYND_WEBHOOK_SECRET; process.env.AUTOMYND_WEBHOOK_SECRET = WEBHOOK_SECRET; });
  afterAll(() => { if (prevSecret === undefined) delete process.env.AUTOMYND_WEBHOOK_SECRET; else process.env.AUTOMYND_WEBHOOK_SECRET = prevSecret; });

  beforeEach(async () => {
    const t = buildTestApp();
    store = t.store;
    app = await t.buildApp();
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const validBody = {
    eventType: 'patient.observed', tenantId: TENANT,
    payload: { automyndId: 'AM-RB', firstName: 'Ray', lastName: 'Bytes', dob: '1950-01-01', programType: 'EEOICPA', status: 'active' },
  };

  test('valid signed webhook still succeeds (200) and appends one event', async () => {
    const before = store.events.length;
    const res = await app.inject({
      method: 'POST', url: '/webhooks/automynd',
      headers: { 'content-type': 'application/json', 'x-automynd-secret': WEBHOOK_SECRET, 'idempotency-key': 'rb-1' },
      payload: JSON.stringify(validBody),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(store.events.length).toBe(before + 1);
  });

  test('malformed JSON to the webhook fails safely (400), no event', async () => {
    const before = store.events.length;
    const res = await app.inject({
      method: 'POST', url: '/webhooks/automynd',
      headers: { 'content-type': 'application/json', 'x-automynd-secret': WEBHOOK_SECRET, 'idempotency-key': 'rb-2' },
      payload: '{ not valid json',
    });
    expect(res.statusCode).toBe(400);
    expect(store.events.length).toBe(before);
  });
});
