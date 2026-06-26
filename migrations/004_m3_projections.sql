-- Alara OS — Migration 004: M3 Projection Engine
--
-- ADR-016: A Computed Projection is a derived, recalculable, non-authoritative
-- representation. It may be cached or materialized, but it owns no source data,
-- carries no independent identity, and must be fully regenerable from canonical
-- inputs. Discarding a projection loses no truth.
--
-- The projections table IS a cache. Truncating it loses no truth.

CREATE TABLE IF NOT EXISTS projections (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id        TEXT        NOT NULL,
    -- ADR-016: projection type + subject uniquely identify a projection
    projection_type  TEXT        NOT NULL,
    subject_id       TEXT        NOT NULL,   -- Alara UUID or composite key

    -- ADR-016 mandatory dependency declaration fields
    method_name      TEXT        NOT NULL,
    method_version   TEXT        NOT NULL,
    canonical_inputs JSONB       NOT NULL DEFAULT '[]', -- ProjectionDependency[]
    source_event_ids JSONB       NOT NULL DEFAULT '[]', -- string[]

    -- ADR-016 confidence + provenance
    confidence       TEXT        NOT NULL DEFAULT 'unknown'
                     CHECK (confidence IN ('high', 'moderate', 'low', 'unknown')),
    inference_basis  TEXT        NOT NULL DEFAULT 'fact'
                     CHECK (inference_basis IN ('fact', 'inference', 'estimate', 'ai_generated')),
    ai_involved      BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Freshness
    fresh_until      TIMESTAMPTZ,
    last_built_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    build_number     INTEGER     NOT NULL DEFAULT 1,

    -- The computed value — disposable; deleting this table loses no truth
    value            JSONB       NOT NULL DEFAULT '{}',

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id),
    -- Each (tenant, type, subject) has at most one cached projection
    CONSTRAINT projections_unique UNIQUE (tenant_id, projection_type, subject_id),

    CONSTRAINT proj_type_valid CHECK (projection_type IN (
        'Timeline', 'DigitalCareTwin', 'ReferralSourceStrength', 'RelationshipHealth'
    )),
    CONSTRAINT proj_method_not_empty  CHECK (char_length(method_name) > 0),
    CONSTRAINT proj_version_not_empty CHECK (char_length(method_version) > 0)
);

CREATE INDEX IF NOT EXISTS idx_projections_tenant_type
    ON projections (tenant_id, projection_type);

CREATE INDEX IF NOT EXISTS idx_projections_subject
    ON projections (tenant_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_projections_stale
    ON projections (tenant_id, fresh_until)
    WHERE fresh_until IS NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'projections_set_updated_at') THEN
        CREATE TRIGGER projections_set_updated_at BEFORE UPDATE ON projections
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- RLS
ALTER TABLE projections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename='projections' AND policyname='tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON projections
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

-- ADR-016 constraint comment: this table is a CACHE.
-- It can be safely truncated without data loss.
-- All projections are regenerable from the events table.
COMMENT ON TABLE projections IS
    'ADR-016: Computed Projection cache. Disposable — truncating loses no truth. '
    'Rebuild any projection by replaying its declared canonical inputs.';

INSERT INTO schema_migrations (version) VALUES ('004') ON CONFLICT (version) DO NOTHING;
