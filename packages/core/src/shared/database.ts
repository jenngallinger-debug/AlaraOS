/**
 * Alara OS — Database Client
 *
 * Thin wrapper around pg.Pool. All modules receive this via dependency
 * injection — no module reaches out to a global connection.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';

export class DatabaseClient {
  private readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  async query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query(text, values);
    return result.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, values);
    return rows[0] ?? null;
  }

  /**
   * Run a function inside a serializable transaction.
   * Rolls back automatically on throw.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  /** Health check */
  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }
}

export type { PoolClient };
