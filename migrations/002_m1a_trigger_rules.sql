-- Alara OS — Migration 002: M1a Trigger + Rules Engine
-- Creates: triggers, rule_sets, rule_audit_log
--
-- Constitutional alignment:
--   Part XI Trigger object: "Should something happen now?"
--   ADR-003: AI is last — rules decide deterministically first
--   ADR-015: AI Act Constraint Register (enforced via PolicyModule)
--   BD-013: Object Doctrine (trigger/rule types are canonical)

-- ─── triggers ────────────────────────────────────────────────────────────────
-- Persistent trigger definitions loaded into TriggerRegistry at startup.

CREATE TABLE IF NOT EXISTS triggers (
    id              TEXT        NOT NULL PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    description     TEXT        NOT NULL DEFAULT '',
    event_types     JSONB       NOT NULL DEFAULT '[]',  -- string[]
    conditions      JSONB       NOT NULL DEFAULT '[]',  -- TriggerCondition[]
    logic           TEXT        NOT NULL DEFAULT 'ALL' CHECK (logic IN ('ALL', 'ANY')),
    rationale       TEXT        NOT NULL DEFAULT '',
    target_rule_set_id TEXT     NOT NULL,
    enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
    priority        INTEGER     NOT NULL DEFAULT 50,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT triggers_name_not_empty    CHECK (char_length(name) > 0),
    CONSTRAINT triggers_priority_positive CHECK (priority >= 0)
);

CREATE INDEX IF NOT EXISTS idx_triggers_tenant
    ON triggers (tenant_id, enabled, priority);

-- Efficient lookup by event type (GIN over JSONB array)
CREATE INDEX IF NOT EXISTS idx_triggers_event_types
    ON triggers USING GIN (event_types);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'triggers_set_updated_at') THEN
        CREATE TRIGGER triggers_set_updated_at
        BEFORE UPDATE ON triggers
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── rule_sets ────────────────────────────────────────────────────────────────
-- Named collections of policy modules. Triggers point to a rule_set_id.

CREATE TABLE IF NOT EXISTS rule_sets (
    id          TEXT        NOT NULL PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    version     TEXT        NOT NULL DEFAULT '1.0.0',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rule_sets_set_updated_at') THEN
        CREATE TRIGGER rule_sets_set_updated_at
        BEFORE UPDATE ON rule_sets
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── rule_audit_log ───────────────────────────────────────────────────────────
-- Append-only audit trail of every Rules Engine evaluation.
-- Constitutional requirement: "everything is auditable" (Part XI Universal Object Rules).
-- ADR-015: every AI-adjacent decision must be traceable.

CREATE TABLE IF NOT EXISTS rule_audit_log (
    id              TEXT        NOT NULL PRIMARY KEY,  -- UUIDv7
    tenant_id       TEXT        NOT NULL,
    actor           TEXT        NOT NULL,
    rule_set_id     TEXT        NOT NULL,
    rule_id         TEXT        NOT NULL,
    outcome         TEXT        NOT NULL CHECK (outcome IN ('ALLOW', 'DENY', 'REQUIRE_HUMAN', 'DEFER')),
    context         JSONB       NOT NULL,
    decision        JSONB       NOT NULL,
    evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT audit_tenant_not_empty CHECK (char_length(tenant_id) > 0),
    CONSTRAINT audit_actor_not_empty  CHECK (char_length(actor) > 0)
);

-- Never update audit entries — enforce at table level
CREATE RULE rule_audit_no_update AS ON UPDATE TO rule_audit_log DO INSTEAD NOTHING;
CREATE RULE rule_audit_no_delete AS ON DELETE TO rule_audit_log DO INSTEAD NOTHING;

-- Reporting indexes
CREATE INDEX IF NOT EXISTS idx_audit_tenant_outcome
    ON rule_audit_log (tenant_id, outcome, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_rule_set
    ON rule_audit_log (tenant_id, rule_set_id, evaluated_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE triggers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_sets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_audit_log   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'triggers' AND policyname = 'tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON triggers
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rule_audit_log' AND policyname = 'tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON rule_audit_log
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

-- ─── Seed built-in rule sets ──────────────────────────────────────────────────

INSERT INTO rule_sets (id, name, description, version) VALUES
    ('ruleset.intake',              'Intake',              'Patient intake evaluation.',         '1.0.0'),
    ('ruleset.workflow.assignment', 'Workflow Assignment', 'Workflow ownership + notification.', '1.0.0'),
    ('ruleset.promise.tracking',    'Promise Tracking',    'Promise creation + deadline.',       '1.0.0'),
    ('ruleset.visit.completed',     'Visit Completed',     'Post-visit evaluation.',             '1.0.0'),
    ('ruleset.data.integrity',      'Data Integrity',      'ADR-001 data conflict routing.',     '1.0.0'),
    ('ruleset.external.sync',       'External Sync',       'ExternalReference sync evaluation.', '1.0.0')
ON CONFLICT (id) DO NOTHING;

-- ─── Migration tracking ───────────────────────────────────────────────────────

INSERT INTO schema_migrations (version) VALUES ('002')
ON CONFLICT (version) DO NOTHING;
