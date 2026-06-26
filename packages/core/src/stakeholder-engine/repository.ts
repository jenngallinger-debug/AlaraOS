/**
 * Alara OS — Stakeholder Engine Repository (M11)
 * Read/write layer for Stakeholder objects.
 * Follows M0–M10 pattern: DatabaseClient injection, typed row maps, no business logic.
 */

import { DatabaseClient } from '../shared/database';
import { AlaraId, makeAlaraId } from '../shared/types';
import {
  CommunicationCadence,
  CommunicationChannel,
  CommunicationCategory,
  CommunicationPreference,
  Stakeholder,
  StakeholderConsent,
  StakeholderConsentFact,
  StakeholderConsentStatus,
  StakeholderPromiseProfile,
  StakeholderType,
  isInternalStakeholder,
} from './types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface StakeholderRow {
  id: string;
  tenant_id: string;
  type: string;
  is_internal: boolean;
  display_name: string | null;
  organization_name: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  consent_status: string;
  consent_scope: string;
  consent_granted_at: string | null;
  consent_revoked_at: string | null;
  consent_expires_at: string | null;
  consent_granted_by: string | null;
  workforce_member_ref: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

interface PreferenceRow {
  stakeholder_id: string;
  tenant_id: string;
  category: string;
  channel: string;
  cadence: string;
  opt_in: boolean;
}

interface PromiseProfileRow {
  stakeholder_id: string;
  tenant_id: string;
  job_to_be_done: string | null;
  responsibility_transferred: string | null;
  success_definition: string | null;
  anxiety_risk: string | null;
  communication_promise: string | null;
  update_triggers: string[];
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

function rowToConsent(r: StakeholderRow): StakeholderConsent {
  return {
    status: r.consent_status as StakeholderConsentStatus,
    scope: r.consent_scope,
    grantedAt: r.consent_granted_at ? new Date(r.consent_granted_at) : null,
    revokedAt: r.consent_revoked_at ? new Date(r.consent_revoked_at) : null,
    expiresAt: r.consent_expires_at ? new Date(r.consent_expires_at) : null,
    grantedBy: r.consent_granted_by,
  };
}

function rowToPreference(r: PreferenceRow): CommunicationPreference {
  return {
    category: r.category as CommunicationCategory,
    channel: r.channel as CommunicationChannel,
    cadence: r.cadence as CommunicationCadence,
    optIn: r.opt_in,
  };
}

function rowToProfile(r: PromiseProfileRow): StakeholderPromiseProfile {
  return {
    jobToBeDone: r.job_to_be_done,
    responsibilityTransferred: r.responsibility_transferred,
    successDefinition: r.success_definition,
    anxietyRisk: r.anxiety_risk,
    communicationPromise: r.communication_promise,
    updateTriggers: r.update_triggers ?? [],
  };
}

function assembleStakeholder(
  row: StakeholderRow,
  prefs: PreferenceRow[],
  profile: PromiseProfileRow | null,
): Stakeholder {
  return {
    id: makeAlaraId(row.id),
    tenantId: row.tenant_id,
    type: row.type as StakeholderType,
    isInternal: row.is_internal,
    displayName: row.display_name,
    organizationName: row.organization_name,
    email: row.email,
    phone: row.phone,
    fax: row.fax,
    consent: rowToConsent(row),
    preferences: prefs.map(rowToPreference),
    promiseProfile: profile
      ? rowToProfile(profile)
      : {
          jobToBeDone: null,
          responsibilityTransferred: null,
          successDefinition: null,
          anxietyRisk: null,
          communicationPromise: null,
          updateTriggers: [],
        },
    active: row.active,
    workforceMemberRef: row.workforce_member_ref ? makeAlaraId(row.workforce_member_ref) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    version: row.version,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class StakeholderRepository {
  constructor(private readonly db: DatabaseClient) {}

  // ── Write ──────────────────────────────────────────────────────────────────

  async insert(
    s: Stakeholder,
    patientId: AlaraId,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO stakeholders (
        id, tenant_id, patient_id, type, is_internal,
        display_name, organization_name, email, phone, fax,
        consent_status, consent_scope,
        consent_granted_at, consent_revoked_at, consent_expires_at, consent_granted_by,
        workforce_member_ref, active, created_at, updated_at, version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        s.id, s.tenantId, patientId,
        s.type, s.isInternal,
        s.displayName, s.organizationName, s.email, s.phone, s.fax,
        s.consent.status, s.consent.scope,
        s.consent.grantedAt?.toISOString() ?? null,
        s.consent.revokedAt?.toISOString() ?? null,
        s.consent.expiresAt?.toISOString() ?? null,
        s.consent.grantedBy,
        s.workforceMemberRef ?? null,
        s.active,
        s.createdAt.toISOString(), s.updatedAt.toISOString(),
        s.version,
      ],
    );
  }

  async insertPreferences(
    stakeholderId: AlaraId,
    tenantId: string,
    prefs: readonly CommunicationPreference[],
  ): Promise<void> {
    for (const p of prefs) {
      await this.db.query(
        `INSERT INTO stakeholder_preferences
           (stakeholder_id, tenant_id, category, channel, cadence, opt_in)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (stakeholder_id, category) DO UPDATE
           SET channel=$4, cadence=$5, opt_in=$6`,
        [stakeholderId, tenantId, p.category, p.channel, p.cadence, p.optIn],
      );
    }
  }

  async insertPromiseProfile(
    stakeholderId: AlaraId,
    tenantId: string,
    profile: StakeholderPromiseProfile,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO stakeholder_promise_profiles
         (stakeholder_id, tenant_id, job_to_be_done, responsibility_transferred,
          success_definition, anxiety_risk, communication_promise, update_triggers)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (stakeholder_id) DO UPDATE
         SET job_to_be_done=$3, responsibility_transferred=$4,
             success_definition=$5, anxiety_risk=$6,
             communication_promise=$7, update_triggers=$8`,
      [
        stakeholderId, tenantId,
        profile.jobToBeDone, profile.responsibilityTransferred,
        profile.successDefinition, profile.anxietyRisk,
        profile.communicationPromise, profile.updateTriggers,
      ],
    );
  }

  async updateConsent(
    id: AlaraId,
    tenantId: string,
    status: StakeholderConsentStatus,
    scope: string,
    grantedAt: Date | null,
    revokedAt: Date | null,
    expiresAt: Date | null,
    grantedBy: string | null,
    now: Date,
    expectedVersion: number,
  ): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE stakeholders
          SET consent_status=$1, consent_scope=$2,
              consent_granted_at=$3, consent_revoked_at=$4, consent_expires_at=$5,
              consent_granted_by=$6, updated_at=$7, version=version+1
        WHERE id=$8 AND tenant_id=$9 AND version=$10
        RETURNING id`,
      [
        status, scope,
        grantedAt?.toISOString() ?? null,
        revokedAt?.toISOString() ?? null,
        expiresAt?.toISOString() ?? null,
        grantedBy,
        now.toISOString(), id, tenantId, expectedVersion,
      ],
    );
    if (rows.length === 0) {
      throw new Error(`Stakeholder ${id} not found or version conflict (expected ${expectedVersion})`);
    }
  }

  async setActive(
    id: AlaraId,
    tenantId: string,
    active: boolean,
    now: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE stakeholders SET active=$1, updated_at=$2, version=version+1
        WHERE id=$3 AND tenant_id=$4`,
      [active, now.toISOString(), id, tenantId],
    );
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async findById(id: AlaraId, tenantId: string): Promise<Stakeholder | null> {
    const rows = await this.db.query<StakeholderRow>(
      `SELECT * FROM stakeholders WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (!rows[0]) return null;
    const prefs = await this.db.query<PreferenceRow>(
      `SELECT * FROM stakeholder_preferences WHERE stakeholder_id=$1 AND tenant_id=$2 ORDER BY category`,
      [id, tenantId],
    );
    const profiles = await this.db.query<PromiseProfileRow>(
      `SELECT * FROM stakeholder_promise_profiles WHERE stakeholder_id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    return assembleStakeholder(rows[0], prefs, profiles[0] ?? null);
  }

  async listByPatient(
    patientId: AlaraId,
    tenantId: string,
  ): Promise<Stakeholder[]> {
    const rows = await this.db.query<StakeholderRow>(
      `SELECT s.* FROM stakeholders s
        WHERE s.patient_id=$1 AND s.tenant_id=$2 AND s.active=true
        ORDER BY s.is_internal DESC, s.type, s.created_at`,
      [patientId, tenantId],
    );
    const result: Stakeholder[] = [];
    for (const row of rows) {
      const id = makeAlaraId(row.id);
      const prefs = await this.db.query<PreferenceRow>(
        `SELECT * FROM stakeholder_preferences WHERE stakeholder_id=$1 AND tenant_id=$2 ORDER BY category`,
        [id, tenantId],
      );
      const profiles = await this.db.query<PromiseProfileRow>(
        `SELECT * FROM stakeholder_promise_profiles WHERE stakeholder_id=$1 AND tenant_id=$2`,
        [id, tenantId],
      );
      result.push(assembleStakeholder(row, prefs, profiles[0] ?? null));
    }
    return result;
  }

  async getConsentFact(
    id: AlaraId,
    tenantId: string,
    patientId: AlaraId,
  ): Promise<StakeholderConsentFact | null> {
    const rows = await this.db.query<{
      id: string; consent_status: string; consent_scope: string;
      consent_granted_at: string | null; consent_revoked_at: string | null; consent_expires_at: string | null;
    }>(
      `SELECT id, consent_status, consent_scope,
              consent_granted_at, consent_revoked_at, consent_expires_at
         FROM stakeholders WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      stakeholderId: r.id,
      patientId: patientId as string,
      consentStatus: r.consent_status as StakeholderConsentStatus,
      consentScope: r.consent_scope,
      grantedAt: r.consent_granted_at,
      revokedAt: r.consent_revoked_at,
      expiresAt: r.consent_expires_at,
    };
  }
}
