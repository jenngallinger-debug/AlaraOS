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
import { withTenantTransaction } from '../shared/tenant-scope';
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
  // RLS step 2: these reads of the central `objects` table run inside a tenant-scoped transaction
  // (carries `app.tenant_id`). Behavior-preserving today (RLS inert → same rows); identical
  // SQL/params/mapping/returns. NOTE: actual RLS enablement on `objects` remains GATED on the other
  // `objects` readers (ObjectGraphRepository + the by-id idempotency special case) being handled too
  // — this slice does NOT add any policy/FORCE/WITH CHECK on `objects`. See tenancy-rls.md Appendix C.
  async findForSubject(tenantId: string, subjectId: string): Promise<ConsentFact[]> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      // Subject-targeted query (hot authorization read path): filter by tenant, type,
      // AND the consent subject inside the JSONB — never load every Consent object in the
      // tenant. Backed in production by the partial expression index
      // idx_objects_consent_subject (migration 012) on (attributes->>'subjectId').
      const r = await client.query<ConsentObjectRow>(
        `SELECT id, tenant_id, type, state, attributes, version
         FROM objects
        WHERE tenant_id = $1 AND type = $2 AND attributes->>'subjectId' = $3`,
        [tenantId, CONSENT_TYPE, subjectId],
      );
      const facts: ConsentFact[] = [];
      for (const row of r.rows) {
        const fact = rowToConsentFact(row);
        // The query already scopes to this subject; map every well-formed consent
        // (any status — the caller selects active/revoked/expired).
        if (fact) facts.push(fact);
      }
      return facts;
    });
  }

  /** A single Consent fact by its Alara id (used to authorize withdrawal). */
  async findById(tenantId: string, consentId: string): Promise<ConsentFact | null> {
    return withTenantTransaction(this.db, tenantId, async (client) => {
      const r = await client.query<ConsentObjectRow>(
        `SELECT id, tenant_id, type, state, attributes, version, created_at, updated_at
         FROM objects WHERE id = $1 AND tenant_id = $2`,
        [consentId, tenantId],
      );
      const row = r.rows[0];
      if (!row || row.type !== CONSENT_TYPE) return null;
      return rowToConsentFact(row);
    });
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
