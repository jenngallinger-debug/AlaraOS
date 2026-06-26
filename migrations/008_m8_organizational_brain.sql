-- Alara OS — Migration 008: M8 Organizational Brain
--
-- Constitutional alignment: "The organization continuously becomes more capable." (Learn)
-- The Brain observes patterns. It does not decide or execute.
--
-- detected_patterns: first-class pattern objects
--   - UUID, category, title, description, evidence
--   - confidence, severity, status
--   - detector provenance
--   - versioned with history
--
-- Pattern lifecycle: active → resolved | dismissed | superseded
-- Patterns are organizational memory — never hard-deleted.

CREATE TABLE IF NOT EXISTS detected_patterns (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    category            TEXT        NOT NULL
                        CHECK (category IN (
                            'relationship', 'workflow', 'knowledge',
                            'journey', 'community', 'organizational'
                        )),
    title               TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    subject_id          TEXT        NOT NULL,
    subject_type        TEXT        NOT NULL,
    evidence            JSONB       NOT NULL DEFAULT '{}',
    confidence          TEXT        NOT NULL DEFAULT 'low'
                        CHECK (confidence IN ('high', 'medium', 'low')),
    severity            TEXT        NOT NULL DEFAULT 'info'
                        CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'resolved', 'superseded', 'dismissed')),
    detector_id         TEXT        NOT NULL,
    detector_version    TEXT        NOT NULL,
    superseded_by_id    UUID        REFERENCES detected_patterns(id),
    first_detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT dp_tenant_not_empty    CHECK (char_length(tenant_id) > 0),
    CONSTRAINT dp_subject_not_empty   CHECK (char_length(subject_id) > 0),
    CONSTRAINT dp_title_not_empty     CHECK (char_length(title) > 0),
    CONSTRAINT dp_detector_not_empty  CHECK (char_length(detector_id) > 0)
);

-- Active patterns by subject (the primary query)
CREATE INDEX IF NOT EXISTS idx_patterns_active_subject
    ON detected_patterns (tenant_id, subject_id, status, category)
    WHERE status = 'active';

-- By detector + subject (deduplication check)
CREATE UNIQUE INDEX IF NOT EXISTS idx_patterns_detector_subject_active
    ON detected_patterns (tenant_id, detector_id, subject_id)
    WHERE status = 'active';

-- By severity (for health dashboard)
CREATE INDEX IF NOT EXISTS idx_patterns_severity
    ON detected_patterns (tenant_id, severity, status)
    WHERE status = 'active';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'detected_patterns_set_updated_at') THEN
        CREATE TRIGGER detected_patterns_set_updated_at BEFORE UPDATE ON detected_patterns
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- RLS
ALTER TABLE detected_patterns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='detected_patterns' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON detected_patterns
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

COMMENT ON TABLE detected_patterns IS
    'M8 Organizational Brain: pattern objects detected by deterministic detectors. '
    'Advisory only. Brain may observe/publish but never executes or assigns tasks.';

INSERT INTO schema_migrations (version) VALUES ('008') ON CONFLICT (version) DO NOTHING;
