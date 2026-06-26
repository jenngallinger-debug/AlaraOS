/**
 * Alara OS — Object Command Handler
 *
 * Coordinates the Object Graph Repository and Event Store so that:
 *   1. Object state change and event append happen atomically.
 *   2. The event stream is always consistent with object state.
 *   3. Replay of the event stream can reconstruct object state.
 *
 * This is the write-side of CQRS for object lifecycle commands.
 */

import { DatabaseClient } from '../shared/database';
import { AlaraId, AlaraObject, ExternalReference, ObjectType } from '../shared/types';
import { EventStore } from '../events/store';
import {
  ObjectCreatedPayload,
  ObjectUpdatedPayload,
  ExternalReferenceAddedPayload,
} from '../events/types';
import {
  CreateObjectCommand,
  ObjectGraphRepository,
  UpdateObjectCommand,
} from '../object-graph/repository';

export interface CreateObjectResult {
  object: AlaraObject;
  eventId: string;
}

export interface UpdateObjectResult {
  object: AlaraObject;
  eventId: string;
}

export interface AddExternalRefResult {
  eventId: string;
}

export class ObjectCommandHandler {
  private readonly repo: ObjectGraphRepository;
  private readonly eventStore: EventStore;

  constructor(
    private readonly db: DatabaseClient,
    repo?: ObjectGraphRepository,
    eventStore?: EventStore,
  ) {
    this.repo = repo ?? new ObjectGraphRepository(db);
    this.eventStore = eventStore ?? new EventStore(db);
  }

  /**
   * Create a new Alara object.
   * Atomically writes to objects + events tables.
   * Returns the created object and the ID of the ObjectCreated event.
   */
  async createObject(cmd: CreateObjectCommand): Promise<CreateObjectResult> {
    return this.db.transaction(async (client) => {
      // 1. Create the object (assigns Alara UUID)
      const object = await this.repo.createWithClient(client, cmd);

      // 2. Append the ObjectCreated event to the stream
      const event = await this.eventStore.append<ObjectCreatedPayload>({
        tenantId: cmd.tenantId,
        streamId: object.id,
        type: 'ObjectCreated',
        payload: {
          objectType: cmd.type,
          state: object.state,
          attributes: object.attributes,
        },
        actor: cmd.actor,
        client,
      });

      return { object, eventId: event.id };
    });
  }

  /**
   * Update an existing object's attributes.
   * Enforces optimistic concurrency via expectedVersion.
   */
  async updateObject(cmd: UpdateObjectCommand): Promise<UpdateObjectResult> {
    return this.db.transaction(async (client) => {
      // 1. Update object state (version-gated)
      const object = await this.repo.update(cmd);

      // 2. Append ObjectUpdated event
      const event = await this.eventStore.append<ObjectUpdatedPayload>({
        tenantId: cmd.tenantId,
        streamId: cmd.id,
        type: 'ObjectUpdated',
        payload: {
          objectType: object.type,
          previousVersion: cmd.expectedVersion,
          changes: cmd.changes,
          newAttributes: object.attributes,
        },
        actor: cmd.actor,
        client,
      });

      return { object, eventId: event.id };
    });
  }

  /**
   * Add an external reference to an existing object.
   *
   * RULE: External IDs are reference attributes, not identity.
   * The object's Alara UUID remains its canonical identity.
   * The external ID is stored in the external_references table.
   */
  async addExternalReference(
    tenantId: string,
    objectId: AlaraId,
    ref: ExternalReference,
    actor: string,
  ): Promise<AddExternalRefResult> {
    return this.db.transaction(async (client) => {
      // 1. Upsert the external reference
      await client.query(
        `INSERT INTO external_references (object_id, tenant_id, system, ext_type, value)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (object_id, system, ext_type)
         DO UPDATE SET value = EXCLUDED.value`,
        [objectId, tenantId, ref.system, ref.extType, ref.value],
      );

      // 2. Append ExternalReferenceAdded event
      const event = await this.eventStore.append<ExternalReferenceAddedPayload>({
        tenantId,
        streamId: objectId,
        type: 'ExternalReferenceAdded',
        payload: {
          system: ref.system,
          extType: ref.extType,
          value: ref.value,
        },
        actor,
        client,
      });

      return { eventId: event.id };
    });
  }
}

// ─── Event-sourced state reconstruction ──────────────────────────────────────

/**
 * Reconstruct the current state of an object by replaying its event stream.
 *
 * This is the canonical proof that the event store is the source of truth.
 * The object table is a performance snapshot; the event stream is the truth.
 *
 * M0 implements ObjectCreated → ObjectUpdated → ExternalReferenceAdded.
 * Later engines add their own event handlers to this fold.
 */
export interface ReconstructedState {
  id: AlaraId;
  type: ObjectType;
  state: string;
  attributes: Record<string, unknown>;
  version: number;
  externalReferences: ExternalReference[];
}

export async function reconstructFromEvents(
  eventStore: EventStore,
  tenantId: string,
  objectId: AlaraId,
): Promise<ReconstructedState | null> {
  const events = await eventStore.loadStream(tenantId, objectId);

  if (events.length === 0) return null;

  let type: ObjectType | undefined;
  let state = 'created';
  let attributes: Record<string, unknown> = {};
  let version = 0;
  const externalReferences: ExternalReference[] = [];

  for (const event of events) {
    version++;

    switch (event.type) {
      case 'ObjectCreated': {
        const p = event.payload as unknown as ObjectCreatedPayload;
        type = p.objectType;
        state = p.state;
        attributes = { ...p.attributes };
        break;
      }

      case 'ObjectUpdated': {
        const p = event.payload as unknown as ObjectUpdatedPayload;
        attributes = { ...attributes, ...p.changes };
        break;
      }

      case 'ObjectStateTransitioned': {
        const p = event.payload as { toState: string };
        state = p.toState;
        break;
      }

      case 'ExternalReferenceAdded': {
        const p = event.payload as unknown as ExternalReferenceAddedPayload;
        const existing = externalReferences.findIndex(
          (r) => r.system === p.system && r.extType === p.extType,
        );
        if (existing >= 0) {
          externalReferences[existing] = {
            system: p.system,
            extType: p.extType,
            value: p.value,
          };
        } else {
          externalReferences.push({
            system: p.system,
            extType: p.extType,
            value: p.value,
          });
        }
        break;
      }

      // Future event types handled by later engines — ignored in M0 replay
      default:
        break;
    }
  }

  if (!type) return null;

  return { id: objectId, type, state, attributes, version, externalReferences };
}
