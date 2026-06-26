/**
 * Alara OS — M0 Unit Tests: Object Graph
 */

import { ObjectCommandHandler } from '../src/object-graph/command-handler';
import { EventStore } from '../src/events/store';
import { ObjectGraphRepository, InvalidObjectTypeError, StaleVersionError } from '../src/object-graph/repository';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore, ExtRefRow } from './helpers/in-memory-store';

function makeHandler() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const repo = new ObjectGraphRepository(db);
  const eventStore = new EventStore(db);
  const handler = new ObjectCommandHandler(db, repo, eventStore);
  return { handler, store, repo, eventStore, db };
}

describe('Object identity', () => {
  test('AC-1 / AC-2: createObject returns an object with an Alara UUID', async () => {
    const { handler } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    expect(object.id).toBeDefined();
    expect(typeof object.id).toBe('string');
    expect(object.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('AC-8a: Identity is stable across updates', async () => {
    const { handler } = makeHandler();
    const { object: original } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system', attributes: { name: 'James' } });
    const { object: updated } = await handler.updateObject({ tenantId: 'tenant-1', id: original.id, changes: { name: 'James Updated' }, expectedVersion: 1, actor: 'care-guide-1' });
    expect(updated.id).toBe(original.id);
  });

  test('Default state is "created"', async () => {
    const { handler } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Workflow', actor: 'system' });
    expect(object.state).toBe('created');
  });

  test('Initial version is 1', async () => {
    const { handler } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Journey', actor: 'system' });
    expect(object.version).toBe(1);
  });
});

describe('AC-3: External references are not identity', () => {
  test('External ID stored separately from object identity', async () => {
    const { handler, store } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    await handler.addExternalReference('tenant-1', object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }, 'system');

    const extRefs = store.extRefs.filter((r: ExtRefRow) => r.object_id === object.id);
    expect(extRefs).toHaveLength(1);
    expect(extRefs[0].value).toBe('AM-883201');
    expect(extRefs[0].system).toBe('Automynd');
    expect(object.id).not.toBe('AM-883201');
    expect(object.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('AC-8b: External IDs are not identity — object attributes contain no external IDs', async () => {
    const { handler, store } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system', attributes: { name: 'Test Patient' } });
    await handler.addExternalReference('tenant-1', object.id, { system: 'VA', extType: 'auth_id', value: 'VA-99999' }, 'system');

    const row = store.objects.get(object.id)!;
    expect(JSON.stringify(row.attributes)).not.toContain('VA-99999');
    const extRef = store.extRefs.find((r: ExtRefRow) => r.value === 'VA-99999');
    expect(extRef).toBeDefined();
    expect(extRef?.object_id).toBe(object.id);
  });

  test('Multiple external references on one object', async () => {
    const { handler, store } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    await handler.addExternalReference('tenant-1', object.id, { system: 'Automynd', extType: 'patient_id', value: 'AM-001' }, 'system');
    await handler.addExternalReference('tenant-1', object.id, { system: 'VA', extType: 'auth_id', value: 'VA-001' }, 'system');

    const refs = store.extRefs.filter((r: ExtRefRow) => r.object_id === object.id);
    expect(refs).toHaveLength(2);
  });
});

describe('AC-6: Object updates are versioned', () => {
  test('Version increments on update', async () => {
    const { handler } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    const { object: v2 } = await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { name: 'James' }, expectedVersion: 1, actor: 'care-guide-1' });
    expect(v2.version).toBe(2);
  });

  test('AC-8f: Stale version update throws StaleVersionError', async () => {
    const { handler } = makeHandler();
    const { object } = await handler.createObject({ tenantId: 'tenant-1', type: 'Patient', actor: 'system' });
    await handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { name: 'James' }, expectedVersion: 1, actor: 'care-guide-1' });
    await expect(
      handler.updateObject({ tenantId: 'tenant-1', id: object.id, changes: { name: 'James Again' }, expectedVersion: 1, actor: 'care-guide-1' })
    ).rejects.toThrow(StaleVersionError);
  });
});

describe('AC-8e: Growth object types are rejected (Objecthood Principle)', () => {
  test.each([
    'Community', 'Campaign', 'Moment', 'Audience', 'Territory',
    'ReferralNetwork', 'TrustSignal', 'GrowthSignal', 'Reputation',
    'Channel', 'Influence', 'Acquisition', 'Barrier', 'GrowthOpportunity',
    'Story', 'Question', 'Competitor',
  ])('"%s" is not a valid primary object type', async (invalidType) => {
    const { handler } = makeHandler();
    await expect(
      handler.createObject({ tenantId: 'tenant-1', type: invalidType as never, actor: 'system' })
    ).rejects.toThrow(InvalidObjectTypeError);
  });

  test('All canonical Part XI object types are accepted', async () => {
    const { handler } = makeHandler();
    const validTypes = [
      'Patient', 'Relationship', 'Workflow', 'Journey', 'Goal',
      'Benefit', 'CommunityResource', 'Communication', 'Promise',
      'Opportunity', 'Stakeholder', 'AIAgent', 'KnowledgeObject', 'Timeline',
    ] as const;
    for (const type of validTypes) {
      const { object } = await handler.createObject({ tenantId: 'tenant-1', type, actor: 'system' });
      expect(object.type).toBe(type);
    }
  });
});
