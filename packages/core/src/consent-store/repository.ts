/**
 * Alara OS — Consent Repository (canonical query path)
 *
 * Consent is a canonical object type (shared/types OBJECT_TYPES — BD-014). This
 * repository reads Consent objects from the unified object graph (`objects`
 * table) and maps them to the existing `ConsentFact` shape that the Consent
 * Policy Module already understands. It resolves FACTS ONLY — it never decides
 * authorization; the existing ConsentPolicyModule / Permission Gate do.
 *
 * No new Consent type is introduced (the type already exists in shared types),
 * and no policy logic is duplicated. active / revoked / expired are represented
 * by the existing ConsentFact fields (status, revokedAt, expirationDate); this
 * repository passes them through and lets the policy evaluate them.
 */

import { DatabaseClient } from '../shared/database';
import {
  ConsentFact,
  ConsentPermissionType,
  ConsentStatus,
} from '../rules-engine/policies/context-types';

const CONSENT_TYPE = 'Consent';

interface ConsentObjectRow {
  id: string;
  tenant_id: string;
  type: string;
  state: string;
  attributes: Record<string, unknown>;
  version: number;
}

export class ConsentRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * All Consent facts recorded for a subject (any status: active / revoked /
   * expired / pending). The caller (ConsentFactSource) selects the relevant one;
   * the ConsentPolicyModule renders the ALLOW/DENY decision.
   */
  async findForSubject(tenantId: string, subjectId: string): Promise<ConsentFact[]> {
    const rows = await this.db.query<ConsentObjectRow>(
      `SELECT * FROM objects WHERE tenant_id = $1 AND type = $2`,
      [tenantId, CONSENT_TYPE],
    );
    const facts: ConsentFact[] = [];
    for (const row of rows) {
      const fact = rowToConsentFact(row);
      if (fact && fact.subjectId === subjectId) facts.push(fact);
    }
    return facts;
  }
}

/** Map a Consent object's attributes to the canonical ConsentFact shape. */
function rowToConsentFact(row: ConsentObjectRow): ConsentFact | null {
  const a = row.attributes ?? {};
  // Minimum viable consent record: a subject and a recipient.
  if (!a['subjectId'] || !a['recipientId']) return null;
  return {
    consentId: (a['consentId'] as string) ?? row.id,
    subjectId: String(a['subjectId']),
    grantorId: String(a['grantorId'] ?? ''),
    recipientId: String(a['recipientId']),
    permissionTypes: (a['permissionTypes'] as ConsentPermissionType[]) ?? [],
    effectiveDate: String(a['effectiveDate'] ?? ''),
    expirationDate: a['expirationDate'] ? String(a['expirationDate']) : undefined,
    revokedAt: a['revokedAt'] ? String(a['revokedAt']) : undefined,
    version: Number(row.version ?? 1),
    status: (a['status'] as ConsentStatus) ?? 'active',
  };
}
