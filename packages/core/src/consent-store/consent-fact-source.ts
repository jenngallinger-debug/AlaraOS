/**
 * Alara OS — Graph-backed ConsentFactSource
 *
 * Wires the canonical Consent query path (ConsentRepository) into the
 * ConsentFactSource interface consumed by GraphFactResolver. It RESOLVES A FACT
 * ONLY — it selects the consent record relevant to (subject, actor, read) and
 * hands it to the resolver; the existing ConsentPolicyModule / Permission Gate
 * make the ALLOW / DENY decision.
 *
 * Selection (fact choice, not policy):
 *   - scope to consents granted to this actor (recipientId === actor or '*');
 *   - if a currently-usable consent exists (active, not revoked, not expired)
 *     return it (so valid consent can allow);
 *   - otherwise return any scoped consent (revoked/expired/etc.) so the policy
 *     blocks it (fail closed);
 *   - if no consent is scoped to the actor, return undefined → the boundary fails
 *     closed when consent is required.
 *
 * Permission scoping (e.g. 'read' vs 'update') is deliberately NOT filtered here
 * — the ConsentPolicyModule checks the required permission against the scope.
 */

import { ConsentFact } from '../rules-engine/policies/context-types';
import { ConsentFactSource } from '../reasoning-engine/fact-resolver';
import { ConsentRepository } from './repository';

export class GraphConsentFactSource implements ConsentFactSource {
  constructor(private readonly repo: ConsentRepository) {}

  async resolveConsent(
    tenantId: string,
    subjectId: string,
    actor: string,
  ): Promise<ConsentFact | undefined> {
    const all = await this.repo.findForSubject(tenantId, subjectId);
    const scoped = all.filter((c) => c.recipientId === actor || c.recipientId === '*');
    if (scoped.length === 0) return undefined;

    const now = Date.now();
    const usable = scoped.find(
      (c) =>
        c.status === 'active' &&
        !c.revokedAt &&
        (!c.expirationDate || new Date(c.expirationDate).getTime() >= now),
    );
    return usable ?? scoped[0];
  }
}
