-- Alara OS — Migration 011: M10.5 Journey Engine
--
-- Additive only. Creates the Journey Engine's own tables to match the
-- implementation in packages/core/src/journey-engine (commit 27620a2).
--
-- The Journey Engine owns a self-contained operational substrate:
--   journeys                   — journey objects (lifecycle, intent, coordination state)
--   journey_references         — typed references to other objects (the Journey Invariant)
--   journey_events             — engine-local append-only event log
--   journey_projections        — engine-owned operational read model (journey_state)
--   journey_capability_tokens  — anonymous-access capability tokens
--
-- IMPORTANT — canonical projection system is NOT touched:
--   journey_projections is the Journey Engine's OWN table. Its projection_type
--   column stores the literal 'journey_state' as engine-local operational state.
--   This migration does NOT add a 'JourneyState' ProjectionType, does NOT alter
--   the canonical `projections` table, and does NOT modify proj_type_valid.
--   Journey current state is authoritative operational state, not an ADR-016
--   Computed Projection.

-- ─── journeys ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journeys (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    intent              TEXT,
    intent_inferred_at  TIMESTAMPTZ,
    lifecycle           TEXT        NOT NULL DEFAULT 'arrival'
                        CHECK (lifecycle IN (
                            'arrival', 'orientation', 'working',
                            'dormant', 'reactivated', 'completed', 'archived'
                        )),
    lifecycle_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    coordination_state  JSONB       NOT NULL DEFAULT '{}',
    identity_resolved   BOOLEAN     NOT NULL DEFAULT FALSE,
    merged_from         UUID[]      NOT NULL DEFAULT '{}',
    split_from          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT journey_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_journeys_lifecycle
    ON journeys (tenant_id, lifecycle, created_at);

-- ─── journey_references ───────────────────────────────────────────────────────
-- The Journey Invariant in schema form: Journey points at objects; never owns them.

CREATE TABLE IF NOT EXISTS journey_references (
    id          UUID        NOT NULL PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    journey_id  UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL,
    ref_id      TEXT        NOT NULL,
    role        TEXT,
    linked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_by   TEXT,
    meta        JSONB       NOT NULL DEFAULT '{}',

    CONSTRAINT jref_tenant_not_empty CHECK (char_length(tenant_id) > 0),
    CONSTRAINT jref_kind_not_empty   CHECK (char_length(kind) > 0),
    CONSTRAINT jref_refid_not_empty  CHECK (char_length(ref_id) > 0),
    CONSTRAINT jref_unique UNIQUE (tenant_id, journey_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_journey_refs
    ON journey_references (journey_id, tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_journey_refs_target
    ON journey_references (kind, ref_id, tenant_id);

-- ─── journey_events ───────────────────────────────────────────────────────────
-- Engine-local append-only event log. Ordered by (occurred_at, id).

CREATE TABLE IF NOT EXISTS journey_events (
    id          UUID        NOT NULL PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    journey_id  UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    event_type  TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}',
    ref_kind    TEXT,
    ref_id      TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    caused_by   TEXT,

    CONSTRAINT jevt_tenant_not_empty CHECK (char_length(tenant_id) > 0),
    CONSTRAINT jevt_type_not_empty   CHECK (char_length(event_type) > 0)
);

CREATE INDEX IF NOT EXISTS idx_journey_events_stream
    ON journey_events (journey_id, tenant_id, occurred_at, id);

-- ─── journey_projections ──────────────────────────────────────────────────────
-- Engine-owned operational read model. NOT the canonical projections table.
-- projection_type stores the literal 'journey_state'. One row per journey.

CREATE TABLE IF NOT EXISTS journey_projections (
    journey_id      UUID        NOT NULL PRIMARY KEY REFERENCES journeys(id) ON DELETE CASCADE,
    tenant_id       TEXT        NOT NULL,
    projection_type TEXT        NOT NULL DEFAULT 'journey_state',
    lifecycle       TEXT        NOT NULL,
    intent          TEXT,
    obstacle        TEXT,
    actor           TEXT,
    work_summary    JSONB       NOT NULL DEFAULT '[]',
    next_step       JSONB,
    human_handoff   JSONB,
    last_event_id   TEXT,
    projected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT jproj_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_journey_projections_tenant
    ON journey_projections (tenant_id, lifecycle);

-- ─── journey_capability_tokens ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journey_capability_tokens (
    token       TEXT        NOT NULL PRIMARY KEY,
    journey_id  UUID        NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    tenant_id   TEXT        NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,
    revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
    revoked_at  TIMESTAMPTZ,

    CONSTRAINT jtoken_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_journey_tokens_lookup
    ON journey_capability_tokens (token, tenant_id)
    WHERE revoked = FALSE;
CREATE INDEX IF NOT EXISTS idx_journey_tokens_journey
    ON journey_capability_tokens (journey_id, tenant_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE journeys                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_references        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_projections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_capability_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='journeys' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON journeys USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='journey_references' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON journey_references USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='journey_events' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON journey_events USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='journey_projections' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON journey_projections USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='journey_capability_tokens' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON journey_capability_tokens USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('011') ON CONFLICT (version) DO NOTHING;
