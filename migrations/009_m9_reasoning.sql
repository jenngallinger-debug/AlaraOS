-- Alara OS — Migration 009: M9 Reasoning Engine
--
-- Constitutional alignment:
--   ADR-003 AI Last: Reasoning called after deterministic logic (M8 Brain).
--   ADR-015: All reasoning outputs are ADVISORY. No direct action.
--   ADR-016: ReasoningSummaryProjection is a Computed Projection.
--
-- Four tables:
--   hypotheses:          possible explanations for observed patterns
--   recommendations:     action suggestions evaluated by Rules Engine
--   narratives:          structured narratives generated from evidence
--   missing_information: identified gaps in available information

-- ─── hypotheses ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hypotheses (
    id                      UUID        NOT NULL PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    subject_id              TEXT        NOT NULL,
    subject_type            TEXT        NOT NULL,
    statement               TEXT        NOT NULL,
    rationale               TEXT        NOT NULL,
    evidence                JSONB       NOT NULL DEFAULT '{}',
    confidence              JSONB       NOT NULL DEFAULT '{}',
    alternative_explanations JSONB      NOT NULL DEFAULT '[]',
    category                TEXT        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'confirmed', 'refuted', 'superseded')),
    model_identifier        TEXT        NOT NULL,
    generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                 INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),

    CONSTRAINT hyp_tenant_not_empty    CHECK (char_length(tenant_id) > 0),
    CONSTRAINT hyp_subject_not_empty   CHECK (char_length(subject_id) > 0),
    CONSTRAINT hyp_statement_not_empty CHECK (char_length(statement) > 0)
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_subject
    ON hypotheses (tenant_id, subject_id, status, generated_at DESC);

-- ─── recommendations ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recommendations (
    id                          UUID        NOT NULL PRIMARY KEY,
    tenant_id                   TEXT        NOT NULL,
    subject_id                  TEXT        NOT NULL,
    subject_type                TEXT        NOT NULL,
    title                       TEXT        NOT NULL,
    rationale                   TEXT        NOT NULL,
    action_type                 TEXT        NOT NULL,
    action                      JSONB       NOT NULL DEFAULT '{}',
    evidence                    JSONB       NOT NULL DEFAULT '{}',
    confidence                  JSONB       NOT NULL DEFAULT '{}',
    priority                    TEXT        NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    status                      TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'rejected', 'superseded', 'acted_upon')),
    rules_engine_approved       BOOLEAN,
    rules_engine_explanation    TEXT,
    model_identifier            TEXT        NOT NULL,
    generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                     INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT rec_tenant_not_empty  CHECK (char_length(tenant_id) > 0),
    CONSTRAINT rec_subject_not_empty CHECK (char_length(subject_id) > 0),
    CONSTRAINT rec_title_not_empty   CHECK (char_length(title) > 0)
);

CREATE INDEX IF NOT EXISTS idx_recommendations_subject
    ON recommendations (tenant_id, subject_id, status, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_approved
    ON recommendations (tenant_id, status)
    WHERE status = 'approved';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'recommendations_set_updated_at') THEN
        CREATE TRIGGER recommendations_set_updated_at BEFORE UPDATE ON recommendations
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── narratives ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS narratives (
    id              UUID        NOT NULL PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    subject_id      TEXT        NOT NULL,
    subject_type    TEXT        NOT NULL,
    narrative_type  TEXT        NOT NULL
                    CHECK (narrative_type IN (
                        'referral_summary', 'patient_summary', 'physician_summary',
                        'case_summary', 'organizational_summary'
                    )),
    sections        JSONB       NOT NULL DEFAULT '[]',
    evidence        JSONB       NOT NULL DEFAULT '{}',
    confidence      JSONB       NOT NULL DEFAULT '{}',
    model_identifier TEXT       NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version         INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),

    CONSTRAINT nar_tenant_not_empty  CHECK (char_length(tenant_id) > 0),
    CONSTRAINT nar_subject_not_empty CHECK (char_length(subject_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_narratives_subject
    ON narratives (tenant_id, subject_id, narrative_type, generated_at DESC);

-- ─── missing_information ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS missing_information (
    id               UUID        NOT NULL PRIMARY KEY,
    tenant_id        TEXT        NOT NULL,
    subject_id       TEXT        NOT NULL,
    subject_type     TEXT        NOT NULL,
    question         TEXT        NOT NULL,
    importance       TEXT        NOT NULL DEFAULT 'medium'
                     CHECK (importance IN ('critical', 'high', 'medium', 'low')),
    category         TEXT        NOT NULL,
    why_needed       TEXT        NOT NULL,
    how_to_obtain    TEXT        NOT NULL,
    evidence         JSONB       NOT NULL DEFAULT '{}',
    status           TEXT        NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'answered', 'not_obtainable')),
    model_identifier TEXT        NOT NULL,
    generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version          INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),

    CONSTRAINT mi_tenant_not_empty   CHECK (char_length(tenant_id) > 0),
    CONSTRAINT mi_subject_not_empty  CHECK (char_length(subject_id) > 0),
    CONSTRAINT mi_question_not_empty CHECK (char_length(question) > 0)
);

CREATE INDEX IF NOT EXISTS idx_missing_information_subject
    ON missing_information (tenant_id, subject_id, status);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE hypotheses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE narratives         ENABLE ROW LEVEL SECURITY;
ALTER TABLE missing_information ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hypotheses' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON hypotheses USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='recommendations' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON recommendations USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='narratives' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON narratives USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='missing_information' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON missing_information USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('009') ON CONFLICT (version) DO NOTHING;
