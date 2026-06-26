/**
 * Alara OS — Automynd Adapter Interface
 *
 * ADR-001: Automynd is the clinical System of Record.
 * AlaraOS is the Operational System of Intelligence.
 * AlaraOS never duplicates clinical documentation.
 *
 * The Adapter translates Automynd concepts into Alara events.
 * The downstream engines (Trigger, Rules, Workflow) never see Automynd
 * directly — they see Alara events with ExternalReference payloads.
 *
 * Implementation strategy:
 *   M0/M1: FixtureAutomyndAdapter — deterministic test data
 *   M6: RealAutomyndAdapter — poll/webhook integration
 *   The contract (IAutomyndAdapter) never changes between the two.
 */

// ─── Automynd domain types (their models, not ours) ───────────────────────────

export interface AutomyndPatient {
  readonly automyndId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly dob: string;         // YYYY-MM-DD
  readonly programType: string; // 'EEOICPA' | 'OWCP' | 'VA' | 'Medicare' | etc.
  readonly status: string;
  readonly referralDate?: string;
}

export interface AutomyndReferral {
  readonly automyndId: string;
  readonly patientAutomyndId: string;
  readonly referralDate: string;
  readonly referralSource: string;
  readonly programType: string;
  readonly status: string;
  readonly physicianNpi?: string;
}

export interface AutomyndVisit {
  readonly automyndId: string;
  readonly patientAutomyndId: string;
  readonly visitDate: string;
  readonly visitType: string;
  readonly clinicianId: string;
  readonly status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  readonly notes?: string;       // Never stored in AlaraOS — clinical SoR is Automynd
}

export interface AutomyndOrder {
  readonly automyndId: string;
  readonly patientAutomyndId: string;
  readonly orderDate: string;
  readonly orderType: string;
  readonly physicianNpi: string;
  readonly status: string;
}

// ─── Events the adapter emits (Alara event types) ─────────────────────────────

export interface AutomyndPatientObservedPayload {
  readonly automyndPatientId: string;
  readonly programType: string;
  readonly status: string;
  /** DOB for identity-check only — never stored as identity */
  readonly dobForReconciliation: string;
  readonly source: 'Automynd';
}

export interface AutomyndReferralObservedPayload {
  readonly automyndReferralId: string;
  readonly automyndPatientId: string;
  readonly referralDate: string;
  readonly referralSource: string;
  readonly programType: string;
  readonly status: string;
  readonly source: 'Automynd';
}

export interface AutomyndVisitObservedPayload {
  readonly automyndVisitId: string;
  readonly automyndPatientId: string;
  readonly visitDate: string;
  readonly visitType: string;
  readonly status: string;
  readonly source: 'Automynd';
  // NOTE: clinical visit notes are NOT included — ADR-001
}

export interface AutomyndOrderObservedPayload {
  readonly automyndOrderId: string;
  readonly automyndPatientId: string;
  readonly orderDate: string;
  readonly orderType: string;
  readonly status: string;
  readonly source: 'Automynd';
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface IAutomyndAdapter {
  /**
   * Emit an event when a patient is observed/updated in Automynd.
   * The downstream pipeline resolves or creates the Alara Patient object.
   */
  emitPatientObserved(patient: AutomyndPatient): Promise<AutomyndPatientObservedPayload>;

  /**
   * Emit an event when a referral arrives in Automynd.
   * Triggers the intake pipeline.
   */
  emitReferralObserved(referral: AutomyndReferral): Promise<AutomyndReferralObservedPayload>;

  /**
   * Emit an event when a visit is observed in Automynd.
   * AlaraOS tracks the visit's existence, not its clinical content.
   */
  emitVisitObserved(visit: AutomyndVisit): Promise<AutomyndVisitObservedPayload>;

  /**
   * Emit an event when an order is observed in Automynd.
   * AlaraOS tracks order existence + status; clinical content stays in Automynd.
   */
  emitOrderObserved(order: AutomyndOrder): Promise<AutomyndOrderObservedPayload>;

  /**
   * Check for data integrity conflicts between an Automynd record
   * and the current Alara object state. Returns conflict details if
   * a DataIntegrityFlagged event should be emitted.
   */
  checkDataIntegrity(
    automyndRecord: AutomyndPatient,
    alaraAttributes: Record<string, unknown>,
  ): DataIntegrityCheckResult;
}

export interface DataIntegrityCheckResult {
  readonly hasConflict: boolean;
  readonly conflictType?: string;
  readonly conflictDetails?: Record<string, unknown>;
}
