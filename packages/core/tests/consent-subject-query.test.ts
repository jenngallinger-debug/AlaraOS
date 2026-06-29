/**
 * Alara OS — Consent read-path: subject-targeted query (P0 hardening)
 *
 * Proves ConsentRepository.findForSubject queries by tenant + type + subject and does
 * NOT scan every Consent object in the tenant (docs/architecture/code-concordance.md).
 * Result semantics are unchanged: it returns every well-formed consent for the subject
 * in any status, so GraphConsentFactSource can still select active/revoked/expired.
 */

import { InMemoryStore } from './helpers/in-memory-store';
import { DatabaseClient } from '../src/shared/database';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { ConsentRepository } from '../src/consent-store/repository';
import { PoolClient } from 'pg';

const TENANT = 'alara-home-care';
const SUBJECT = 'subject-patient-1';
const ACTOR = 'wm-care-guide';

function consent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subjectId: SUBJECT, grantorId: 'patient', recipientId: ACTOR,
    permissionTypes: ['read'], effectiveDate: '2020-01-01', status: 'active', ...over,
  };
}

async function seed(objects: ObjectGraphRepository, tenantId: string, attrs: Record<string, unknown>): Promise<void> {
  await objects.create({
    tenantId, type: 'Consent', state: String(attrs['status'] ?? 'active'),
    attributes: attrs, actor: 'system',
  });
}

/** Records every SQL text the repository issues (it only uses db.query). */
class SqlSpyDb {
  readonly sql: string[] = [];
  constructor(private readonly inner: InMemoryStore) {}
  async query<T = unknown>(text: string, values?: unknown[]): Promise<T[]> {
    this.sql.push(text.replace(/\s+/g, ' ').trim());
    return this.inner.query<T>(text, values ?? []);
  }
  async queryOne<T = unknown>(text: string, values?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(text, values); return rows[0] ?? null;
  }
  async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    // The repo now issues its reads on the transaction client (RLS step 2), so the spy must record
    // SQL there too — wrap the client so its `query` is captured exactly like the direct `query` path.
    return this.inner.transaction((client: PoolClient) => {
      const spied = {
        query: async (text: string, values?: unknown[]) => {
          this.sql.push(text.replace(/\s+/g, ' ').trim());
          return client.query(text, values as never[]);
        },
      } as unknown as PoolClient;
      return fn(spied);
    });
  }
  async end(): Promise<void> {}
}

describe('Consent read-path — subject-targeted query (Phase 3)', () => {
  test('1. returns only the requested subject\'s consents', async () => {
    const store = new InMemoryStore();
    const objects = new ObjectGraphRepository(store as unknown as DatabaseClient);
    await seed(objects, TENANT, consent());                                  // subject
    await seed(objects, TENANT, consent({ subjectId: 'other-1' }));          // other subject
    await seed(objects, TENANT, consent({ subjectId: 'other-2' }));          // other subject

    const repo = new ConsentRepository(store as unknown as DatabaseClient);
    const facts = await repo.findForSubject(TENANT, SUBJECT);
    expect(facts).toHaveLength(1);
    expect(facts[0].subjectId).toBe(SUBJECT);
  });

  test('2. consents for other subjects are not returned', async () => {
    const store = new InMemoryStore();
    const objects = new ObjectGraphRepository(store as unknown as DatabaseClient);
    await seed(objects, TENANT, consent({ subjectId: 'other-1' }));
    const repo = new ConsentRepository(store as unknown as DatabaseClient);
    expect(await repo.findForSubject(TENANT, SUBJECT)).toHaveLength(0);
  });

  test('3. same subject id in a different tenant is not returned', async () => {
    const store = new InMemoryStore();
    const objects = new ObjectGraphRepository(store as unknown as DatabaseClient);
    await seed(objects, 'tenant-A', consent());           // SUBJECT in tenant-A
    await seed(objects, 'tenant-B', consent());           // SUBJECT in tenant-B
    const repo = new ConsentRepository(store as unknown as DatabaseClient);

    const a = await repo.findForSubject('tenant-A', SUBJECT);
    expect(a).toHaveLength(1);
    // tenant-B's consent for the same subject id must not leak into tenant-A.
    expect(a.every(f => f.subjectId === SUBJECT)).toBe(true);
    expect(await repo.findForSubject('tenant-A', SUBJECT)).toHaveLength(1);
  });

  test('4. all statuses for the subject are returned (selection happens downstream)', async () => {
    const store = new InMemoryStore();
    const objects = new ObjectGraphRepository(store as unknown as DatabaseClient);
    await seed(objects, TENANT, consent({ status: 'active' }));
    await seed(objects, TENANT, consent({ status: 'revoked', revokedAt: '2024-01-01' }));
    await seed(objects, TENANT, consent({ status: 'active', expirationDate: '2000-01-01' })); // expired
    const repo = new ConsentRepository(store as unknown as DatabaseClient);

    const facts = await repo.findForSubject(TENANT, SUBJECT);
    expect(facts).toHaveLength(3);
    const statuses = facts.map(f => f.status).sort();
    expect(statuses).toEqual(['active', 'active', 'revoked']);
    expect(facts.some(f => f.expirationDate === '2000-01-01')).toBe(true);
  });

  test('7. uses the subject-targeted query path; never a tenant-wide consent scan', async () => {
    const store = new InMemoryStore();
    const objects = new ObjectGraphRepository(store as unknown as DatabaseClient);
    await seed(objects, TENANT, consent());
    await seed(objects, TENANT, consent({ subjectId: 'other' }));

    const spy = new SqlSpyDb(store);
    const repo = new ConsentRepository(spy as unknown as DatabaseClient);
    const facts = await repo.findForSubject(TENANT, SUBJECT);
    expect(facts).toHaveLength(1);

    // Targeted query was issued...
    expect(spy.sql.some(s => s.includes("attributes->>'subjectId'"))).toBe(true);
    // ...and the old tenant-wide consent scan (ending in `type = $2`) was NOT.
    // This assertion fails if findForSubject ever falls back to the full scan.
    expect(spy.sql.some(s => /FROM objects WHERE tenant_id = \$1 AND type = \$2$/.test(s))).toBe(false);
  });
});
