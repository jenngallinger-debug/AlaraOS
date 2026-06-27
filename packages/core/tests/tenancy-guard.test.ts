/**
 * Alara OS — Tenancy guard (zero-behavior-change guardrail)
 *
 * Tenant isolation today is enforced by app-level `WHERE tenant_id` predicates, NOT by
 * RLS (see docs/architecture/tenancy-rls.md: RLS is scaffolded but bypassed by the owner
 * role and never receives `app.tenant_id`). The InMemoryStore filters by tenant in its
 * own handlers regardless of the SQL shape, so unit tests cannot catch a production query
 * that forgot its tenant predicate.
 *
 * This guard scans the SQL string literals in `packages/core/src` and FAILS if a
 * tenant-scoped table is queried without a `tenant_id` predicate, unless the exact SQL is
 * explicitly allow-listed with a documented reason. It is a conservative string/regex
 * check by design (not a SQL parser): "the statement touches a tenant-scoped table and
 * the token `tenant_id` does not appear anywhere in it."
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const TESTS_DIR = __dirname;                       // packages/core/tests
const SRC_DIR = join(TESTS_DIR, '..', 'src');      // packages/core/src
const MIGRATIONS_DIR = join(TESTS_DIR, '..', '..', '..', 'migrations'); // repo-root/migrations

/**
 * SQL that intentionally reads a tenant-scoped table by a globally-unique, self-generated
 * id WITHOUT a tenant predicate. Every entry MUST carry a reason (audited as benign).
 */
const ALLOWLIST: ReadonlyArray<{ sql: string; reason: string }> = [
  {
    sql: 'SELECT * FROM events WHERE id = $1',
    reason:
      'EventStore.append idempotency check by a freshly generated event id (UUID). The id ' +
      'never matches another tenant in practice; result is at most one own-tenant row.',
  },
  {
    sql: 'SELECT * FROM objects WHERE id = $1',
    reason:
      'ObjectGraphRepository.createWithClient re-fetches the row it just inserted, by its ' +
      'generated id, inside the same transaction.',
  },
];

// ─── Guard primitives (pure, unit-testable) ───────────────────────────────────

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Tenant-scoped tables = those with a `tenant_isolation` RLS policy in the migrations. */
function tenantScopedTables(): Set<string> {
  const tables = new Set<string>();
  for (const f of readdirSync(MIGRATIONS_DIR)) {
    if (!f.endsWith('.sql') || f.endsWith('.down.sql')) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const re = /CREATE POLICY\s+\w+\s+ON\s+(\w+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) tables.add(m[1]);
  }
  return tables;
}

/** Which tenant-scoped tables a SQL string targets via FROM / JOIN / INTO / UPDATE. */
function tenantTablesTouched(sql: string, tables: Set<string>): string[] {
  const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) if (tables.has(m[1])) out.add(m[1]);
  return [...out];
}

const LOOKS_LIKE_SQL = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i;

/** A SQL string that touches a tenant-scoped table but carries no `tenant_id` predicate. */
function isUnscopedTenantSql(sql: string, tables: Set<string>): boolean {
  if (!LOOKS_LIKE_SQL.test(sql)) return false;
  if (tenantTablesTouched(sql, tables).length === 0) return false;
  return !/tenant_id/.test(sql);
}

function listTsFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(listTsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function extractBacktickLiterals(src: string): string[] {
  const re = /`([^`]*)`/g; // SQL literals use $1 placeholders, not ${} interpolation
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

interface Hit { file: string; sql: string; tables: string[]; }

/** All unscoped-tenant SQL literals across the given files. */
function scanUnscopedSql(files: string[], tables: Set<string>): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const lit of extractBacktickLiterals(src)) {
      if (!isUnscopedTenantSql(lit, tables)) continue;
      hits.push({ file, sql: normalize(lit), tables: tenantTablesTouched(lit, tables) });
    }
  }
  return hits;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Tenancy guard — production SQL carries a tenant predicate', () => {
  const tables = tenantScopedTables();

  test('the migrations define tenant-scoped tables (guard has something to enforce)', () => {
    expect(tables.size).toBeGreaterThan(20);
    for (const t of ['objects', 'events', 'observations', 'workflows']) {
      expect(tables.has(t)).toBe(true);
    }
  });

  test('1. all production SQL is tenant-scoped or explicitly allow-listed', () => {
    const hits = scanUnscopedSql(listTsFiles(SRC_DIR), tables);
    const allowed = new Set(ALLOWLIST.map((a) => a.sql));
    const violations = hits.filter((h) => !allowed.has(h.sql));

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  - [${v.tables.join(',')}] ${v.file}\n      ${v.sql}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} SQL statement(s) against tenant-scoped table(s) without a ` +
        `tenant_id predicate. Add a tenant filter, or allow-list with a documented reason ` +
        `if the read is by a globally-unique self-generated id:\n${detail}`,
      );
    }
    expect(violations).toEqual([]);
  });

  test('every allow-list entry is still a real, present read (no stale exemptions)', () => {
    const present = new Set(scanUnscopedSql(listTsFiles(SRC_DIR), tables).map((h) => h.sql));
    for (const a of ALLOWLIST) {
      expect(present.has(a.sql)).toBe(true); // if this fails, the exemption is stale — remove it
    }
  });

  test('2. guard FLAGS a synthetic unscoped query against a tenant table', () => {
    expect(isUnscopedTenantSql('SELECT * FROM observations WHERE topic = $1', tables)).toBe(true);
    // ...and does NOT flag the properly-scoped form
    expect(isUnscopedTenantSql('SELECT * FROM observations WHERE tenant_id = $1 AND topic = $2', tables)).toBe(false);
    // ...nor a query that touches no tenant-scoped table
    expect(isUnscopedTenantSql('SELECT 1', tables)).toBe(false);
    expect(isUnscopedTenantSql('SELECT * FROM schema_migrations WHERE version = $1', tables)).toBe(false);
  });

  test('3. allow-listed by-id reads are allowed only with an explicit documented reason', () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.trim().length).toBeGreaterThan(20);
      // an allow-listed statement must itself be genuinely unscoped (else it needn't be listed)
      expect(isUnscopedTenantSql(a.sql, tables)).toBe(true);
    }
    expect([...ALLOWLIST].map((a) => a.sql).sort()).toEqual([
      'SELECT * FROM events WHERE id = $1',
      'SELECT * FROM objects WHERE id = $1',
    ]);
  });
});
