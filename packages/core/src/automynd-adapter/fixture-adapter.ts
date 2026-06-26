/**
 * Alara OS — Fixture Automynd Adapter
 *
 * Implements IAutomyndAdapter with deterministic fixture data.
 * Used in M0–M5 development and all tests.
 *
 * The real Automynd integration in M6 will replace this class
 * without changing any downstream code.
 *
 * ADR-001 compliance: the adapter never copies clinical content
 * into Alara objects. It emits reference payloads only.
 */

import {
  AutomyndOrder,
  AutomyndOrderObservedPayload,
  AutomyndPatient,
  AutomyndPatientObservedPayload,
  AutomyndReferral,
  AutomyndReferralObservedPayload,
  AutomyndVisit,
  AutomyndVisitObservedPayload,
  DataIntegrityCheckResult,
  IAutomyndAdapter,
} from './types';

export class FixtureAutomyndAdapter implements IAutomyndAdapter {
  async emitPatientObserved(
    patient: AutomyndPatient,
  ): Promise<AutomyndPatientObservedPayload> {
    return {
      automyndPatientId: patient.automyndId,
      programType: patient.programType,
      status: patient.status,
      dobForReconciliation: patient.dob,
      source: 'Automynd',
    };
  }

  async emitReferralObserved(
    referral: AutomyndReferral,
  ): Promise<AutomyndReferralObservedPayload> {
    return {
      automyndReferralId: referral.automyndId,
      automyndPatientId: referral.patientAutomyndId,
      referralDate: referral.referralDate,
      referralSource: referral.referralSource,
      programType: referral.programType,
      status: referral.status,
      source: 'Automynd',
    };
  }

  async emitVisitObserved(
    visit: AutomyndVisit,
  ): Promise<AutomyndVisitObservedPayload> {
    // ADR-001: clinical visit notes are NOT included in the payload
    return {
      automyndVisitId: visit.automyndId,
      automyndPatientId: visit.patientAutomyndId,
      visitDate: visit.visitDate,
      visitType: visit.visitType,
      status: visit.status,
      source: 'Automynd',
    };
  }

  async emitOrderObserved(
    order: AutomyndOrder,
  ): Promise<AutomyndOrderObservedPayload> {
    return {
      automyndOrderId: order.automyndId,
      automyndPatientId: order.patientAutomyndId,
      orderDate: order.orderDate,
      orderType: order.orderType,
      status: order.status,
      source: 'Automynd',
    };
  }

  checkDataIntegrity(
    automyndRecord: AutomyndPatient,
    alaraAttributes: Record<string, unknown>,
  ): DataIntegrityCheckResult {
    // DOB mismatch — the real-world scenario from JV-002
    // Automynd: 03/14, Alara: 03/04/1949 (Samuel Brown scenario)
    if (
      alaraAttributes.dob &&
      typeof alaraAttributes.dob === 'string' &&
      alaraAttributes.dob !== automyndRecord.dob
    ) {
      return {
        hasConflict: true,
        conflictType: 'DOB_MISMATCH',
        conflictDetails: {
          field: 'dob',
          automyndValue: automyndRecord.dob,
          alaraValue: alaraAttributes.dob,
          automyndId: automyndRecord.automyndId,
          resolution: 'REQUIRES_HUMAN_RECONCILIATION',
          adR001Note: 'Alara may not overwrite Automynd. Human must determine source of truth.',
        },
      };
    }

    return { hasConflict: false };
  }
}

// ─── Fixture datasets ─────────────────────────────────────────────────────────

export const FIXTURE_PATIENTS: AutomyndPatient[] = [
  {
    automyndId: 'AM-883201',
    firstName: 'Samuel',
    lastName: 'Brown',
    dob: '1949-03-14',  // Automynd value — intentionally different from JV-002
    programType: 'EEOICPA',
    status: 'active',
    referralDate: '2026-06-01',
  },
  {
    automyndId: 'AM-773100',
    firstName: 'Margaret',
    lastName: 'Chen',
    dob: '1952-07-22',
    programType: 'VA',
    status: 'active',
    referralDate: '2026-06-10',
  },
];

export const FIXTURE_REFERRALS: AutomyndReferral[] = [
  {
    automyndId: 'REF-001',
    patientAutomyndId: 'AM-883201',
    referralDate: '2026-06-01',
    referralSource: 'Physician',
    programType: 'EEOICPA',
    status: 'pending',
    physicianNpi: '1234567890',
  },
  {
    automyndId: 'REF-002',
    patientAutomyndId: 'AM-773100',
    referralDate: '2026-06-10',
    referralSource: 'VA Community Care',
    programType: 'VA',
    status: 'approved',
  },
];

export const FIXTURE_VISITS: AutomyndVisit[] = [
  {
    automyndId: 'VIS-001',
    patientAutomyndId: 'AM-883201',
    visitDate: '2026-06-15',
    visitType: 'SOC',
    clinicianId: 'CLN-001',
    status: 'completed',
    // notes intentionally omitted — clinical SoR is Automynd
  },
  {
    automyndId: 'VIS-002',
    patientAutomyndId: 'AM-773100',
    visitDate: '2026-06-20',
    visitType: 'Skilled Nursing',
    clinicianId: 'CLN-002',
    status: 'scheduled',
  },
];
