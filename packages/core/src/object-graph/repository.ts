/**
 * Alara OS — Object Graph Repository
 *
 * Implements the Unified Object Graph (Part XI, BD-013).
 *
 * KEY RULES enforced here:
 *   1. Every object gets an Alara UUID — never an external ID.
 *   2. External IDs are stored in `external_references` — never as PKs or FKs.
 *   3. Object updates are version-gated (optimistic concurrency).
 *   4. Object type must pass the Objecthood Principle (validated via OBJECT_TYPES).
 */

import { PoolClient } from 'pg';
import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import {
  AlaraId,
  AlaraObject,
  ExternalReference,
  isValidObjectType,
  ObjectType,
} from '../shared/types';

// ─── Commands ────────────────────────────────────────────────────────────────

export interface CreateObjectCommand {
  tenantId: string;
  type: ObjectType;
  attributes?: Record<string, unknown>;
  state?: string;
  /** Actor performing the command (WorkforceMember id or 'system') */
  actor: string;
}

export interface UpdateObjectCommand {
  tenantId: string;
  id: AlaraId;
  changes: Record<string, unknown>;
  /** Must match the current version — prevents lost-update bugs */
  expectedVersion: number;
  actor: string;
}

export interface AddExternalReferenceCommand {
  tenantId: string;
  objectId: AlaraId;
  ref: ExternalReference;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ObjectNotFoundError extends Error {
  constructor(id: AlaraId) {
    super(`Object not found: ${id}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class StaleVersionError extends Error {
  constructor(id: AlaraId, expected: number, actual: number) {
    super(
      `Stale version for object ${id}: expected ${expected}, got ${actual}`,
    );
    this.name = 'StaleVersionError';
  }
}

export class InvalidObjectTypeError extends Error {
  constructor(type: string) {
    super(
      `"${type}" is not a valid Alara object type. ` +
        `Only types that pass the BD-013 Objecthood Principle are permitted. ` +
        `Growth-specific concepts (Community, Campaign, Moment, etc.) are not objects.`,
    );
    this.name = 'InvalidObjectTypeError';
  }
}

// ─── Row shapes from Postgres ─────────────────────────────────────────────────

interface ObjectRow {
  id: string;
  tenant_id: string;
  type: string;
  state: string;
  attributes: Record<string, unknown>;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface ExternalReferenceRow {
  object_id: string;
  tenant_id: string;
  system: string;
  ext_type: string;
  value: string;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class ObjectGraphRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Create a new Alara object.
   * Assigns a new Alara UUID — external IDs must be added via addExternalReference.
   */
  async create(cmd: CreateObjectCommand): Promise<AlaraObject> {
    if (!isValidObjectType(cmd.type)) {
      throw new InvalidObjectTypeError(cmd.type);
    }

    const id = newAlaraId();
    const state = cmd.state ?? 'created';
    const attributes = cmd.attributes ?? {};

    await this.db.query(
      `INSERT INTO objects (id, tenant_id, type, state, attributes, version)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [id, cmd.tenantId, cmd.type, state, JSON.stringify(attributes)],
    );

    return this.getById(cmd.tenantId, id) as Promise<AlaraObject>;
  }

  /**
   * Update object attributes with optimistic concurrency.
   * Throws StaleVersionError if expectedVersion doesn't match current.
   */
  async update(cmd: UpdateObjectCommand): Promise<AlaraObject> {
    const result = await this.db.query<{ version: number }>(
      `UPDATE objects
          SET attributes = attributes || $1::jsonb,
              version    = version + 1,
              updated_at = NOW()
        WHERE id = $2
          AND tenant_id = $3
          AND version = $4
       RETURNING version`,
      [
        JSON.stringify(cmd.changes),
        cmd.id,
        cmd.tenantId,
        cmd.expectedVersion,
      ],
    );

    if (result.length === 0) {
      // Either not found or stale version — disambiguate:
      const existing = await this.getById(cmd.tenantId, cmd.id);
      if (!existing) throw new ObjectNotFoundError(cmd.id);
      throw new StaleVersionError(cmd.id, cmd.expectedVersion, existing.version);
    }

    return this.getById(cmd.tenantId, cmd.id) as Promise<AlaraObject>;
  }

  /**
   * Retrieve an object by its Alara UUID.
   * External IDs are never used as lookup keys here.
   */
  async getById(
    tenantId: string,
    id: AlaraId,
  ): Promise<AlaraObject | null> {
    const row = await this.db.queryOne<ObjectRow>(
      `SELECT id, tenant_id, type, state, attributes, version, created_at, updated_at
         FROM objects
        WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );

    return row ? rowToObject(row) : null;
  }

  /**
   * Add an external reference to an existing object.
   * RULE: External IDs are reference attributes, not identity.
   * Upserts on (object_id, system, ext_type).
   */
  async addExternalReference(cmd: AddExternalReferenceCommand): Promise<void> {
    await this.db.query(
      `INSERT INTO external_references (object_id, tenant_id, system, ext_type, value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (object_id, system, ext_type)
       DO UPDATE SET value = EXCLUDED.value`,
      [
        cmd.objectId,
        cmd.tenantId,
        cmd.ref.system,
        cmd.ref.extType,
        cmd.ref.value,
      ],
    );
  }

  /** Get all external references for an object. */
  async getExternalReferences(
    tenantId: string,
    objectId: AlaraId,
  ): Promise<ExternalReference[]> {
    const rows = await this.db.query<ExternalReferenceRow>(
      `SELECT system, ext_type, value
         FROM external_references
        WHERE object_id = $1 AND tenant_id = $2`,
      [objectId, tenantId],
    );

    return rows.map((r) => ({
      system: r.system,
      extType: r.ext_type,
      value: r.value,
    }));
  }

  /**
   * Find objects by an external reference.
   * This is a lookup path (for Automynd sync etc.) — it returns Alara objects,
   * not external records. The external ID is never the object's identity.
   */
  async findByExternalReference(
    tenantId: string,
    system: string,
    extType: string,
    value: string,
  ): Promise<AlaraObject[]> {
    const rows = await this.db.query<ObjectRow>(
      `SELECT o.id, o.tenant_id, o.type, o.state, o.attributes,
              o.version, o.created_at, o.updated_at
         FROM objects o
         JOIN external_references er ON er.object_id = o.id
        WHERE o.tenant_id = $1
          AND er.system   = $2
          AND er.ext_type = $3
          AND er.value    = $4`,
      [tenantId, system, extType, value],
    );

    return rows.map(rowToObject);
  }

  /** Convenience: transactional create via a provided client */
  async createWithClient(
    client: PoolClient,
    cmd: CreateObjectCommand,
  ): Promise<AlaraObject> {
    if (!isValidObjectType(cmd.type)) {
      throw new InvalidObjectTypeError(cmd.type);
    }

    const id = newAlaraId();
    const state = cmd.state ?? 'created';
    const attributes = cmd.attributes ?? {};

    await client.query(
      `INSERT INTO objects (id, tenant_id, type, state, attributes, version)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [id, cmd.tenantId, cmd.type, state, JSON.stringify(attributes)],
    );

    const row = await client.query<ObjectRow>(
      `SELECT * FROM objects WHERE id = $1`,
      [id],
    );
    return rowToObject(row.rows[0]);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToObject(row: ObjectRow): AlaraObject {
  return {
    id: row.id as AlaraId,
    tenantId: row.tenant_id,
    type: row.type as ObjectType,
    state: row.state,
    attributes: row.attributes,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
