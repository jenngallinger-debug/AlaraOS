#!/usr/bin/env node
/**
 * Alara OS — Migration Runner
 *
 * Usage:
 *   node scripts/migrate.js          # run all pending UP migrations
 *   node scripts/migrate.js down     # roll back the last applied migration
 *
 * Requires DATABASE_URL environment variable.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT        NOT NULL PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions(client) {
  const result = await client.query(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  return result.rows.map((r) => r.version);
}

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.match(/^\d+_.*\.sql$/) && !f.endsWith('.down.sql'))
    .sort();
}

async function runUp(client) {
  const applied = await getAppliedVersions(client);
  const files = getMigrationFiles();

  const pending = files.filter((f) => {
    const version = f.split('_')[0];
    return !applied.includes(version);
  });

  if (pending.length === 0) {
    console.log('✓ No pending migrations.');
    return;
  }

  for (const file of pending) {
    const version = file.split('_')[0];
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`▶ Applying migration ${version}…`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
        [version],
      );
      await client.query('COMMIT');
      console.log(`  ✓ Migration ${version} applied.`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ Migration ${version} failed:`, err.message);
      process.exit(1);
    }
  }
}

async function runDown(client) {
  const applied = await getAppliedVersions(client);
  if (applied.length === 0) {
    console.log('No migrations to roll back.');
    return;
  }

  const lastVersion = applied[applied.length - 1];
  const downFile = fs
    .readdirSync(MIGRATIONS_DIR)
    .find(
      (f) =>
        f.startsWith(lastVersion + '_') && f.endsWith('.down.sql'),
    );

  if (!downFile) {
    console.error(`No rollback file found for version ${lastVersion}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, downFile), 'utf8');
  console.log(`▶ Rolling back migration ${lastVersion}…`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `DELETE FROM schema_migrations WHERE version = $1`,
      [lastVersion],
    );
    await client.query('COMMIT');
    console.log(`  ✓ Migration ${lastVersion} rolled back.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ✗ Rollback failed:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const direction = process.argv[2] === 'down' ? 'down' : 'up';
    if (direction === 'down') {
      await runDown(client);
    } else {
      await runUp(client);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
