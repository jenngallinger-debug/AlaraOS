-- Alara OS — Migration 010: M10 Workforce Intelligence & Coordination Engine
--
-- Constitutional alignment:
--   "Technology exists to carry organizational burden so people can carry
--    human responsibility." (Part XI)
--
-- The engine answers: "Who should do the work?"
-- It coordinates people. It never performs work.
--
-- Tables:
--   workforce_members      — operating identity; HR is external source of truth
--   workforce_availability — real-time availability and capacity state
--   assignments            — assignment lifecycle from recommendation to completion
--   capacity_snapshots     — historical capacity audit trail
--   workforce_teams        — team groupings

-- ─── workforce_members ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workforce_members (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    display_name        TEXT        NOT NULL,
    role                TEXT        NOT NULL
                        CHECK (role IN (
                            'care_guide', 'clinical_coordinator', 'intake_specialist',
                            'scheduler', 'quality_reviewer', 'supervisor', 'administrator'
                        )),
    status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'on_leave', 'unavailable')),
    team_id             UUID,
    supervisor_id       UUID        REFERENCES workforce_members(id),
    external_hr_id      TEXT,       -- external source of truth; AlaraOS never owns HR data
    skill_profile       JSONB       NOT NULL DEFAULT '{}',
    coverage_area       JSONB       NOT NULL DEFAULT '{}',
    escalation_path_id  UUID,
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT wm_tenant_not_empty    CHECK (char_length(tenant_id) > 0),
    CONSTRAINT wm_name_not_empty      CHECK (char_length(display_name) > 0)
);

CREATE INDEX IF NOT EXISTS idx_workforce_active
    ON workforce_members (tenant_id, status, role)
    WHERE status = 'active';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workforce_members_set_updated_at') THEN
        CREATE TRIGGER workforce_members_set_updated_at BEFORE UPDATE ON workforce_members
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── workforce_availability ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workforce_availability (
    member_id           UUID        NOT NULL,
    tenant_id           TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'busy', 'at_capacity', 'on_leave', 'offline')),
    current_load        INTEGER     NOT NULL DEFAULT 0 CHECK (current_load >= 0),
    max_load            INTEGER     NOT NULL DEFAULT 10 CHECK (max_load >= 0),
    next_available_at   TIMESTAMPTZ,
    unavailable_until   TIMESTAMPTZ,
    snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT wa_tenant_not_empty CHECK (char_length(tenant_id) > 0),
    PRIMARY KEY (member_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_status
    ON workforce_availability (tenant_id, status)
    WHERE status = 'available';

-- ─── assignments ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assignments (
    id                      UUID        NOT NULL PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    subject_id              TEXT        NOT NULL,
    subject_type            TEXT        NOT NULL,
    assignee_id             UUID        NOT NULL,
    assignee_name           TEXT        NOT NULL,
    priority                TEXT        NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    status                  TEXT        NOT NULL DEFAULT 'recommended'
                            CHECK (status IN (
                                'recommended', 'approved', 'accepted',
                                'declined', 'transferred', 'completed', 'escalated'
                            )),
    reason                  TEXT        NOT NULL,
    evidence                JSONB       NOT NULL DEFAULT '{}',
    confidence              TEXT        NOT NULL DEFAULT 'medium'
                            CHECK (confidence IN ('high', 'medium', 'low')),
    transferred_from_id     UUID,
    rules_engine_approved   BOOLEAN,
    rules_engine_explanation TEXT,
    due_at                  TIMESTAMPTZ,
    accepted_at             TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    version                 INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT asgn_tenant_not_empty   CHECK (char_length(tenant_id) > 0),
    CONSTRAINT asgn_subject_not_empty  CHECK (char_length(subject_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_assignments_subject
    ON assignments (tenant_id, subject_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_assignee
    ON assignments (tenant_id, assignee_id, status)
    WHERE status IN ('approved', 'accepted');

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'assignments_set_updated_at') THEN
        CREATE TRIGGER assignments_set_updated_at BEFORE UPDATE ON assignments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── capacity_snapshots ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capacity_snapshots (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    member_id           UUID        NOT NULL,
    current_load        INTEGER     NOT NULL,
    max_load            INTEGER     NOT NULL,
    utilization_rate    NUMERIC(4,3) NOT NULL,
    active_assignment_ids JSONB     NOT NULL DEFAULT '[]',
    snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER     NOT NULL DEFAULT 1,

    CONSTRAINT cs_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_capacity_member
    ON capacity_snapshots (tenant_id, member_id, snapshot_at DESC);

-- ─── workforce_teams ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workforce_teams (
    id              UUID        NOT NULL PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    lead_id         UUID        REFERENCES workforce_members(id),
    member_ids      JSONB       NOT NULL DEFAULT '[]',
    specializations JSONB       NOT NULL DEFAULT '[]',
    version         INTEGER     NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT wt_tenant_not_empty CHECK (char_length(tenant_id) > 0),
    CONSTRAINT wt_name_not_empty   CHECK (char_length(name) > 0)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE workforce_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_teams      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workforce_members' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON workforce_members USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workforce_availability' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON workforce_availability USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='assignments' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON assignments USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='capacity_snapshots' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON capacity_snapshots USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workforce_teams' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON workforce_teams USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('010') ON CONFLICT (version) DO NOTHING;
