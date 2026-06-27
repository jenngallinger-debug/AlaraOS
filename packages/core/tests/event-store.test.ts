/**
 * Alara OS — M0 Unit Tests: Event Store
 *
 * Proves:
 *   AC-4: Object creation appends an immutable event.
 *   AC-5: Current object state can be reconstructed by replaying events.
 *   AC-7: Event append is idempotent.
 *   AC-8c: Replay reconstructs state.
 *   AC-8d: Events are append-only.
 */

import { ObjectCommandHandler, reconstructFromEvents } from '../src/object-graph/command-handler';
import { EventStore } from '../src/events/store';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { InMemoryStore } from './helpers/in-memory-store';
import { ExternalReference } from '../src/shared/types';

function makeHandler() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const repo = new ObjectGraphRepository(db);
  const eventStore = new EventStore(db);
  const handler = new ObjectCommandHandler(db, repo, eventStore);
  return { handler, store, repo, eventStore, db };
}

describe('AC-4: Object creation appends an immutable event', () => {
  test('Creates exactly one ObjectCreated event', async () => {
    const { handler, eventStore } = makeHandler();
    const { object, eventId } = await handler.createObject({
      tenantId: 'tenant-1',
      type: 'Patient',
      actor: 'system',
      attributes: { name: 'Test Patient' },
    });

    expect(eventId).toBeDefined();
    const count = await eventStore.countInStream('tenant-1', object.id);
    expect(count).toBe(1);

    const stream = await eventStore.loadStream('tenant-1', object.id);
    expect(stream[0].type).toBe('ObjectCreated');
    expect(stream[0].seq).toBe(1);
  });

  test('ObjectCreated event payload contains type and attributes', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({
      tenantId: 'tenant-1',
      type: 'Workflow',
      actor: 'system',
      attributes: { purpose: 'intake' },
    });

    const events = await eventStore.loadStream('tenant-1', object.id);
    const created = events[0];
    expect(created.type).toBe('ObjectCreated');
    expect((created.payload as Record<string, unknown>).objectType).toBe('Workflow');
    expect((created.payload as Record<string, unknown>).attributes).toMatchObject({ purpose: 'intake' });
  });

  test('Update appends ObjectUpdated event', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { status: 'active' }, expectedVersion: 1, actor: 'care-guide-1' });

    const events = await eventStore.loadStream('tenant-1', object.id);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('ObjectUpdated');
    expect(events[1].seq).toBe(2);
  });

  test('AddExternalReference appends ExternalReferenceAdded event', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    await handler.addExternalReference('tenant-1', object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-001' }, 'system');

    const events = await eventStore.loadStream('tenant-1', object.id);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('ExternalReferenceAdded');
  });
});

describe('AC-8d: Events are append-only', () => {
  test('Event count only increases, never decreases', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    const countBefore = await eventStore.countInStream('tenant-1', object.id);
    await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { x: 1 }, expectedVersion: 1, actor: 'system' });
    const countAfter = await eventStore.countInStream('tenant-1', object.id);
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  test('Events are ordered by seq, starting at 1', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Journey', actor: 'system' });
    for (let i = 0; i < 3; i++) {
      await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { step: i }, expectedVersion: i + 1, actor: 'system' });
    }
    const events = await eventStore.loadStream('tenant-1', object.id);
    expect(events.map(e => e.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe('AC-5 / AC-8c: State reconstruction by event replay', () => {
  test('Reconstruct Patient state from events', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({
      tenantId: 'tenant-1', type: 'Patient', actor: 'system',
      attributes: { name: 'Samuel Brown', dob: '1949-03-04' },
    });
    await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { status: 'active' }, expectedVersion: 1, actor: 'care-guide-1' });
    await handler.addExternalReference('tenant-1', object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }, 'system');

    const reconstructed = await reconstructFromEvents(eventStore, 'tenant-1', object.id);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.id).toBe(object.id);
    expect(reconstructed!.type).toBe('Patient');
    expect(reconstructed!.attributes.name).toBe('Samuel Brown');
    expect(reconstructed!.attributes.status).toBe('active');
    expect(reconstructed!.version).toBe(3);
    expect(reconstructed!.externalReferences).toHaveLength(1);
    expect(reconstructed!.externalReferences[0].system).toBe('Automynd');
    expect(reconstructed!.externalReferences[0].value).toBe('AM-883201');
  });

  test('Reconstructed state matches live object state', async () => {
    const { handler, eventStore, repo } = makeHandler();
    const { object } = await handler.createObject({
      tenantId: 'tenant-1', type: 'Workflow', actor: 'system',
      attributes: { purpose: 'referral-intake', owner: 'care-guide-1' },
    });
    await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { stage: 'qualification' }, expectedVersion: 1, actor: 'system' });

    const live = await repo.getById('tenant-1', object.id);
    const reconstructed = await reconstructFromEvents(eventStore, 'tenant-1', object.id);
    expect(reconstructed!.type).toBe(live!.type);
    expect(reconstructed!.attributes.purpose).toBe(live!.attributes.purpose);
    expect(reconstructed!.attributes.stage).toBe(live!.attributes.stage);
  });

  test('Returns null for non-existent stream', async () => {
    const { eventStore } = makeHandler();
    const fakeId = makeAlaraId('00000000-0000-4000-8000-000000000000');
    const result = await reconstructFromEvents(eventStore, 'tenant-1', fakeId);
    expect(result).toBeNull();
  });

  test('External reference upsert is reflected in reconstruction', async () => {
    const { handler, eventStore } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    await handler.addExternalReference('tenant-1', object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-OLD' }, 'system');
    await handler.addExternalReference('tenant-1', object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-NEW' }, 'system');

    const reconstructed = await reconstructFromEvents(eventStore, 'tenant-1', object.id);
    const automyndRef = reconstructed!.externalReferences.find(
      (r: ExternalReference) => r.system === 'Automynd' && r.extType === 'patient_id',
    );
    expect(automyndRef?.value).toBe('AM-NEW');
    expect(reconstructed!.externalReferences.filter((r: ExternalReference) => r.system === 'Automynd').length).toBe(1);
  });
});

describe('Append concurrency — same-stream serialization (P0 hardening)', () => {
  // These exercise the per-stream advisory lock added to EventStore.append. Without
  // it, concurrent appends to one stream race on MAX(seq)+1 and produce duplicate /
  // lost seqs — these tests fail. With it, same-stream appends serialize into a
  // contiguous sequence while different streams proceed independently.
  const TENANT = 'tenant-conc';
  const stream = (n: string) => makeAlaraId(`${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`);

  test('sequential appends produce a contiguous sequence', async () => {
    const { eventStore } = makeHandler();
    const s = stream('1');
    for (let i = 0; i < 5; i++) {
      await eventStore.append({ tenantId: TENANT, streamId: s, type: 'ObjectUpdated', payload: { i }, actor: 'system' });
    }
    const events = await eventStore.loadStream(TENANT, s);
    expect(events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  test('concurrent appends to the SAME stream → unique contiguous seq, none lost', async () => {
    const { eventStore } = makeHandler();
    const s = stream('2');
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        eventStore.append({ tenantId: TENANT, streamId: s, type: 'ObjectUpdated', payload: { i }, actor: 'system' }),
      ),
    );
    const events = await eventStore.loadStream(TENANT, s);

    // no append silently dropped
    expect(events).toHaveLength(N);
    const seqs = events.map(e => e.seq).sort((a, b) => a - b);
    // contiguous 1..N
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    // no duplicate sequence numbers
    expect(new Set(seqs).size).toBe(N);
    // every appended payload survived exactly once
    expect(new Set(events.map(e => (e.payload as { i: number }).i)).size).toBe(N);
  });

  test('concurrent appends to DIFFERENT streams each succeed independently', async () => {
    const { eventStore } = makeHandler();
    const streams = [stream('3'), stream('4'), stream('5')];
    await Promise.all(
      streams.flatMap(s =>
        Array.from({ length: 5 }, (_, i) =>
          eventStore.append({ tenantId: TENANT, streamId: s, type: 'ObjectUpdated', payload: { i }, actor: 'system' }),
        ),
      ),
    );
    for (const s of streams) {
      const events = await eventStore.loadStream(TENANT, s);
      expect(events.map(e => e.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    }
  });
});

describe('Multi-tenant isolation', () => {
  test('Events from different tenants are isolated', async () => {
    const { handler, eventStore } = makeHandler();
    const { object: obj1 } = await handler.createObject({ tenantId: 'tenant-A', type: 'Patient', actor: 'system' });
    const { object: obj2 } = await handler.createObject({ tenantId: 'tenant-B', type: 'Patient', actor: 'system' });

    const streamA = await eventStore.loadStream('tenant-A', obj1.id);
    const streamB = await eventStore.loadStream('tenant-B', obj2.id);
    expect(streamA).toHaveLength(1);
    expect(streamB).toHaveLength(1);
    expect(streamA[0].tenantId).toBe('tenant-A');
    expect(streamB[0].tenantId).toBe('tenant-B');
  });
});
