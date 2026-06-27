/**
 * Alara OS — Identity Resolution Phase 1: external-reference candidate lookup
 *
 * Proves the read-only, Patient-only, external-reference-first lookup
 * (docs/architecture/identity-resolution-spec.md §4.1, §12 phase 1):
 *   - exact external reference returns the existing Patient
 *   - missing reference returns none
 *   - wrong tenant / system / id returns none
 *   - a non-Patient object sharing the reference does not resolve as a Patient
 *   - lookup is read-only (no objects/events/extRefs created)
 *   - deterministic result (stable across repeated calls)
 */

import { ObjectCommandHandler } from '../src/object-graph/command-handler';
import { EventStore } from '../src/events/store';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { IdentityResolutionRepository } from '../src/identity-resolution';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore } from './helpers/in-memory-store';

const TENANT = 'tenant-1';
const REF = { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' };

function setup() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const repo = new ObjectGraphRepository(db);
  const eventStore = new EventStore(db);
  const handler = new ObjectCommandHandler(db, repo, eventStore);
  const identity = new IdentityResolutionRepository(db);
  return { store, db, handler, identity };
}

describe('Identity Resolution — external-reference lookup (Phase 1)', () => {
  test('exact external reference returns the existing Patient', async () => {
    const { handler, identity } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const found = await identity.findPatientsByExternalReference(TENANT, REF);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(patient.id);
    expect(found[0].type).toBe('Patient');
  });

  test('missing reference returns none', async () => {
    const { handler, identity } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const found = await identity.findPatientsByExternalReference(TENANT, { ...REF, value: 'AM-000000' });
    expect(found).toHaveLength(0);
  });

  test('wrong tenant / system / id each return none', async () => {
    const { handler, identity } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    expect(await identity.findPatientsByExternalReference('tenant-2', REF)).toHaveLength(0);
    expect(await identity.findPatientsByExternalReference(TENANT, { ...REF, system: 'VA' })).toHaveLength(0);
    expect(await identity.findPatientsByExternalReference(TENANT, { ...REF, extType: 'other_id' })).toHaveLength(0);
    expect(await identity.findPatientsByExternalReference(TENANT, { ...REF, value: 'AM-999999' })).toHaveLength(0);
  });

  test('a non-Patient object sharing the reference does not resolve as a Patient', async () => {
    const { handler, identity } = setup();
    // A Stakeholder carrying the SAME external reference value.
    const { object: stakeholder } = await handler.createObject({ tenantId: TENANT, type: 'Stakeholder', actor: 'system' });
    await handler.addExternalReference(TENANT, stakeholder.id, REF, 'system');

    const found = await identity.findPatientsByExternalReference(TENANT, REF);
    expect(found).toHaveLength(0);
  });

  test('lookup is read-only — no objects / events / external references are created', async () => {
    const { store, handler, identity } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const objectsBefore = store.objects.size;
    const eventsBefore = store.events.length;
    const extRefsBefore = store.extRefs.length;

    await identity.findPatientsByExternalReference(TENANT, REF);

    expect(store.objects.size).toBe(objectsBefore);
    expect(store.events.length).toBe(eventsBefore);
    expect(store.extRefs.length).toBe(extRefsBefore);
  });

  test('deterministic result — repeated calls return the same ordered candidates', async () => {
    const { handler, identity } = setup();
    // Two Patients sharing one external reference (an ID collision the matcher will
    // later route to review — here we only assert ordering is stable).
    const { object: p1 } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    const { object: p2 } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, p1.id, REF, 'system');
    await handler.addExternalReference(TENANT, p2.id, REF, 'system');

    const a = await identity.findPatientsByExternalReference(TENANT, REF);
    const b = await identity.findPatientsByExternalReference(TENANT, REF);
    expect(a.map((o) => o.id)).toEqual(b.map((o) => o.id));
    // sorted by id ascending → deterministic regardless of insertion order
    const sorted = [p1.id, p2.id].sort();
    expect(a.map((o) => o.id)).toEqual(sorted);
  });
});
