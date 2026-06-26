/**
 * Alara OS — M0 End-to-End Test: Event-Sourced Spine
 * Proves all 8 acceptance criteria.
 */

import { ObjectCommandHandler, reconstructFromEvents } from '../src/object-graph/command-handler';
import { EventStore } from '../src/events/store';
import { ObjectGraphRepository, InvalidObjectTypeError } from '../src/object-graph/repository';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore, ExtRefRow, EventRow } from './helpers/in-memory-store';

describe('M0 End-to-End: Event-Sourced Operating System Spine', () => {
  test('Referral arrives → Patient object created → Events emitted → State reconstructed', async () => {
    const store = new InMemoryStore();
    const db = store as unknown as DatabaseClient;
    const repo = new ObjectGraphRepository(db);
    const eventStore = new EventStore(db);
    const handler = new ObjectCommandHandler(db, repo, eventStore);

    // Step 1: Create Patient
    const { object: patient, eventId: createEventId } = await handler.createObject({
      tenantId: 'alara-home-care',
      type: 'Patient',
      actor: 'intake-coordinator-1',
      attributes: { name: 'Samuel Brown', programContext: 'EEOICPA' },
    });

    // AC-1: Object was created
    expect(patient).toBeDefined();
    // AC-2: Object has Alara UUID
    expect(patient.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    // AC-4: Event appended
    expect(createEventId).toBeDefined();

    // Step 2: Link Automynd ID
    await handler.addExternalReference('alara-home-care', patient.id,
      { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' }, 'intake-coordinator-1');

    // AC-3: External ID stored separately
    expect(patient.id).not.toBe('AM-883201');
    const extRefOnObject = store.objects.get(patient.id)?.attributes;
    expect(JSON.stringify(extRefOnObject)).not.toContain('AM-883201');
    const extRef = store.extRefs.find((r: ExtRefRow) => r.value === 'AM-883201');
    expect(extRef?.object_id).toBe(patient.id);

    // Step 3: Create Workflow
    const { object: workflow } = await handler.createObject({
      tenantId: 'alara-home-care', type: 'Workflow', actor: 'system',
      attributes: { purpose: 'referral-intake', forPatient: patient.id, stage: 'intake', owner: 'intake-coordinator-1' },
    });
    expect(workflow.attributes.forPatient).toBe(patient.id);

    // Step 4: Update Patient
    const { object: updatedPatient } = await handler.updateObject({
      tenantId: 'alara-home-care', id: patient.id,
      changes: { intakeWorkflowId: workflow.id, status: 'intake-in-progress' },
      expectedVersion: 1, actor: 'intake-coordinator-1',
    });
    // AC-6: Version incremented
    expect(updatedPatient.version).toBe(2);

    // Step 5: Verify event stream
    const patientEvents = await eventStore.loadStream('alara-home-care', patient.id);
    expect(patientEvents).toHaveLength(3);
    expect(patientEvents[0].type).toBe('ObjectCreated');
    expect(patientEvents[1].type).toBe('ExternalReferenceAdded');
    expect(patientEvents[2].type).toBe('ObjectUpdated');
    expect(patientEvents.map(e => e.seq)).toEqual([1, 2, 3]);

    // Step 6: Reconstruct from events
    const reconstructed = await reconstructFromEvents(eventStore, 'alara-home-care', patient.id);
    // AC-5 / AC-8c
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.id).toBe(patient.id);
    expect(reconstructed!.type).toBe('Patient');
    expect(reconstructed!.attributes.name).toBe('Samuel Brown');
    expect(reconstructed!.attributes.status).toBe('intake-in-progress');
    expect(reconstructed!.attributes.intakeWorkflowId).toBe(workflow.id);
    expect(reconstructed!.externalReferences[0]).toMatchObject({ system: 'Automynd', extType: 'patient_id', value: 'AM-883201' });
    expect(reconstructed!.version).toBe(3);

    // Step 7: Delete snapshot — truth survives in event store
    store.objects.delete(patient.id);
    const rebuilt = await reconstructFromEvents(eventStore, 'alara-home-care', patient.id);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.attributes.name).toBe('Samuel Brown');
    expect(rebuilt!.attributes.status).toBe('intake-in-progress');

    // AC-8e: Growth types rejected
    for (const illegal of ['Community', 'Campaign', 'Moment', 'Audience', 'Reputation']) {
      await expect(
        handler.createObject({ tenantId: 'alara-home-care', type: illegal as never, actor: 'system' })
      ).rejects.toThrow(InvalidObjectTypeError);
    }

    // AC-8f: Stale version rejected
    await expect(
      handler.updateObject({ tenantId: 'alara-home-care', id: patient.id, changes: { shouldFail: true }, expectedVersion: 1, actor: 'system' })
    ).rejects.toThrow();

    // AC-8d: Events only grow
    const totalEvents = store.events.length;
    expect(totalEvents).toBe(4); // 3 patient + 1 workflow
    expect(store.events.every((e: EventRow) => e.occurred_at instanceof Date)).toBe(true);
  });
});
