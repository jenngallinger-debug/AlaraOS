/**
 * Alara OS — Journey Engine (M10.5)
 *
 * All lifecycle operations are event-sourced.
 * Journey Invariant: every method only modifies owned state
 * (intent, lifecycle, coordination state, event stream) or creates
 * reference edges. No method touches another Object's internal state.
 */

import crypto from 'crypto';
import { DatabaseClient } from '../shared/database';
import { makeAlaraId } from '../shared/types';
import { newAlaraId, newEventId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { JourneyRepository } from './repository';
import {
  canTransition,
  CapabilityToken,
  HumanHandoff,
  InvalidLifecycleTransitionError,
  Journey,
  JourneyCoordinationState,
  JourneyEvent,
  JourneyEventType,
  JourneyLifecycle,
  JourneyNotFoundError,
  JourneyProjection,
  JourneyReference,
  JourneyReferenceKind,
  NextStep,
} from './types';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface StartJourneyResult {
  readonly journey: Journey;
  readonly token: string;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class JourneyEngine {
  private readonly repo: JourneyRepository;

  constructor(db: DatabaseClient) {
    this.repo = new JourneyRepository(db);
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  async start(
    tenantId: string,
    seedContext: Record<string, unknown> = {},
  ): Promise<StartJourneyResult> {
    const now = new Date();
    const journey: Journey = {
      id: newAlaraId(),
      tenantId,
      intent: null,
      intentInferredAt: null,
      lifecycle: 'arrival',
      lifecycleChangedAt: now,
      coordinationState: { ...seedContext } as JourneyCoordinationState,
      identityResolved: false,
      mergedFrom: [],
      splitFrom: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.insert(journey);
    await this.repo.appendEvent(makeEvt({
      journeyId: journey.id,
      tenantId,
      eventType: 'JourneyStarted',
      payload: { seedContext },
    }));
    const token = crypto.randomBytes(32).toString('base64url');
    await this.repo.storeToken(token, journey.id, tenantId, null, now);
    await this._refreshProjection(journey.id, tenantId);
    return { journey, token };
  }

  // ── Lifecycle transitions ──────────────────────────────────────────────────

  async orient(journeyId: AlaraId, tenantId: string): Promise<void> {
    await this._transition(journeyId, tenantId, 'orientation', 'JourneyOriented', {});
  }

  async beginWork(
    journeyId: AlaraId, tenantId: string, workKind = 'intake',
  ): Promise<void> {
    await this._transition(
      journeyId, tenantId, 'working', 'JourneyWorkStarted', { workKind },
    );
  }

  async suspend(journeyId: AlaraId, tenantId: string): Promise<void> {
    const j = await this._require(journeyId, tenantId);
    const state = { ...j.coordinationState, suspended: true };
    await this.repo.updateCoordinationState(journeyId, tenantId, state, new Date());
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'JourneySuspended', payload: {},
    }));
    await this._refreshProjection(journeyId, tenantId);
  }

  async resume(journeyId: AlaraId, tenantId: string): Promise<void> {
    const j = await this._require(journeyId, tenantId);
    const state = { ...j.coordinationState, suspended: false };
    await this.repo.updateCoordinationState(journeyId, tenantId, state, new Date());
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'JourneyResumed', payload: {},
    }));
    await this._refreshProjection(journeyId, tenantId);
  }

  async goDormant(journeyId: AlaraId, tenantId: string): Promise<void> {
    await this._transition(journeyId, tenantId, 'dormant', 'JourneyWentDormant', {});
  }

  async reactivate(journeyId: AlaraId, tenantId: string): Promise<void> {
    await this._transition(journeyId, tenantId, 'reactivated', 'JourneyReactivated', {});
  }

  async complete(
    journeyId: AlaraId, tenantId: string, reason = 'fulfilled',
  ): Promise<void> {
    await this._transition(
      journeyId, tenantId, 'completed', 'JourneyCompleted', { reason },
    );
  }

  async archive(journeyId: AlaraId, tenantId: string): Promise<void> {
    await this._transition(journeyId, tenantId, 'archived', 'JourneyArchived', {});
  }

  // ── Intent & coordination state ────────────────────────────────────────────

  async inferIntent(
    journeyId: AlaraId,
    tenantId: string,
    intent: string,
    reasoningRefId?: AlaraId,
  ): Promise<void> {
    await this._require(journeyId, tenantId);
    const now = new Date();
    await this.repo.updateIntent(journeyId, tenantId, intent, now);
    if (reasoningRefId) {
      await this._addReference(journeyId, tenantId, 'reasoning', reasoningRefId, null);
    }
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'JourneyIntentInferred',
      payload: { intent },
      refKind: reasoningRefId ? 'reasoning' : null,
      refId: reasoningRefId ?? null,
    }));
    await this._refreshProjection(journeyId, tenantId);
  }

  async surfaceObstacle(
    journeyId: AlaraId, tenantId: string, obstacle: string,
  ): Promise<void> {
    const j = await this._require(journeyId, tenantId);
    const state = { ...j.coordinationState, obstacle };
    await this.repo.updateCoordinationState(journeyId, tenantId, state, new Date());
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'JourneyObstacleSurfaced', payload: { obstacle },
    }));
    await this._refreshProjection(journeyId, tenantId);
  }

  async setActor(
    journeyId: AlaraId, tenantId: string, actor: string,
  ): Promise<void> {
    const j = await this._require(journeyId, tenantId);
    const state = { ...j.coordinationState, actor };
    await this.repo.updateCoordinationState(journeyId, tenantId, state, new Date());
    await this._refreshProjection(journeyId, tenantId);
  }

  async setNextStep(
    journeyId: AlaraId,
    tenantId: string,
    nextStep: NextStep,
  ): Promise<void> {
    const j = await this._require(journeyId, tenantId);
    const state = { ...j.coordinationState, nextStep };
    await this.repo.updateCoordinationState(journeyId, tenantId, state, new Date());
    await this._refreshProjection(journeyId, tenantId);
  }

  async recordQuestionAnswered(
    journeyId: AlaraId, tenantId: string, knowledgeEntryId: AlaraId,
  ): Promise<void> {
    await this._require(journeyId, tenantId);
    await this._addReference(journeyId, tenantId, 'knowledge_entry', knowledgeEntryId, null);
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'JourneyQuestionAnswered',
      payload: { knowledgeEntryId },
      refKind: 'knowledge_entry', refId: knowledgeEntryId,
    }));
    await this._refreshProjection(journeyId, tenantId);
  }

  // ── Identity resolution ────────────────────────────────────────────────────

  async resolveIdentity(
    journeyId: AlaraId,
    tenantId: string,
    personId: AlaraId,
    role = 'patient',
  ): Promise<void> {
    /**
     * Link an existing Person to the Journey.
     * OD-1: Journey NEVER creates a Person. personId must refer to a Person
     * that already exists in the Person domain. Journey only adds a reference.
     */
    await this._require(journeyId, tenantId);
    await this._addReference(journeyId, tenantId, 'person', personId, role);
    const now = new Date();
    await this.repo.markIdentityResolved(journeyId, tenantId, now);
    const identEvt = makeEvt({
      journeyId, tenantId, eventType: 'JourneyIdentityResolved',
      payload: { personId, role },
      refKind: 'person', refId: personId,
    });
    await this.repo.appendEvent(identEvt);
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'PersonLinkedToJourney',
      payload: { personId, role },
      refKind: 'person', refId: personId,
      causedBy: identEvt.id,
    }));
    // Advance lifecycle if currently 'working' (optional)
    const j = await this.repo.findById(journeyId, tenantId);
    if (j && canTransition(j.lifecycle, 'identity_resolution')) {
      await this.repo.updateLifecycle(journeyId, tenantId, 'identity_resolution', now);
    }
    await this._refreshProjection(journeyId, tenantId);
  }

  // ── Handoff ───────────────────────────────────────────────────────────────

  async initiateHandoff(
    journeyId: AlaraId,
    tenantId: string,
    workforceMemberId: AlaraId,
    handoff: HumanHandoff,
  ): Promise<void> {
    /**
     * Reference the Workforce Member assuming responsibility.
     * Journey Invariant: does not absorb WM identity or permissions (ADR-014).
     */
    await this._require(journeyId, tenantId);
    await this._addReference(journeyId, tenantId, 'workforce_member', workforceMemberId, 'care_coordinator');
    const j = await this._require(journeyId, tenantId);
    const state: JourneyCoordinationState = {
      ...j.coordinationState,
      humanHandoff: {
        name: handoff.name,
        role: handoff.role,
        contextTransferred: handoff.contextTransferred,
        workforceMemberId,
      },
    };
    await this.repo.updateCoordinationState(journeyId, tenantId, state, new Date());
    const handoffEvt = makeEvt({
      journeyId, tenantId, eventType: 'JourneyHandoffInitiated',
      payload: { workforceMemberId, name: handoff.name, role: handoff.role,
                  contextTransferred: handoff.contextTransferred },
      refKind: 'workforce_member', refId: workforceMemberId,
    });
    await this.repo.appendEvent(handoffEvt);
    await this.repo.appendEvent(makeEvt({
      journeyId, tenantId, eventType: 'WorkforceMemberLinkedToJourney',
      payload: { workforceMemberId },
      refKind: 'workforce_member', refId: workforceMemberId,
      causedBy: handoffEvt.id,
    }));
    await this._refreshProjection(journeyId, tenantId);
  }

  // ── Episode link ──────────────────────────────────────────────────────────

  async linkEpisode(
    journeyId: AlaraId, tenantId: string, episodeId: AlaraId,
  ): Promise<void> {
    /**
     * Reference an Episode downstream of this Journey.
     * BD-013: Journey is upstream; it references/spawns Episodes and
     * never becomes or absorbs one.
     */
    await this._require(journeyId, tenantId);
    await this._addReference(journeyId, tenantId, 'episode', episodeId, null);
    const epEvt = makeEvt({
      journeyId, tenantId, eventType: 'EpisodeLinkedToJourney',
      payload: { episodeId },
      refKind: 'episode', refId: episodeId,
    });
    await this.repo.appendEvent(epEvt);
    await this._refreshProjection(journeyId, tenantId);
  }

  // ── Merge ─────────────────────────────────────────────────────────────────

  async merge(
    primaryId: AlaraId, secondaryId: AlaraId, tenantId: string,
  ): Promise<void> {
    const primary = await this._require(primaryId, tenantId);
    await this._require(secondaryId, tenantId);
    const now = new Date();

    // Transfer all references from secondary → primary (idempotent)
    const secRefs = await this.repo.getReferences(secondaryId, tenantId);
    for (const ref of secRefs) {
      await this.repo.insertReference({
        id: newAlaraId(),
        journeyId: primaryId,
        tenantId,
        kind: ref.kind,
        refId: ref.refId,
        role: ref.role,
        linkedAt: ref.linkedAt,
        linkedBy: ref.linkedBy,
        meta: ref.meta,
      });
    }

    // Provenance on primary (first-class repo method — no execute_raw)
    const mergedFrom = [...primary.mergedFrom, secondaryId];
    await this.repo.updateMergedFrom(primaryId, tenantId, mergedFrom, now);

    // Archive secondary
    await this.repo.updateLifecycle(secondaryId, tenantId, 'archived', now);
    const archivedEvt = makeEvt({
      journeyId: secondaryId, tenantId, eventType: 'JourneyArchived',
      payload: { reason: 'merged_into', primaryId },
    });
    await this.repo.appendEvent(archivedEvt);
    await this.repo.appendEvent(makeEvt({
      journeyId: primaryId, tenantId, eventType: 'JourneyMerged',
      payload: { mergedFrom: secondaryId },
      causedBy: archivedEvt.id,
    }));
    await this._refreshProjection(primaryId, tenantId);
    await this._refreshProjection(secondaryId, tenantId);
  }

  // ── Split ─────────────────────────────────────────────────────────────────

  async split(
    parentId: AlaraId,
    tenantId: string,
    childIntent: string,
    refsForChild: Array<{ kind: JourneyReferenceKind; refId: AlaraId; role: string | null }>,
  ): Promise<Journey> {
    /** Requires explicit signal (ADR-015: split is never inferred alone). */
    await this._require(parentId, tenantId);
    const now = new Date();
    const child: Journey = {
      id: newAlaraId(),
      tenantId,
      intent: childIntent,
      intentInferredAt: now,
      lifecycle: 'working',
      lifecycleChangedAt: now,
      coordinationState: { splitFrom: parentId } as JourneyCoordinationState,
      identityResolved: false,
      mergedFrom: [],
      splitFrom: parentId,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.insert(child);
    const startedEvt = makeEvt({
      journeyId: child.id, tenantId, eventType: 'JourneyStarted',
      payload: { splitFrom: parentId },
    });
    await this.repo.appendEvent(startedEvt);
    for (const { kind, refId, role } of refsForChild) {
      await this._addReference(child.id, tenantId, kind, refId, role);
    }
    await this.repo.appendEvent(makeEvt({
      journeyId: parentId, tenantId, eventType: 'JourneySplit',
      payload: { childId: child.id, childIntent },
      causedBy: startedEvt.id,
    }));
    await this._refreshProjection(child.id, tenantId);
    return child;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getProjection(
    journeyId: AlaraId, tenantId: string,
  ): Promise<JourneyProjection | null> {
    return this.repo.getProjection(journeyId, tenantId);
  }

  async getEvents(
    journeyId: AlaraId, tenantId: string, afterId?: string,
  ): Promise<JourneyEvent[]> {
    return this.repo.getEvents(journeyId, tenantId, afterId);
  }

  async getReferences(
    journeyId: AlaraId, tenantId: string, kind?: JourneyReferenceKind,
  ): Promise<JourneyReference[]> {
    return this.repo.getReferences(journeyId, tenantId, kind);
  }

  async validateToken(token: string, tenantId: string): Promise<AlaraId | null> {
    return this.repo.resolveToken(token, tenantId);
  }

  async revokeToken(token: string, tenantId: string): Promise<void> {
    await this.repo.revokeToken(token, tenantId, new Date());
  }

  async findJourneysFor(
    kind: JourneyReferenceKind, refId: AlaraId, tenantId: string,
  ): Promise<AlaraId[]> {
    return this.repo.findJourneysReferencing(kind, refId, tenantId);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async _require(journeyId: AlaraId, tenantId: string): Promise<Journey> {
    const j = await this.repo.findById(journeyId, tenantId);
    if (!j) throw new JourneyNotFoundError(journeyId);
    return j;
  }

  private async _transition(
    journeyId: AlaraId,
    tenantId: string,
    target: JourneyLifecycle,
    eventType: JourneyEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const j = await this._require(journeyId, tenantId);
    if (!canTransition(j.lifecycle, target)) {
      throw new InvalidLifecycleTransitionError(j.lifecycle, target);
    }
    const now = new Date();
    await this.repo.updateLifecycle(journeyId, tenantId, target, now);
    await this.repo.appendEvent(makeEvt({ journeyId, tenantId, eventType, payload }));
    await this._refreshProjection(journeyId, tenantId);
  }

  private async _addReference(
    journeyId: AlaraId,
    tenantId: string,
    kind: JourneyReferenceKind,
    refId: AlaraId,
    role: string | null,
  ): Promise<void> {
    await this.repo.insertReference({
      id: newAlaraId(),
      journeyId,
      tenantId,
      kind,
      refId,
      role,
      linkedAt: new Date(),
      linkedBy: null,
      meta: {},
    });
  }

  private async _refreshProjection(
    journeyId: AlaraId, tenantId: string,
  ): Promise<void> {
    const j = await this.repo.findById(journeyId, tenantId);
    if (!j) return;
    const events = await this.repo.getEvents(journeyId, tenantId);
    const last = events[events.length - 1] ?? null;
    const cs = j.coordinationState;
    const handoff = cs.humanHandoff
      ? {
          name: cs.humanHandoff.name,
          role: cs.humanHandoff.role,
          contextTransferred: cs.humanHandoff.contextTransferred,
          workforceMemberId: cs.humanHandoff.workforceMemberId as AlaraId | undefined,
        }
      : null;
    const nextStep = cs.nextStep
      ? { label: cs.nextStep.label, owner: cs.nextStep.owner, honestWindow: cs.nextStep.honestWindow }
      : null;
    await this.repo.upsertProjection({
      PROJECTION_TYPE: 'journey_state',
      journeyId,
      tenantId,
      lifecycle: j.lifecycle,
      intent: j.intent,
      obstacle: cs.obstacle ?? null,
      actor: cs.actor ?? null,
      workSummary: [],
      nextStep,
      humanHandoff: handoff,
      lastEventId: last?.id ?? null,
      projectedAt: new Date(),
    });
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeEvt(params: {
  journeyId: AlaraId;
  tenantId: string;
  eventType: JourneyEventType;
  payload: Record<string, unknown>;
  refKind?: JourneyReferenceKind | null;
  refId?: AlaraId | null;
  causedBy?: string | null;
}): JourneyEvent {
  return {
    id: newEventId(),   // UUIDv7 per OD-S2-2
    journeyId: params.journeyId,
    tenantId: params.tenantId,
    eventType: params.eventType,
    payload: params.payload,
    refKind: params.refKind ?? null,
    refId: params.refId ?? null,
    occurredAt: new Date(),
    causedBy: params.causedBy ?? null,
  };
}
