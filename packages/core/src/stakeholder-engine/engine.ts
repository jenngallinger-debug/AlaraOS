/**
 * Alara OS — Stakeholder Engine (M11)
 *
 * Operations:
 *   createStakeholder   — register a Stakeholder on a Patient; auto-seeds
 *                         promise profile and default preference
 *   updateConsent       — record durable consent state (the canonical source
 *                         that ConsentPolicyModule reads via getConsentFact)
 *   updatePreferences   — update communication channel/cadence preferences
 *   deactivate          — soft-deactivate (preserves history)
 *   getConsentFact      — project durable consent into ConsentFact shape
 *                         for the Rules Engine's ConsentPolicyModule
 *
 * Invariants:
 *   - Every mutation writes an event to the platform EventStore
 *   - Stakeholder references Patient; it never owns the Patient record
 *   - Internal / external classification is set at creation from type;
 *     it is not changeable (type is identity, not state)
 *   - Consent changes emit StakeholderConsentChanged event regardless of
 *     prior state, to preserve full consent audit trail
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { StakeholderRepository } from './repository';
import { getDefaults } from './defaults';
import {
  CommunicationPreference,
  CreateStakeholderCommand,
  CreateStakeholderResult,
  DeactivateStakeholderCommand,
  InvalidStakeholderTypeError,
  Stakeholder,
  StakeholderConsentFact,
  StakeholderConsentStatus,
  StakeholderNotFoundError,
  StakeholderType,
  UpdateConsentCommand,
  UpdatePreferencesCommand,
  isInternalStakeholder,
} from './types';

const VALID_TYPES: readonly StakeholderType[] = [
  'patient', 'family', 'physician', 'case_manager', 'discharge_planner',
  'dol_resource_center', 'attorney', 'authorized_rep', 'owcp_nurse_cm',
  'employer_feca', 'care_guide', 'auth_specialist', 'don',
];

function assertValidType(type: string): asserts type is StakeholderType {
  if (!(VALID_TYPES as string[]).includes(type)) {
    throw new InvalidStakeholderTypeError(type);
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class StakeholderEngine {
  private readonly repo: StakeholderRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
  ) {
    this.repo = new StakeholderRepository(db);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createStakeholder(
    cmd: CreateStakeholderCommand,
  ): Promise<CreateStakeholderResult> {
    assertValidType(cmd.type);

    const defaults = getDefaults(cmd.type);
    const now = new Date();
    const id = newAlaraId();
    const internal = isInternalStakeholder(cmd.type);

    const consentStatus: StakeholderConsentStatus = cmd.consentStatus ?? 'unknown';
    const consentScope = cmd.consentScope ?? 'status';

    const stakeholder: Stakeholder = {
      id,
      tenantId: cmd.tenantId,
      type: cmd.type,
      isInternal: internal,
      displayName: cmd.displayName ?? null,
      organizationName: cmd.organizationName ?? null,
      email: cmd.email ?? null,
      phone: cmd.phone ?? null,
      fax: cmd.fax ?? null,
      consent: {
        status: consentStatus,
        scope: consentScope,
        grantedAt: consentStatus === 'granted' ? now : null,
        revokedAt: null,
        expiresAt: null,
        grantedBy: consentStatus === 'granted' ? cmd.actor : null,
      },
      preferences: [
        {
          category: 'all',
          channel: cmd.preferredChannel ?? defaults.preferredChannel,
          cadence: cmd.preferredCadence ?? defaults.preferredCadence,
          optIn: true,
        },
      ],
      promiseProfile: defaults.profile,
      active: true,
      workforceMemberRef: cmd.workforceMemberRef ?? null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    await this.repo.insert(stakeholder, cmd.patientId);
    await this.repo.insertPreferences(id, cmd.tenantId, stakeholder.preferences);
    await this.repo.insertPromiseProfile(id, cmd.tenantId, stakeholder.promiseProfile);

    await this.eventStore.append({
      tenantId: cmd.tenantId,
      streamId: id,
      type: 'StakeholderCreated' as EventType,
      payload: {
        stakeholderId: id,
        patientId: cmd.patientId,
        type: cmd.type,
        isInternal: internal,
        consentStatus,
      },
      actor: cmd.actor,
    });

    return { stakeholder, patientId: cmd.patientId };
  }

  // ── Update consent ────────────────────────────────────────────────────────

  async updateConsent(cmd: UpdateConsentCommand): Promise<void> {
    const existing = await this.repo.findById(cmd.stakeholderId, cmd.tenantId);
    if (!existing) throw new StakeholderNotFoundError(cmd.stakeholderId);

    const now = new Date();
    const grantedAt = cmd.status === 'granted' ? now : existing.consent.grantedAt;
    const revokedAt = cmd.status === 'revoked' ? now : null;

    await this.repo.updateConsent(
      cmd.stakeholderId,
      cmd.tenantId,
      cmd.status,
      cmd.scope ?? existing.consent.scope,
      grantedAt,
      revokedAt,
      cmd.expiresAt ?? null,
      cmd.actor,
      now,
      existing.version,
    );

    await this.eventStore.append({
      tenantId: cmd.tenantId,
      streamId: cmd.stakeholderId,
      type: 'StakeholderConsentChanged' as EventType,
      payload: {
        stakeholderId: cmd.stakeholderId,
        from: existing.consent.status,
        to: cmd.status,
        scope: cmd.scope ?? existing.consent.scope,
      },
      actor: cmd.actor,
    });
  }

  // ── Update preferences ────────────────────────────────────────────────────

  async updatePreferences(cmd: UpdatePreferencesCommand): Promise<void> {
    const existing = await this.repo.findById(cmd.stakeholderId, cmd.tenantId);
    if (!existing) throw new StakeholderNotFoundError(cmd.stakeholderId);

    await this.repo.insertPreferences(cmd.stakeholderId, cmd.tenantId, cmd.preferences);

    await this.eventStore.append({
      tenantId: cmd.tenantId,
      streamId: cmd.stakeholderId,
      type: 'StakeholderPreferencesUpdated' as EventType,
      payload: {
        stakeholderId: cmd.stakeholderId,
        categories: cmd.preferences.map(p => p.category),
      },
      actor: cmd.actor,
    });
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  async deactivate(cmd: DeactivateStakeholderCommand): Promise<void> {
    const existing = await this.repo.findById(cmd.stakeholderId, cmd.tenantId);
    if (!existing) throw new StakeholderNotFoundError(cmd.stakeholderId);

    const now = new Date();
    await this.repo.setActive(cmd.stakeholderId, cmd.tenantId, false, now);

    await this.eventStore.append({
      tenantId: cmd.tenantId,
      streamId: cmd.stakeholderId,
      type: 'StakeholderDeactivated' as EventType,
      payload: { stakeholderId: cmd.stakeholderId },
      actor: cmd.actor,
    });
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getById(id: AlaraId, tenantId: string): Promise<Stakeholder | null> {
    return this.repo.findById(id, tenantId);
  }

  async listByPatient(patientId: AlaraId, tenantId: string): Promise<Stakeholder[]> {
    return this.repo.listByPatient(patientId, tenantId);
  }

  /**
   * Project Stakeholder's durable consent into ConsentFact shape.
   * ConsentPolicyModule reads this to evaluate consent rules.
   * Convergence point ratified by Architect: Stakeholder owns consent;
   * Rules Engine reads the projection.
   */
  async getConsentFact(
    stakeholderId: AlaraId,
    patientId: AlaraId,
    tenantId: string,
  ): Promise<StakeholderConsentFact | null> {
    return this.repo.getConsentFact(stakeholderId, tenantId, patientId);
  }
}
