-- Alara OS — Migration 006: M6 Relationship Engine
--
-- Constitutional alignment:
--   ADR-014: "Identity is stable. Participation changes."
--   Part XI: Care Team is a VIEW over active edges, not an object.
--   BD-013: Relationship IS an object with independent identity.
--
-- relationships: the relationship aggregate (has UUID, version, state, events)
-- edges: participation edges connecting participants to relationships
--
-- Care Team is NEVER stored here. It is computed from active edges on demand.
-- Relationship Health is in the projections table (migration 004).

-- ─── relationships ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS relationships (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    type                TEXT        NOT NULL
                        CHECK (type IN (
                            'CareTeam', 'ReferralSource', 'FamilyMember',
                            'Physician', 'CoverageRelationship',
                            'PatientCareGuide', 'ProgramEnrollment'
                        )),
    status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'terminated', 'pending')),
    subject_id          UUID        NOT NULL REFERENCES objects(id),
    description         TEXT        NOT NULL DEFAULT '',
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminated_at       TIMESTAMPTZ,
    termination_reason  TEXT,

    CONSTRAINT rel_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_relationships_tenant_status
    ON relationships (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_relationships_subject
    ON relationships (tenant_id, subject_id);

CREATE INDEX IF NOT EXISTS idx_relationships_type
    ON relationships (tenant_id, type, status);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'relationships_set_updated_at') THEN
        CREATE TRIGGER relationships_set_updated_at BEFORE UPDATE ON relationships
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── edges ────────────────────────────────────────────────────────────────────
-- Participation edges. Each edge connects a Participant to a Relationship
-- with a specific ParticipationRole (ADR-014).
-- "Identity is stable. Participation changes."
-- Edges are soft-deleted (active = false) when a participant leaves.

CREATE TABLE IF NOT EXISTS edges (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    relationship_id     UUID        NOT NULL REFERENCES relationships(id),
    participant_id      TEXT        NOT NULL,  -- Alara UUID of WorkforceMember/ExternalOrg
    participant_type    TEXT        NOT NULL
                        CHECK (participant_type IN ('WorkforceMember', 'ExternalOrg', 'Patient')),
    role                TEXT        NOT NULL
                        CHECK (role IN ('Actor', 'Owner', 'Covering', 'Stakeholder', 'Informed', 'Observer')),
    active              BOOLEAN     NOT NULL DEFAULT TRUE,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at            TIMESTAMPTZ,
    coverage_expires_at TIMESTAMPTZ,          -- Required for Covering role
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),

    CONSTRAINT edge_tenant_not_empty        CHECK (char_length(tenant_id) > 0),
    CONSTRAINT edge_participant_not_empty   CHECK (char_length(participant_id) > 0),
    -- Covering role must have coverage_expires_at
    CONSTRAINT edge_covering_requires_expiry
        CHECK (role != 'Covering' OR coverage_expires_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_edges_relationship
    ON edges (tenant_id, relationship_id, active);

CREATE INDEX IF NOT EXISTS idx_edges_participant
    ON edges (tenant_id, participant_id, active);

-- Care Team query: all active edges for a patient's active relationships
CREATE INDEX IF NOT EXISTS idx_edges_care_team_query
    ON edges (tenant_id, active, role);

-- ─── Add relationship_type to projections validity check ───────────────────────
-- The projections table already allows 'RelationshipHealth' from migration 004.
-- No change needed.

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges         ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='relationships' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON relationships
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='edges' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON edges
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('006') ON CONFLICT (version) DO NOTHING;
