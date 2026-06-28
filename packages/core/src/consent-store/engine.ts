/**
 * Alara OS — Consent Engine (issuance / lifecycle)
 *
 * The canonical path to grant, revoke, and expire consent as `Consent` objects
 * in the Reality Graph. It reuses the existing object+event write pattern
 * (ObjectCommandHandler → ObjectCreated / ObjectUpdated, atomic and event-sourced)
 * and the existing ConsentFact fields (status / revokedAt / expirationDate /
 * permissionTypes / recipientId). No new Consent model, no new event types.
 *
 * This module only CREATES / CHANGES canonical consent state. Authorization
 * decisions remain with the ConsentPolicyModule / RetrievalPermissionGate, which
 * read this state via ConsentRepository + GraphConsentFactSource. The Permission
 * Gate is unchanged.
 */

import { DatabaseClient } from '../shared/database';
import { AlaraId } from '../shared/types';
import { ObjectCommandHandler } from '../object-graph/command-handler';
import { ObjectGraphRepository } from '../object-graph/repository';
import { ConsentPermissionType } from '../rules-engine/policies/context-types';

const CONSENT_TYPE = 'Consent';

export interface GrantConsentCommand {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly grantorId: string;
  /** The actor permitted to act under this consent (or '*'). */
  readonly recipientId: string;
  readonly permissionTypes: readonly ConsentPermissionType[];
  /** ISO date; defaults to today. */
  readonly effectiveDate?: string;
  /** ISO date; absent = no expiry. */
  readonly expirationDate?: string;
  readonly actor: string;
}

export interface ConsentChangeCommand {
  readonly tenantId: string;
  readonly consentId: AlaraId;
  readonly actor: string;
}

export interface ConsentMutationResult {
  readonly consentId: AlaraId;
  readonly version: number;
  /** The mutation's event id, or '' on an idempotent no-op (no new event was appended). */
  readonly eventId: string;
  /** True when the consent already held the target status, so no ObjectUpdated was appended. */
  readonly idempotentReplay?: boolean;
}

export class ConsentNotFoundError extends Error {
  constructor(id: string) {
    super(`Consent not found: ${id}`);
    this.name = 'ConsentNotFoundError';
  }
}

export class ConsentEngine {
  private readonly handler: ObjectCommandHandler;
  private readonly repo: ObjectGraphRepository;

  constructor(db: DatabaseClient) {
    this.repo = new ObjectGraphRepository(db);
    this.handler = new ObjectCommandHandler(db, this.repo);
  }

  /** Grant consent — creates an active Consent object (ObjectCreated). */
  async grant(cmd: GrantConsentCommand): Promise<ConsentMutationResult> {
    const attributes: Record<string, unknown> = {
      subjectId: cmd.subjectId,
      grantorId: cmd.grantorId,
      recipientId: cmd.recipientId,
      permissionTypes: cmd.permissionTypes,
      effectiveDate: cmd.effectiveDate ?? new Date().toISOString().slice(0, 10),
      status: 'active',
    };
    if (cmd.expirationDate) attributes['expirationDate'] = cmd.expirationDate;

    const { object, eventId } = await this.handler.createObject({
      tenantId: cmd.tenantId,
      type: CONSENT_TYPE,
      state: 'active',
      attributes,
      actor: cmd.actor,
    });
    return { consentId: object.id, version: object.version, eventId };
  }

  /** Revoke consent — version-gated update to status=revoked (ObjectUpdated). */
  async revoke(cmd: ConsentChangeCommand): Promise<ConsentMutationResult> {
    return this.transition(cmd, { status: 'revoked', revokedAt: new Date().toISOString() });
  }

  /** Expire consent — version-gated update to status=expired (ObjectUpdated). */
  async expire(cmd: ConsentChangeCommand): Promise<ConsentMutationResult> {
    return this.transition(cmd, { status: 'expired' });
  }

  private async transition(
    cmd: ConsentChangeCommand,
    changes: Record<string, unknown>,
  ): Promise<ConsentMutationResult> {
    const current = await this.repo.getById(cmd.tenantId, cmd.consentId);
    if (!current || current.type !== CONSENT_TYPE) {
      throw new ConsentNotFoundError(cmd.consentId);
    }
    // Idempotency: if the consent already holds the target status, the transition is a no-op.
    // Return the current state WITHOUT appending a redundant ObjectUpdated (a repeated withdraw
    // of an already-revoked consent must not keep re-writing status/revokedAt). Only the exact
    // same-status repeat short-circuits; a transition to a DIFFERENT status still proceeds.
    const targetStatus = changes.status;
    if (targetStatus !== undefined && current.attributes.status === targetStatus) {
      return { consentId: current.id, version: current.version, eventId: '', idempotentReplay: true };
    }
    const { object, eventId } = await this.handler.updateObject({
      tenantId: cmd.tenantId,
      id: cmd.consentId,
      changes,
      expectedVersion: current.version,
      actor: cmd.actor,
    });
    return { consentId: object.id, version: object.version, eventId };
  }
}
