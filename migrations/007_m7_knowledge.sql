-- Alara OS — Migration 007: M7 Knowledge Engine
--
-- Constitutional alignment: "The organization continuously becomes more capable."
-- (Learn behavior — Part XI)
--
-- observations: append-only perceived facts from the environment
-- knowledge_entries: versioned, assertable organizational knowledge
--
-- ADR-001: NO clinical content (visit notes, assessments, POC, orders).
--   Enforced at application layer AND documented here.
-- ADR-015: AI-involved entries flagged (ai_involved column). Humans accountable.

-- ─── observations ─────────────────────────────────────────────────────────────
-- Append-only. Observations describe what was seen, not conclusions.
-- Source: Automynd events, workflow outcomes, human assertions, inference chains.

CREATE TABLE IF NOT EXISTS observations (
    id                      UUID        NOT NULL PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    subject_id              TEXT        NOT NULL,  -- Alara UUID of the subject
    subject_type            TEXT        NOT NULL,
    topic                   TEXT        NOT NULL
                            CHECK (topic IN (
                                'eligibility', 'referral_pattern', 'clinical_need',
                                'care_coordination', 'data_integrity', 'relationship_quality',
                                'promise_reliability', 'communication_quality',
                                'workflow_efficiency', 'organizational_risk',
                                'patient_context', 'program_context'
                            )),
    statement               TEXT        NOT NULL,  -- human-readable statement
    facts                   JSONB       NOT NULL DEFAULT '{}',  -- structured facts (no clinical content)
    source                  TEXT        NOT NULL
                            CHECK (source IN (
                                'AutomyndEvent', 'WorkflowOutcome', 'PromiseOutcome',
                                'TaskOutcome', 'CommunicationEvent', 'RelationshipEvent',
                                'HumanAssertion', 'InferenceChain'
                            )),
    confidence              TEXT        NOT NULL DEFAULT 'possible'
                            CHECK (confidence IN ('confirmed', 'probable', 'possible', 'speculative')),
    ai_involved             BOOLEAN     NOT NULL DEFAULT FALSE,
    source_event_ids        JSONB       NOT NULL DEFAULT '[]',
    source_observation_ids  JSONB       NOT NULL DEFAULT '[]',
    actor                   TEXT        NOT NULL,
    version                 INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT obs_tenant_not_empty   CHECK (char_length(tenant_id) > 0),
    CONSTRAINT obs_subject_not_empty  CHECK (char_length(subject_id) > 0),
    CONSTRAINT obs_statement_not_empty CHECK (char_length(statement) > 0),
    -- ADR-001 documentation: clinical keys must not appear in facts
    -- Enforcement is at application layer (KnowledgeEngine.enforceClinicalBoundary)
    CONSTRAINT obs_no_clinical_visit_notes
        CHECK (facts -> 'visitNotes' IS NULL),
    CONSTRAINT obs_no_clinical_assessment
        CHECK (facts -> 'assessmentText' IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_observations_subject
    ON observations (tenant_id, subject_id, topic, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_source
    ON observations (tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_observations_confidence
    ON observations (tenant_id, confidence);

-- ─── knowledge_entries ────────────────────────────────────────────────────────
-- Versioned, assertable organizational knowledge.
-- Can be superseded (replaced by better knowledge) or retracted (was wrong).
-- Active entries represent the organization's current understanding.

CREATE TABLE IF NOT EXISTS knowledge_entries (
    id                          UUID        NOT NULL PRIMARY KEY,
    tenant_id                   TEXT        NOT NULL,
    subject_id                  TEXT        NOT NULL,
    subject_type                TEXT        NOT NULL,
    topic                       TEXT        NOT NULL
                                CHECK (topic IN (
                                    'eligibility', 'referral_pattern', 'clinical_need',
                                    'care_coordination', 'data_integrity', 'relationship_quality',
                                    'promise_reliability', 'communication_quality',
                                    'workflow_efficiency', 'organizational_risk',
                                    'patient_context', 'program_context'
                                )),
    kind                        TEXT        NOT NULL
                                CHECK (kind IN ('fact', 'inference', 'policy', 'preference', 'risk')),
    status                      TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'superseded', 'retracted')),
    statement                   TEXT        NOT NULL,  -- human-readable knowledge statement
    content                     JSONB       NOT NULL DEFAULT '{}',  -- structured content (no clinical)
    confidence                  TEXT        NOT NULL DEFAULT 'possible'
                                CHECK (confidence IN ('confirmed', 'probable', 'possible', 'speculative')),
    ai_involved                 BOOLEAN     NOT NULL DEFAULT FALSE,
    supporting_observation_ids  JSONB       NOT NULL DEFAULT '[]',
    superseded_by_id            UUID        REFERENCES knowledge_entries(id),
    asserted_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asserted_by                 TEXT        NOT NULL,
    expires_at                  TIMESTAMPTZ,  -- NULL = never expires
    version                     INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ke_tenant_not_empty    CHECK (char_length(tenant_id) > 0),
    CONSTRAINT ke_subject_not_empty   CHECK (char_length(subject_id) > 0),
    CONSTRAINT ke_statement_not_empty CHECK (char_length(statement) > 0),
    CONSTRAINT ke_no_clinical_visit_notes
        CHECK (content -> 'visitNotes' IS NULL),
    CONSTRAINT ke_no_clinical_assessment
        CHECK (content -> 'assessmentText' IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_active
    ON knowledge_entries (tenant_id, subject_id, status, topic)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_subject
    ON knowledge_entries (tenant_id, subject_id, asserted_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_expiry
    ON knowledge_entries (tenant_id, expires_at)
    WHERE expires_at IS NOT NULL AND status = 'active';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_entries_set_updated_at') THEN
        CREATE TRIGGER knowledge_entries_set_updated_at BEFORE UPDATE ON knowledge_entries
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE observations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='observations' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON observations
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='knowledge_entries' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON knowledge_entries
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('007') ON CONFLICT (version) DO NOTHING;
