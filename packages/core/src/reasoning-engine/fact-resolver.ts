/**
 * Alara OS — Authorization Fact Resolver (for read authorization)
 *
 * Resolves consent / participation / AI-act FACTS for an (actor, subject,
 * intended AI use) from canonical state, so the read-boundary adapters can gate
 * a record on resolved facts instead of only manually-attached ones. Absence of
 * a required fact must NOT become implicit permission — the resolver returns the
 * fact it can resolve (or none); the boundary marks which kinds are required and
 * the Permission Gate / policy adapters fail closed on a required-but-missing fact.
 *
 * The resolver RESOLVES FACTS ONLY. It never decides authorization — that stays
 * with the Permission Gate / RulesEngine. It reuses existing canonical state
 * (relationship participation edges) and existing types (context-types facts).
 */

import {
  AIActionFact,
  ConsentFact,
  ParticipationFact,
  ParticipationRole as FactParticipationRole,
} from '../rules-engine/policies/context-types';
import { ParticipationEdge } from '../relationship-engine/types';

export interface AuthorizationFacts {
  readonly consent?: ConsentFact;
  readonly participation?: ParticipationFact;
  readonly aiAction?: AIActionFact;
}

export interface FactResolveInput {
  readonly tenantId: string;
  readonly actor: string;
  readonly subjectId: string;
  /** The intended AI use for this read (e.g. reasoning summarize/recommend). */
  readonly intendedAiUse?: AIActionFact;
}

/** Resolves facts only; never decides authorization. */
export interface FactResolver {
  resolve(input: FactResolveInput): Promise<AuthorizationFacts>;
}

/** Minimal source for consent facts (production wires a canonical Consent store). */
export interface ConsentFactSource {
  resolveConsent(tenantId: string, subjectId: string, actor: string): Promise<ConsentFact | undefined>;
}

/**
 * Minimal read port over relationship participation edges. The real
 * RelationshipRepository satisfies this structurally.
 */
export interface RelationshipReadPort {
  getActiveBySubject(tenantId: string, subjectId: string): Promise<readonly { id: string }[]>;
  getActiveEdgesForRelationship(
    tenantId: string,
    relationshipId: string,
  ): Promise<readonly ParticipationEdge[]>;
}

// Edge roles → context ParticipationRole. 'Observer' is oversight-only and is not
// a read role; mapping it to 'Informed' (also not a read role) keeps reads fail-closed.
const EDGE_TO_FACT_ROLE: Record<ParticipationEdge['role'], FactParticipationRole> = {
  Actor: 'Actor',
  Owner: 'Owner',
  Covering: 'Covering',
  Stakeholder: 'Stakeholder',
  Informed: 'Informed',
  Observer: 'Informed',
};

/**
 * Resolves participation from the relationship graph (canonical), AI-act from the
 * caller's intended AI use, and consent from an optional ConsentFactSource. When
 * no consent source is wired, consent resolves to undefined — which fails closed
 * at the boundary when consent is required.
 */
export class GraphFactResolver implements FactResolver {
  constructor(
    private readonly deps: {
      readonly relationships: RelationshipReadPort;
      readonly consent?: ConsentFactSource;
    },
  ) {}

  async resolve(input: FactResolveInput): Promise<AuthorizationFacts> {
    const participation = await this.resolveParticipation(input);
    const consent = this.deps.consent
      ? await this.deps.consent.resolveConsent(input.tenantId, input.subjectId, input.actor)
      : undefined;
    return { participation, consent, aiAction: input.intendedAiUse };
  }

  /** The actor's active role on the subject; 'None' if no active edge exists. */
  private async resolveParticipation(input: FactResolveInput): Promise<ParticipationFact> {
    const relationships = await this.deps.relationships.getActiveBySubject(
      input.tenantId,
      input.subjectId,
    );
    for (const rel of relationships) {
      const edges = await this.deps.relationships.getActiveEdgesForRelationship(
        input.tenantId,
        rel.id,
      );
      const edge = edges.find((e) => e.participantId === input.actor && e.active);
      if (edge) {
        return {
          workforceMemberId: input.actor,
          objectId: input.subjectId,
          role: EDGE_TO_FACT_ROLE[edge.role] ?? 'Informed',
          coverageExpiresAt: edge.coverageExpiresAt
            ? new Date(edge.coverageExpiresAt).toISOString()
            : undefined,
        };
      }
    }
    // No active participation edge for this actor on this subject → role 'None'.
    return { workforceMemberId: input.actor, objectId: input.subjectId, role: 'None' };
  }
}
