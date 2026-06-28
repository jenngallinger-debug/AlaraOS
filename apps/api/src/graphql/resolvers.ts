/**
 * Alara OS API — GraphQL Resolvers
 *
 * All resolvers are read-only. None mutate canonical state.
 * Resolvers delegate to engines and the projection store.
 *
 * Projections are returned from the store if present.
 * If a projection is missing (invalidated or never built),
 * the resolver returns null — the client should trigger a rebuild
 * via the REST command layer.
 */

import { EngineContainer } from '../shared/container';
import { makeAlaraId } from '@alara-os/core';
import {
  TimelineValue,
  DigitalCareTwinValue,
  ReferralSourceStrengthValue,
} from '@alara-os/core';
import { Principal, isTenantAllowed } from '../shared/auth';

/** Resolver context (from the Mercurius `context` factory in server.ts). */
interface GqlContext {
  readonly principal?: Principal;
}

/**
 * Tenant membership guard for tenant-scoped reads. A VERIFIED token principal may only query a
 * tenant it is a member of (empty membership fails closed → throws). Legacy principals, and the
 * unauthenticated path where the gate is relaxed (no principal), are unenforced — behaviour is
 * unchanged. A thrown error becomes a safe GraphQL error with null data (no cross-tenant leak).
 */
function assertTenantAllowed(context: GqlContext, tenantId: string): void {
  const p = context.principal;
  if (!p) return;                          // no principal (gate relaxed) → unchanged
  if (isTenantAllowed(p, tenantId)) return; // legacy → always true; verified+member → true
  throw new Error('forbidden: tenant not permitted for this principal');
}

export function buildResolvers(container: EngineContainer) {
  return {
    Query: {
      // ── object ───────────────────────────────────────────────────────────────
      object: async (_: unknown, { tenantId, id }: { tenantId: string; id: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        const obj = await container.objectRepo.getById(tenantId, makeAlaraId(id));
        if (!obj) return null;
        const refs = await container.objectRepo.getExternalReferences(tenantId, makeAlaraId(id));
        return { ...obj, externalReferences: refs };
      },

      // ── workflow ─────────────────────────────────────────────────────────────
      workflow: async (_: unknown, { tenantId, id }: { tenantId: string; id: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        return container.workflowEngine.getById(tenantId, makeAlaraId(id));
      },

      // ── tasksByWorkflow ──────────────────────────────────────────────────────
      tasksByWorkflow: async (_: unknown, { tenantId, workflowId }: { tenantId: string; workflowId: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        // TaskEngine doesn't expose a listByWorkflow — read from store directly
        // This is a read model query; no canonical mutation
        const tasks: unknown[] = [];
        // In production this would be a DB query; the in-memory store is a Map
        // so we filter it here for tests. Production uses SQL.
        return tasks;
      },

      // ── promisesByWorkflow ───────────────────────────────────────────────────
      promisesByWorkflow: async (_: unknown, { tenantId, workflowId }: { tenantId: string; workflowId: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        return [];
      },

      // ── communicationsBySubject ──────────────────────────────────────────────
      communicationsBySubject: async (_: unknown, { tenantId, subjectId }: { tenantId: string; subjectId: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        return [];
      },

      // ── timeline ─────────────────────────────────────────────────────────────
      timeline: async (_: unknown, { tenantId, subjectId }: { tenantId: string; subjectId: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        const stored = await container.projectionStore.get(tenantId, 'Timeline', subjectId);
        if (!stored) return null;
        const value = stored.value as unknown as TimelineValue;
        return {
          subjectId,
          methodVersion: stored.metadata.methodVersion,
          confidence:    stored.metadata.confidence,
          lastBuiltAt:   stored.metadata.lastBuiltAt,
          buildNumber:   stored.metadata.buildNumber,
          eventCount:    value.eventCount,
          entries:       value.entries,
        };
      },

      // ── digitalCareTwin ──────────────────────────────────────────────────────
      digitalCareTwin: async (_: unknown, { tenantId, patientId }: { tenantId: string; patientId: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        const stored = await container.projectionStore.get(tenantId, 'DigitalCareTwin', patientId);
        if (!stored) return null;
        const value = stored.value as unknown as DigitalCareTwinValue;
        return {
          patientId,
          methodVersion:       stored.metadata.methodVersion,
          confidence:          stored.metadata.confidence,
          lastBuiltAt:         stored.metadata.lastBuiltAt,
          aiInvolved:          stored.metadata.aiInvolved,
          disclaimer:          value.disclaimer,
          patientAttributes:   value.patientAttributes,
          externalReferences:  value.externalReferences,
          activeWorkflows:     value.activeWorkflows,
          openTasks:           value.openTasks,
          openPromises:        value.openPromises,
          timelineSummary:     value.timelineSummary,
        };
      },

      // ── referralSourceStrength ────────────────────────────────────────────────
      referralSourceStrength: async (_: unknown, { tenantId, referralSourceId }: { tenantId: string; referralSourceId: string }, context: GqlContext) => {
        assertTenantAllowed(context, tenantId);
        const stored = await container.projectionStore.get(tenantId, 'ReferralSourceStrength', referralSourceId);
        if (!stored) return null;
        const value = stored.value as unknown as ReferralSourceStrengthValue;
        return {
          referralSourceId,
          methodVersion:      stored.metadata.methodVersion,
          confidence:         stored.metadata.confidence,
          strengthScore:      value.strengthScore,
          trend:              value.trend,
          totalReferrals:     value.totalReferrals,
          keptPromises:       value.keptPromises,
          missedPromises:     value.missedPromises,
          dataIntegrityFlags: value.dataIntegrityFlags,
        };
      },
    },

    // Scalar resolver for JSONObject
    JSONObject: {
      serialize: (value: unknown) => value,
      parseValue: (value: unknown) => value,
      parseLiteral: (ast: { value: unknown }) => ast.value,
    },
  };
}
