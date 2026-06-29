/**
 * Alara OS — ConsentRepository reads after RLS-step-2 migration (unit, no Postgres)
 *
 * Proves the two migrated reads of the central `objects` table are behavior-preserving while RLS is
 * inert: GUC set ONCE (parameterized) and FIRST inside a single transaction, byte-identical SQL +
 * params, identical mapping, and identical drop/null behavior (findForSubject drops malformed rows;
 * findById returns null for a wrong-type row). Mocked DatabaseClient (the helper's transaction +
 * client) → runs in the default suite. This repo has no writes.
 */

import { DatabaseClient } from '../src/shared/database';
import { TENANT_GUC } from '../src/shared/tenant-scope';
import { ConsentRepository } from '../src/consent-store/repository';

interface Captured { text: string; values?: unknown[] }

/** Fake DB: `transaction` runs fn with a single client returning `dataRows` for any non-GUC query. */
function makeFakeDb(dataRows: Record<string, unknown>[]) {
  const queries: Captured[] = [];
  const state = { txnCount: 0 };
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return /set_config/i.test(text) ? { rows: [{}] } : { rows: dataRows };
    },
  };
  const db = {
    async transaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
      state.txnCount += 1;
      return fn(client as never);
    },
  } as unknown as DatabaseClient;
  return { db, queries, state };
}

/** Assert: exactly one transaction, GUC set first (parameterized), and the data SELECT matches. */
function expectTenantScoped(h: ReturnType<typeof makeFakeDb>, tenantId: string, sql: string, params: unknown[]) {
  expect(h.state.txnCount).toBe(1);
  expect(h.queries[0]).toEqual({ text: 'SELECT set_config($1, $2, true)', values: [TENANT_GUC, tenantId] });
  expect(h.queries[1].text).toBe(sql);
  expect(h.queries[1].values).toEqual(params);
}

// Byte-identical SQL strings the repository issues (incl. the original multi-line whitespace).
const FIND_FOR_SUBJECT_SQL =
  `SELECT id, tenant_id, type, state, attributes, version
         FROM objects
        WHERE tenant_id = $1 AND type = $2 AND attributes->>'subjectId' = $3`;
const FIND_BY_ID_SQL =
  `SELECT id, tenant_id, type, state, attributes, version, created_at, updated_at
         FROM objects WHERE id = $1 AND tenant_id = $2`;

const CONSENT_ROW = {
  id: 'c1', tenant_id: 'tenant-A', type: 'Consent', state: 'active', version: 2,
  attributes: {
    subjectId: 'subj-1', recipientId: 'rec-1', grantorId: 'gr-1', consentId: 'consent-1',
    permissionTypes: ['share_phi'], effectiveDate: '2026-01-01', status: 'active',
  },
};

describe('ConsentRepository.findForSubject (RLS-step-2, tenant-scoped)', () => {
  test('GUC first (parameterized) in one transaction, byte-identical SQL/params, maps the fact', async () => {
    const h = makeFakeDb([CONSENT_ROW]);
    const facts = await new ConsentRepository(h.db).findForSubject('tenant-A', 'subj-1');

    expect(facts).toHaveLength(1);
    expect(facts[0].consentId).toBe('consent-1');
    expect(facts[0].subjectId).toBe('subj-1');
    expect(facts[0].recipientId).toBe('rec-1');
    expect(facts[0].version).toBe(2);
    expectTenantScoped(h, 'tenant-A', FIND_FOR_SUBJECT_SQL, ['tenant-A', 'Consent', 'subj-1']);
  });

  test('drops malformed rows (missing subjectId or recipientId) exactly as before, still one transaction', async () => {
    const h = makeFakeDb([
      CONSENT_ROW,
      { ...CONSENT_ROW, id: 'c2', attributes: { recipientId: 'rec-2' } },        // no subjectId → dropped
      { ...CONSENT_ROW, id: 'c3', attributes: { subjectId: 'subj-1' } },         // no recipientId → dropped
    ]);
    const facts = await new ConsentRepository(h.db).findForSubject('tenant-A', 'subj-1');
    expect(h.state.txnCount).toBe(1);
    expect(facts.map((f) => f.consentId)).toEqual(['consent-1']);                // only the well-formed row survives
  });

  test('empty result → empty array', async () => {
    const h = makeFakeDb([]);
    expect(await new ConsentRepository(h.db).findForSubject('tenant-A', 'nope')).toEqual([]);
  });
});

describe('ConsentRepository.findById (RLS-step-2, tenant-scoped)', () => {
  test('GUC first in one transaction, byte-identical SQL/params, returns the Consent fact', async () => {
    const h = makeFakeDb([CONSENT_ROW]);
    const fact = await new ConsentRepository(h.db).findById('tenant-A', 'c1');

    expect(fact?.consentId).toBe('consent-1');
    expect(fact?.subjectId).toBe('subj-1');
    expectTenantScoped(h, 'tenant-A', FIND_BY_ID_SQL, ['c1', 'tenant-A']);
  });

  test('returns null for a wrong-type row exactly as before (still one transaction)', async () => {
    const h = makeFakeDb([{ ...CONSENT_ROW, type: 'Patient' }]);
    const fact = await new ConsentRepository(h.db).findById('tenant-A', 'c1');
    expect(h.state.txnCount).toBe(1);
    expect(fact).toBeNull();
  });

  test('returns null when no row', async () => {
    const h = makeFakeDb([]);
    expect(await new ConsentRepository(h.db).findById('tenant-A', 'missing')).toBeNull();
  });
});
