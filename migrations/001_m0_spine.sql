-- Alara OS — Migration 001: M0 Spine
-- Creates the three canonical tables for the Object Graph + Event Store.
--
-- Design decisions:
--   objects            → canonical object state (snapshot for performance)
--   events             → append-only source of truth (event store)
--   external_references → external IDs as reference attributes (not identity)
--
-- Constitutional alignment:
--   - Part XI Object Model (BD-013): objects have Alara UUIDs; typed; versioned
--   - ExternalReference Rule: external IDs stored separately, never PKs
--   - ADR-001 (EMR Boundary): no clinical content stored here
--   - OD-S2-2: UUIDv4 for objects, UUIDv7 for events
--   - OD-S2-3: tenant_id on every row + RLS for multi-tenancy

-- ─── Enable required extensions ───────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid() fallback
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- future: trigram search on attributes

-- ─── objects ─────────────────────────────────────────────────────────────────
-- Canonical snapshot of object state.
-- This table is a performance cache; the events table is the source of truth.
-- Rebuilt by replaying the event stream if needed.

CREATE TABLE IF NOT EXISTS objects (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   TEXT        NOT NULL,
    type        TEXT        NOT NULL,
    state       TEXT        NOT NULL DEFAULT 'created',
    attributes  JSONB       NOT NULL DEFAULT '{}',
    version     INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id),

    -- Enforce valid object types at DB level (belt-and-suspenders for BD-013)
    CONSTRAINT objects_type_valid CHECK (type IN (
        'Patient', 'Relationship', 'Event', 'Observation', 'Trigger',
        'Workflow', 'Journey', 'Goal', 'Benefit', 'CommunityResource',
        'Communication', 'Promise', 'Opportunity', 'Stakeholder',
        'AIAgent', 'KnowledgeObject', 'Timeline', 'Consent', 'WorkforceMember'
    )),

    CONSTRAINT objects_state_not_empty CHECK (char_length(state) > 0),
    CONSTRAINT objects_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

-- Tenant-scoped lookups (most queries filter by tenant first)
CREATE INDEX IF NOT EXISTS idx_objects_tenant_type
    ON objects (tenant_id, type);

CREATE INDEX IF NOT EXISTS idx_objects_tenant_state
    ON objects (tenant_id, state);

-- JSONB attribute search (GIN for @> containment queries)
CREATE INDEX IF NOT EXISTS idx_objects_attributes
    ON objects USING GIN (attributes);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'objects_set_updated_at'
    ) THEN
        CREATE TRIGGER objects_set_updated_at
        BEFORE UPDATE ON objects
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── events ──────────────────────────────────────────────────────────────────
-- Append-only event store. Source of truth.
-- NEVER UPDATE OR DELETE rows here.
-- id uses UUIDv7 format (time-ordered) for chronological range queries.

CREATE TABLE IF NOT EXISTS events (
    id              TEXT        NOT NULL,  -- UUIDv7 (time-ordered)
    tenant_id       TEXT        NOT NULL,
    stream_id       UUID        NOT NULL,  -- references objects.id
    seq             INTEGER     NOT NULL CHECK (seq >= 1),
    type            TEXT        NOT NULL,
    payload         JSONB       NOT NULL DEFAULT '{}',
    actor           TEXT        NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    causation_id    TEXT,
    correlation_id  TEXT,

    PRIMARY KEY (id),

    -- Prevent duplicate seq within a stream (ensures ordering integrity)
    CONSTRAINT events_stream_seq_unique UNIQUE (stream_id, seq),

    CONSTRAINT events_tenant_not_empty CHECK (char_length(tenant_id) > 0),
    CONSTRAINT events_actor_not_empty  CHECK (char_length(actor) > 0),
    CONSTRAINT events_type_not_empty   CHECK (char_length(type) > 0)
);

-- Primary read path: load stream in order
CREATE INDEX IF NOT EXISTS idx_events_stream_seq
    ON events (stream_id, seq ASC);

-- Tenant-level projection / org-brain reads
CREATE INDEX IF NOT EXISTS idx_events_tenant_occurred
    ON events (tenant_id, occurred_at ASC);

-- Correlation / causation tracing
CREATE INDEX IF NOT EXISTS idx_events_correlation
    ON events (correlation_id)
    WHERE correlation_id IS NOT NULL;

-- ─── external_references ─────────────────────────────────────────────────────
-- External IDs stored as reference attributes, never as object identity.
-- Constitutional alignment: ExternalReference Rule (Part XI Universal Object Rules)
-- and BD-013-B.
--
-- Example:
--   { object_id: <alara-uuid>, system: 'Automynd', ext_type: 'patient_id', value: 'AM-883201' }
--   { object_id: <alara-uuid>, system: 'VA',       ext_type: 'auth_id',    value: 'VA-12345' }

CREATE TABLE IF NOT EXISTS external_references (
    object_id   UUID    NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    tenant_id   TEXT    NOT NULL,
    system      TEXT    NOT NULL,  -- e.g. 'Automynd', 'VA', 'OWCP'
    ext_type    TEXT    NOT NULL,  -- e.g. 'patient_id', 'authorization_id'
    value       TEXT    NOT NULL,

    PRIMARY KEY (object_id, system, ext_type),

    CONSTRAINT ext_refs_system_not_empty   CHECK (char_length(system) > 0),
    CONSTRAINT ext_refs_ext_type_not_empty CHECK (char_length(ext_type) > 0),
    CONSTRAINT ext_refs_value_not_empty    CHECK (char_length(value) > 0)
);

-- Lookup by external ID (e.g. "give me the Alara object for Automynd patient AM-883201")
CREATE INDEX IF NOT EXISTS idx_ext_refs_lookup
    ON external_references (tenant_id, system, ext_type, value);

-- ─── Row-level security (multi-tenancy) ──────────────────────────────────────
-- RLS policies enforce tenant isolation at the database level (OD-S2-3).
-- Applications must SET app.tenant_id = '<value>' before querying.
-- In M0 (local dev) RLS is defined but not enforced — enable in production.

ALTER TABLE objects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_references ENABLE ROW LEVEL SECURITY;

-- Default policies (application sets current_setting('app.tenant_id'))
-- These are PERMISSIVE; they do not block admin/superuser roles (intentional for migrations).

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'objects' AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON objects
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'events' AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON events
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'external_references' AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON external_references
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

-- ─── Migration tracking ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT        NOT NULL PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001')
ON CONFLICT (version) DO NOTHING;
