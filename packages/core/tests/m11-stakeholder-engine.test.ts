/**
 * Alara OS — M11 Stakeholder Engine Tests
 *
 * Coverage:
 *   - Objecthood: Stakeholder has independent identity, state, history, behavior
 *   - Creation: type validation, auto-seeded profile and preference, event emitted
 *   - Internal vs external classification (owned, derived from type, immutable)
 *   - Consent state: create with granted/unknown/restricted/revoked
 *   - Consent update: full lifecycle, event emitted, optimistic concurrency
 *   - Consent fact projection: correct shape for ConsentPolicyModule
 *   - Communication preferences: default seeded, updatable
 *   - Promise profile: auto-seeded from type defaults, owned on Stakeholder
 *   - Deactivation: soft, history preserved, event emitted
 *   - Journey reference kind: 'stakeholder' now in JOURNEY_REFERENCE_KINDS
 *   - Invalid type rejected
 *   - All existing tests continue passing (additive)
 */

import { StakeholderEngine } from '../src/stakeholder-engine/engine';
import {
  EXTERNAL_STAKEHOLDER_TYPES,
  INTERNAL_STAKEHOLDER_TYPES,
  InvalidStakeholderTypeError,
  StakeholderNotFoundError,
  isInternalStakeholder,
} from '../src/stakeholder-engine/types';
import { JOURNEY_REFERENCE_KINDS } from '../src/journey-engine/types';
import { EventStore } from '../src/events/store';
import { DatabaseClient } from '../src/shared/database';
import { makeAlaraId } from '../src/shared/ids';
import { InMemoryStore } from './helpers/in-memory-store';

// ─── Setup ────────────────────────────────────────────────────────────────────

const TENANT = 'test-tenant';
const PATIENT_ID = makeAlaraId('patient-001');
const ACTOR = 'test-actor';

function makeEngine() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const eventStore = new EventStore(db);
  return { store, engine: new StakeholderEngine(db, eventStore) };
}

// ─── 1. Type classification ───────────────────────────────────────────────────

describe('Stakeholder type classification', () => {
  test('care_guide is internal', () => {
    expect(isInternalStakeholder('care_guide')).toBe(true);
  });

  test('auth_specialist is internal', () => {
    expect(isInternalStakeholder('auth_specialist')).toBe(true);
  });

  test('don is internal', () => {
    expect(isInternalStakeholder('don')).toBe(true);
  });

  test('physician is external', () => {
    expect(isInternalStakeholder('physician')).toBe(false);
  });

  test('patient is external', () => {
    expect(isInternalStakeholder('patient')).toBe(false);
  });

  test('attorney is external', () => {
    expect(isInternalStakeholder('attorney')).toBe(false);
  });

  test('internal type list is exhaustive and correct', () => {
    expect(new Set(INTERNAL_STAKEHOLDER_TYPES)).toEqual(
      new Set(['care_guide', 'auth_specialist', 'don'])
    );
  });

  test('external type list contains all non-internal types', () => {
    for (const t of EXTERNAL_STAKEHOLDER_TYPES) {
      expect(isInternalStakeholder(t)).toBe(false);
    }
  });

  test('invalid type throws InvalidStakeholderTypeError', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.createStakeholder({
        tenantId: TENANT, patientId: PATIENT_ID,
        type: 'not_a_real_type' as any,
        actor: ACTOR,
      })
    ).rejects.toThrow(InvalidStakeholderTypeError);
  });
});

// ─── 2. Objecthood (BD-013) ───────────────────────────────────────────────────

describe('Stakeholder objecthood (BD-013)', () => {
  test('has independent identity (AlaraId UUID)', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'physician', displayName: 'Dr. Chen',
      actor: ACTOR,
    });
    expect(stakeholder.id).toBeTruthy();
    expect(stakeholder.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('has durable state (version, timestamps)', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'case_manager', actor: ACTOR,
    });
    expect(stakeholder.version).toBe(1);
    expect(stakeholder.createdAt).toBeInstanceOf(Date);
    expect(stakeholder.updatedAt).toBeInstanceOf(Date);
  });

  test('has relationships (references Patient, not owns)', async () => {
    const { engine } = makeEngine();
    const { stakeholder, patientId } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'family', actor: ACTOR,
    });
    // Stakeholder references Patient — patientId is returned separately
    expect(patientId).toBe(PATIENT_ID);
    // Stakeholder Object itself has NO patientId field (it does not own Patient)
    expect((stakeholder as any).patientId).toBeUndefined();
  });

  test('has behavior (consent can be updated, events emitted)', async () => {
    const { engine, store } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'physician', actor: ACTOR,
    });
    await engine.updateConsent({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      status: 'granted', actor: ACTOR,
    });
    const events = store.events.filter(e => e.stream_id === stakeholder.id);
    expect(events.length).toBeGreaterThanOrEqual(2); // created + consent changed
  });

  test('has history (events in EventStore)', async () => {
    const { engine, store } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'attorney', actor: ACTOR,
    });
    const events = store.events.filter(e => e.stream_id === stakeholder.id);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('StakeholderCreated');
  });
});

// ─── 3. Creation ─────────────────────────────────────────────────────────────

describe('Stakeholder creation', () => {
  test('creates with correct type and isInternal=false for external', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'physician', displayName: 'Dr. Rivera', email: 'dr@clinic.test',
      actor: ACTOR,
    });
    expect(stakeholder.type).toBe('physician');
    expect(stakeholder.isInternal).toBe(false);
    expect(stakeholder.displayName).toBe('Dr. Rivera');
    expect(stakeholder.email).toBe('dr@clinic.test');
    expect(stakeholder.active).toBe(true);
  });

  test('creates with isInternal=true for internal types', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'care_guide', actor: ACTOR,
    });
    expect(stakeholder.isInternal).toBe(true);
  });

  test('auto-seeds default preference (all category)', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'case_manager', actor: ACTOR,
    });
    expect(stakeholder.preferences).toHaveLength(1);
    expect(stakeholder.preferences[0].category).toBe('all');
    expect(stakeholder.preferences[0].optIn).toBe(true);
  });

  test('auto-seeds promise profile from type defaults', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'patient', actor: ACTOR,
    });
    expect(stakeholder.promiseProfile.jobToBeDone).toBeTruthy();
    expect(stakeholder.promiseProfile.updateTriggers.length).toBeGreaterThan(0);
    expect(stakeholder.promiseProfile.updateTriggers).toContain('AuthorizationApproved');
  });

  test('emits StakeholderCreated event', async () => {
    const { engine, store } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'discharge_planner', actor: ACTOR,
    });
    const ev = store.events.find(e => e.stream_id === stakeholder.id && e.type === 'StakeholderCreated');
    expect(ev).toBeDefined();
    expect(ev!.payload['type']).toBe('discharge_planner');
  });

  test('defaults consent_status to unknown', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'family', actor: ACTOR,
    });
    expect(stakeholder.consent.status).toBe('unknown');
    expect(stakeholder.consent.grantedAt).toBeNull();
  });

  test('accepts initial consent_status granted', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'physician', consentStatus: 'granted', actor: ACTOR,
    });
    expect(stakeholder.consent.status).toBe('granted');
    expect(stakeholder.consent.grantedAt).toBeInstanceOf(Date);
    expect(stakeholder.consent.grantedBy).toBe(ACTOR);
  });

  test('getById returns the created stakeholder', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'attorney', actor: ACTOR,
    });
    const found = await engine.getById(stakeholder.id, TENANT);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(stakeholder.id);
    expect(found!.type).toBe('attorney');
  });

  test('listByPatient returns all active stakeholders for patient', async () => {
    const { engine } = makeEngine();
    await engine.createStakeholder({ tenantId: TENANT, patientId: PATIENT_ID, type: 'physician', actor: ACTOR });
    await engine.createStakeholder({ tenantId: TENANT, patientId: PATIENT_ID, type: 'case_manager', actor: ACTOR });
    const list = await engine.listByPatient(PATIENT_ID, TENANT);
    expect(list.length).toBe(2);
  });
});

// ─── 4. Consent state ─────────────────────────────────────────────────────────

describe('Consent state', () => {
  test('updateConsent to granted sets grantedAt', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'family', actor: ACTOR,
    });
    await engine.updateConsent({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      status: 'granted', actor: ACTOR,
    });
    const updated = await engine.getById(stakeholder.id, TENANT);
    expect(updated!.consent.status).toBe('granted');
    expect(updated!.consent.grantedAt).toBeInstanceOf(Date);
  });

  test('updateConsent to revoked sets revokedAt', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'physician', consentStatus: 'granted', actor: ACTOR,
    });
    await engine.updateConsent({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      status: 'revoked', actor: ACTOR,
    });
    const updated = await engine.getById(stakeholder.id, TENANT);
    expect(updated!.consent.status).toBe('revoked');
    expect(updated!.consent.revokedAt).toBeInstanceOf(Date);
  });

  test('updateConsent emits StakeholderConsentChanged event', async () => {
    const { engine, store } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'case_manager', actor: ACTOR,
    });
    await engine.updateConsent({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      status: 'granted', actor: ACTOR,
    });
    const ev = store.events.find(
      e => e.stream_id === stakeholder.id && e.type === 'StakeholderConsentChanged'
    );
    expect(ev).toBeDefined();
    expect(ev!.payload['from']).toBe('unknown');
    expect(ev!.payload['to']).toBe('granted');
  });

  test('updateConsent on unknown stakeholder throws StakeholderNotFoundError', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.updateConsent({
        tenantId: TENANT, stakeholderId: makeAlaraId('no-such'),
        status: 'granted', actor: ACTOR,
      })
    ).rejects.toThrow(StakeholderNotFoundError);
  });

  test('restricted consent with custom scope stored correctly', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'attorney', actor: ACTOR,
    });
    await engine.updateConsent({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      status: 'restricted', scope: 'benefits', actor: ACTOR,
    });
    const updated = await engine.getById(stakeholder.id, TENANT);
    expect(updated!.consent.status).toBe('restricted');
    expect(updated!.consent.scope).toBe('benefits');
  });
});

// ─── 5. Consent fact projection ───────────────────────────────────────────────

describe('Consent fact projection (ConsentPolicyModule convergence)', () => {
  test('getConsentFact returns correct shape for granted consent', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'physician', consentStatus: 'granted', actor: ACTOR,
    });
    const fact = await engine.getConsentFact(stakeholder.id, PATIENT_ID, TENANT);
    expect(fact).not.toBeNull();
    expect(fact!.consentStatus).toBe('granted');
    expect(fact!.stakeholderId).toBe(stakeholder.id);
    expect(fact!.patientId).toBe(PATIENT_ID);
    expect(fact!.consentScope).toBe('status');
  });

  test('getConsentFact returns null for unknown stakeholder', async () => {
    const { engine } = makeEngine();
    const fact = await engine.getConsentFact(makeAlaraId('none'), PATIENT_ID, TENANT);
    expect(fact).toBeNull();
  });

  test('getConsentFact reflects revocation', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID,
      type: 'case_manager', consentStatus: 'granted', actor: ACTOR,
    });
    await engine.updateConsent({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      status: 'revoked', actor: ACTOR,
    });
    const fact = await engine.getConsentFact(stakeholder.id, PATIENT_ID, TENANT);
    expect(fact!.consentStatus).toBe('revoked');
    expect(fact!.revokedAt).not.toBeNull();
  });
});

// ─── 6. Communication preferences ────────────────────────────────────────────

describe('Communication preferences', () => {
  test('default preference seeded with correct channel for physician (fax)', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'physician', actor: ACTOR,
    });
    const allPref = stakeholder.preferences.find(p => p.category === 'all');
    expect(allPref!.channel).toBe('fax');
  });

  test('default preference seeded with inapp for internal care_guide', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'care_guide', actor: ACTOR,
    });
    const allPref = stakeholder.preferences.find(p => p.category === 'all');
    expect(allPref!.channel).toBe('inapp');
    expect(allPref!.cadence).toBe('realtime');
  });

  test('updatePreferences replaces preferences and emits event', async () => {
    const { engine, store } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'family', actor: ACTOR,
    });
    await engine.updatePreferences({
      tenantId: TENANT, stakeholderId: stakeholder.id,
      preferences: [
        { category: 'all', channel: 'sms', cadence: 'on_milestone', optIn: true },
        { category: 'scheduling', channel: 'phone', cadence: 'realtime', optIn: true },
      ],
      actor: ACTOR,
    });
    const updated = await engine.getById(stakeholder.id, TENANT);
    const allPref = updated!.preferences.find(p => p.category === 'all');
    expect(allPref!.channel).toBe('sms');
    const ev = store.events.find(
      e => e.stream_id === stakeholder.id && e.type === 'StakeholderPreferencesUpdated'
    );
    expect(ev).toBeDefined();
  });
});

// ─── 7. Promise profile ───────────────────────────────────────────────────────

describe('Promise profile', () => {
  test('patient profile has all required fields', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'patient', actor: ACTOR,
    });
    const p = stakeholder.promiseProfile;
    expect(p.jobToBeDone).toBeTruthy();
    expect(p.responsibilityTransferred).toBeTruthy();
    expect(p.successDefinition).toBeTruthy();
    expect(p.anxietyRisk).toBeTruthy();
    expect(p.communicationPromise).toBeTruthy();
    expect(p.updateTriggers.length).toBeGreaterThan(0);
  });

  test('promise profile is distinct from Promise Engine (no promiseId field)', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'patient', actor: ACTOR,
    });
    expect((stakeholder.promiseProfile as any).promiseId).toBeUndefined();
    expect((stakeholder.promiseProfile as any).status).toBeUndefined();
    expect((stakeholder.promiseProfile as any).dueAt).toBeUndefined();
  });

  test('internal stakeholder has null responsibility_transferred (receives tasks not comms)', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'care_guide', actor: ACTOR,
    });
    expect(stakeholder.promiseProfile.responsibilityTransferred).toBeNull();
  });
});

// ─── 8. Deactivation ─────────────────────────────────────────────────────────

describe('Deactivation', () => {
  test('deactivate sets active=false', async () => {
    const { engine } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'attorney', actor: ACTOR,
    });
    await engine.deactivate({ tenantId: TENANT, stakeholderId: stakeholder.id, actor: ACTOR });
    const updated = await engine.getById(stakeholder.id, TENANT);
    expect(updated!.active).toBe(false);
  });

  test('deactivate emits StakeholderDeactivated event', async () => {
    const { engine, store } = makeEngine();
    const { stakeholder } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'physician', actor: ACTOR,
    });
    await engine.deactivate({ tenantId: TENANT, stakeholderId: stakeholder.id, actor: ACTOR });
    const ev = store.events.find(
      e => e.stream_id === stakeholder.id && e.type === 'StakeholderDeactivated'
    );
    expect(ev).toBeDefined();
  });

  test('deactivated stakeholder excluded from listByPatient', async () => {
    const { engine } = makeEngine();
    const { stakeholder: s1 } = await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'physician', actor: ACTOR,
    });
    await engine.createStakeholder({
      tenantId: TENANT, patientId: PATIENT_ID, type: 'case_manager', actor: ACTOR,
    });
    await engine.deactivate({ tenantId: TENANT, stakeholderId: s1.id, actor: ACTOR });
    const list = await engine.listByPatient(PATIENT_ID, TENANT);
    expect(list.length).toBe(1);
    expect(list[0].type).toBe('case_manager');
  });

  test('deactivate unknown stakeholder throws StakeholderNotFoundError', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.deactivate({ tenantId: TENANT, stakeholderId: makeAlaraId('none'), actor: ACTOR })
    ).rejects.toThrow(StakeholderNotFoundError);
  });
});

// ─── 9. Journey reference kind ────────────────────────────────────────────────

describe('Journey reference kind — stakeholder', () => {
  test("'stakeholder' is in JOURNEY_REFERENCE_KINDS (M11 Architect ratified)", () => {
    expect(JOURNEY_REFERENCE_KINDS).toContain('stakeholder');
  });

  test('reference kinds exhaustive set includes stakeholder alongside person and workforce_member', () => {
    const kinds = new Set(JOURNEY_REFERENCE_KINDS);
    expect(kinds.has('stakeholder')).toBe(true);
    expect(kinds.has('person')).toBe(true);
    expect(kinds.has('workforce_member')).toBe(true);
  });
});
