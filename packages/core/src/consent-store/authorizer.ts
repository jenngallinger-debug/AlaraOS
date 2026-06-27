/**
 * Alara OS — Consent Authorizer
 *
 * Answers "may this actor grant/withdraw consent for this subject?" by RESOLVING
 * FACTS (the actor's participation role on the subject; the consent's subject for
 * withdrawal) and DELEGATING the decision to the RulesEngine via the
 * ConsentAuthorityPolicyModule. It is not a policy engine and contains no
 * authorization logic of its own — the decision lives in the rules/policy layer.
 * Fail-closed: a non-ALLOW decision (including missing context or an unreadable
 * consent) throws ConsentAuthorizationError.
 */

import { RulesEngine } from '../rules-engine/engine';
import { CONSENT_CAPTURE_RULESET } from '../rules-engine/policies/consent-authority-policy';
import { resolveParticipationFact, RelationshipReadPort } from '../reasoning-engine/fact-resolver';
import { ConsentRepository } from './repository';

export class ConsentAuthorizationError extends Error {
  constructor(message: string) {
    super(`Consent authorization denied: ${message}`);
    this.name = 'ConsentAuthorizationError';
  }
}

export interface ConsentAuthorizerDeps {
  /** Resolves the actor's participation role on the subject (canonical relationships). */
  readonly relationships?: RelationshipReadPort;
  /** Resolves a consent's subject for withdrawal authorization. */
  readonly consents?: ConsentRepository;
}

export class ConsentAuthorizer {
  constructor(
    private readonly rules: RulesEngine,
    private readonly deps: ConsentAuthorizerDeps = {},
  ) {}

  /** Throws ConsentAuthorizationError unless the actor may grant consent for the subject. */
  async assertMayGrant(input: { tenantId: string; actor: string; subjectId: string }): Promise<void> {
    await this.assert(input.tenantId, input.actor, input.subjectId, 'grant');
  }

  /** Throws unless the actor may withdraw the given consent (authorized against its real subject). */
  async assertMayWithdraw(input: { tenantId: string; actor: string; consentId: string }): Promise<void> {
    const consent = this.deps.consents
      ? await this.deps.consents.findById(input.tenantId, input.consentId)
      : null;
    if (!consent) {
      // Fail closed: cannot establish the subject, so cannot authorize.
      throw new ConsentAuthorizationError(`consent not found or unreadable: ${input.consentId}`);
    }
    await this.assert(input.tenantId, input.actor, consent.subjectId, 'withdraw');
  }

  private async assert(
    tenantId: string,
    actor: string,
    subjectId: string,
    action: 'grant' | 'withdraw',
  ): Promise<void> {
    const participation = actor && this.deps.relationships
      ? await resolveParticipationFact(this.deps.relationships, tenantId, actor, subjectId)
      : undefined;

    const decision = await this.rules.evaluate({
      tenantId,
      actor: actor ?? '',
      eventType: action === 'grant' ? 'ConsentGrantRequested' : 'ConsentWithdrawRequested',
      eventPayload: { subjectId, action },
      ruleSetId: CONSENT_CAPTURE_RULESET,
      objects: { subjectId, participation },
      metadata: { action },
    });

    if (decision.outcome !== 'ALLOW') {
      throw new ConsentAuthorizationError(decision.explanation.summary);
    }
  }
}
