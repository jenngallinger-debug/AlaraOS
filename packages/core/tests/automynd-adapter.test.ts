/**
 * Alara OS — Automynd Adapter Tests
 *
 * Proves:
 *   - Adapter contract is stable (IAutomyndAdapter)
 *   - Clinical notes never appear in emitted payloads (ADR-001)
 *   - DOB mismatch triggers DataIntegrityFlagged (JV-002 scenario)
 *   - External IDs stay in payload, not as Alara identity
 *   - Fixture data is deterministic
 */

import { FixtureAutomyndAdapter, FIXTURE_PATIENTS, FIXTURE_REFERRALS, FIXTURE_VISITS } from '../src/automynd-adapter/fixture-adapter';
import { IAutomyndAdapter } from '../src/automynd-adapter/types';

describe('FixtureAutomyndAdapter — ADR-001 compliance', () => {
  let adapter: IAutomyndAdapter;
  beforeEach(() => { adapter = new FixtureAutomyndAdapter(); });

  test('emitPatientObserved — returns payload with Automynd ID, not Alara UUID', async () => {
    const patient = FIXTURE_PATIENTS[0]; // Samuel Brown
    const payload = await adapter.emitPatientObserved(patient);

    expect(payload.automyndPatientId).toBe('AM-883201');
    expect(payload.source).toBe('Automynd');
    expect(payload.programType).toBe('EEOICPA');
    // Payload contains Automynd ID, not an Alara UUID — the pipeline creates the Alara object
    expect(payload.automyndPatientId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]/);
  });

  test('emitReferralObserved — returns reference payload without clinical content', async () => {
    const referral = FIXTURE_REFERRALS[0];
    const payload = await adapter.emitReferralObserved(referral);

    expect(payload.automyndReferralId).toBe('REF-001');
    expect(payload.automyndPatientId).toBe('AM-883201');
    expect(payload.source).toBe('Automynd');
    // No clinical content in the payload
    expect(JSON.stringify(payload)).not.toContain('diagnosis');
    expect(JSON.stringify(payload)).not.toContain('notes');
  });

  test('emitVisitObserved — clinical notes not in payload (ADR-001)', async () => {
    const visit = FIXTURE_VISITS[0];
    const payload = await adapter.emitVisitObserved(visit);

    expect(payload.automyndVisitId).toBe('VIS-001');
    expect(payload.status).toBe('completed');
    expect(payload.source).toBe('Automynd');
    // ADR-001: visit notes stay in Automynd (clinical SoR)
    expect('notes' in payload).toBe(false);
  });

  test('emitOrderObserved — returns reference payload', async () => {
    const order = {
      automyndId: 'ORD-001',
      patientAutomyndId: 'AM-883201',
      orderDate: '2026-06-01',
      orderType: 'Physical Therapy',
      physicianNpi: '1234567890',
      status: 'pending',
    };
    const payload = await adapter.emitOrderObserved(order);

    expect(payload.automyndOrderId).toBe('ORD-001');
    expect(payload.source).toBe('Automynd');
    // Order content stays in Automynd — Alara tracks existence + status only
    expect('physicianNpi' in payload).toBe(false);
  });
});

describe('FixtureAutomyndAdapter — data integrity (JV-002 scenario)', () => {
  let adapter: FixtureAutomyndAdapter;
  beforeEach(() => { adapter = new FixtureAutomyndAdapter(); });

  test('DOB mismatch → hasConflict: true with DOB_MISMATCH type', () => {
    const automyndPatient = FIXTURE_PATIENTS[0]; // Automynd dob: 1949-03-14
    const alaraAttributes = { name: 'Samuel Brown', dob: '1949-03-04' }; // Alara dob differs

    const result = adapter.checkDataIntegrity(automyndPatient, alaraAttributes);

    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('DOB_MISMATCH');
    expect(result.conflictDetails?.field).toBe('dob');
    expect(result.conflictDetails?.automyndValue).toBe('1949-03-14');
    expect(result.conflictDetails?.alaraValue).toBe('1949-03-04');
    expect(result.conflictDetails?.resolution).toBe('REQUIRES_HUMAN_RECONCILIATION');
  });

  test('DOB match → no conflict', () => {
    const automyndPatient = FIXTURE_PATIENTS[0]; // dob: 1949-03-14
    const alaraAttributes = { name: 'Samuel Brown', dob: '1949-03-14' }; // matches

    const result = adapter.checkDataIntegrity(automyndPatient, alaraAttributes);

    expect(result.hasConflict).toBe(false);
    expect(result.conflictType).toBeUndefined();
  });

  test('No DOB in Alara attributes → no conflict (DOB not yet recorded)', () => {
    const automyndPatient = FIXTURE_PATIENTS[0];
    const alaraAttributes = { name: 'Samuel Brown' }; // no dob yet

    const result = adapter.checkDataIntegrity(automyndPatient, alaraAttributes);

    expect(result.hasConflict).toBe(false);
  });
});

describe('FixtureAutomyndAdapter — contract stability', () => {
  test('IAutomyndAdapter interface is implemented by FixtureAutomyndAdapter', () => {
    const adapter: IAutomyndAdapter = new FixtureAutomyndAdapter();

    expect(typeof adapter.emitPatientObserved).toBe('function');
    expect(typeof adapter.emitReferralObserved).toBe('function');
    expect(typeof adapter.emitVisitObserved).toBe('function');
    expect(typeof adapter.emitOrderObserved).toBe('function');
    expect(typeof adapter.checkDataIntegrity).toBe('function');
  });

  test('Fixture data is deterministic across calls', async () => {
    const adapter = new FixtureAutomyndAdapter();
    const p1 = await adapter.emitPatientObserved(FIXTURE_PATIENTS[0]);
    const p2 = await adapter.emitPatientObserved(FIXTURE_PATIENTS[0]);

    expect(p1).toEqual(p2);
  });
});
