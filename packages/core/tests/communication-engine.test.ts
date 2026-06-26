/**
 * Alara OS — Communication Engine Tests
 *
 * Proves:
 *   - Full lifecycle: created → queued → sent → delivered
 *   - Failure path: sent → failed (adapter failure)
 *   - Stale version rejected
 *   - Every transition appends event
 *   - Replay reconstructs communication state
 *   - All 5 channels supported
 *   - No adapter registered → CommunicationFailed event
 */

import { CommunicationEngine, reconstructCommunicationFromEvents, StaleCommunicationError } from '../src/communication-engine/engine';
import { StubDeliveryAdapter } from '../src/communication-engine/stub-adapter';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { InMemoryStore } from './helpers/in-memory-store';

const TENANT = 'alara-home-care';
const PATIENT_ID = makeAlaraId('00000000-0000-4000-8000-000000000001');

function makeEngine() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  const adapter = new StubDeliveryAdapter();
  const engine = new CommunicationEngine(db, eventStore);
  engine.registerAdapter(adapter);
  return { engine, eventStore, store, adapter };
}

const baseCmd = {
  tenantId: TENANT, channel: 'referral_source' as const,
  purpose: 'referral_acknowledgement' as const,
  subjectId: PATIENT_ID, workflowId: null,
  recipientType: 'referral_source' as const,
  recipientId: 'dr-jones-clinic',
  subject: 'Referral Acknowledged', body: 'We received your referral.',
  actor: 'care-guide-001',
};

describe('Communication Engine — lifecycle', () => {
  test('create → status is created, version 1', async () => {
    const { engine } = makeEngine();
    const comm = await engine.create(baseCmd);
    expect(comm.status).toBe('created');
    expect(comm.version).toBe(1);
    expect(comm.channel).toBe('referral_source');
  });

  test('queue → status becomes queued', async () => {
    const { engine } = makeEngine();
    const comm = await engine.create(baseCmd);
    const queued = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    expect(queued.status).toBe('queued');
    expect(queued.version).toBe(2);
  });

  test('send → adapter called → status becomes sent', async () => {
    const { engine, adapter } = makeEngine();
    const comm = await engine.create(baseCmd);
    const queued = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    const sent = await engine.send({ tenantId: TENANT, communicationId: queued.id, actor: 'system', expectedVersion: 2 });
    expect(sent.status).toBe('sent');
    expect(sent.adapterUsed).toBe('stub');
    expect(adapter.delivered).toHaveLength(1);
  });

  test('markDelivered → status becomes delivered', async () => {
    const { engine } = makeEngine();
    const comm = await engine.create(baseCmd);
    const q = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    const s = await engine.send({ tenantId: TENANT, communicationId: q.id, actor: 'system', expectedVersion: 2 });
    const delivered = await engine.markDelivered({ tenantId: TENANT, communicationId: s.id, actor: 'system', expectedVersion: 3 });
    expect(delivered.status).toBe('delivered');
  });

  test('adapter failure → status becomes failed with reason', async () => {
    const { engine, adapter } = makeEngine();
    adapter.simulateFailure = true;
    adapter.failureReason = 'Network timeout';
    const comm = await engine.create(baseCmd);
    const q = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    const failed = await engine.send({ tenantId: TENANT, communicationId: q.id, actor: 'system', expectedVersion: 2 });
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toBe('Network timeout');
  });

  test('no adapter registered → CommunicationFailed', async () => {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const eventStore = new EventStore(db);
    const engine = new CommunicationEngine(db, eventStore); // no adapter registered
    const comm = await engine.create(baseCmd);
    const q = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    const result = await engine.send({ tenantId: TENANT, communicationId: q.id, actor: 'system', expectedVersion: 2 });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('No adapter registered');
  });
});

describe('Communication Engine — all channels', () => {
  test.each([
    ['internal',        'internal'],
    ['patient',         'patient'],
    ['family',          'family'],
    ['physician',       'physician'],
    ['referral_source', 'referral_source'],
  ] as const)('channel "%s" can be created and sent', async (channel, recipientType) => {
    const { engine } = makeEngine();
    const comm = await engine.create({ ...baseCmd, channel, recipientType });
    expect(comm.channel).toBe(channel);
    const q = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    const sent = await engine.send({ tenantId: TENANT, communicationId: q.id, actor: 'system', expectedVersion: 2 });
    expect(sent.status).toBe('sent');
  });
});

describe('Communication Engine — events', () => {
  test('Every transition appends correct event type', async () => {
    const { engine, eventStore } = makeEngine();
    const comm = await engine.create(baseCmd);
    const q = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    const s = await engine.send({ tenantId: TENANT, communicationId: q.id, actor: 'system', expectedVersion: 2 });
    await engine.markDelivered({ tenantId: TENANT, communicationId: s.id, actor: 'system', expectedVersion: 3 });

    const events = await eventStore.loadStream(TENANT, comm.id);
    expect(events.map(e => e.type)).toEqual([
      'CommunicationCreated', 'CommunicationQueued', 'CommunicationSent', 'CommunicationDelivered',
    ]);
  });

  test('Replay reconstructs communication state', async () => {
    const { engine, eventStore } = makeEngine();
    const comm = await engine.create(baseCmd);
    const q = await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    await engine.send({ tenantId: TENANT, communicationId: q.id, actor: 'system', expectedVersion: 2 });

    const reconstructed = await reconstructCommunicationFromEvents(eventStore, TENANT, comm.id);
    expect(reconstructed!.status).toBe('sent');
    expect(reconstructed!.channel).toBe('referral_source');
    expect(reconstructed!.version).toBe(3);
  });
});

describe('Communication Engine — concurrency', () => {
  test('Stale version on queue throws StaleCommunicationError', async () => {
    const { engine } = makeEngine();
    const comm = await engine.create(baseCmd);
    await engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 });
    await expect(
      engine.queue({ tenantId: TENANT, communicationId: comm.id, actor: 'system', expectedVersion: 1 })
    ).rejects.toThrow(StaleCommunicationError);
  });
});
