-- Alara OS — Migration 003: M2 Workflow / Task / Promise Spine
-- Constitutional alignment:
--   Part XI: Workflow, Task (via Promise), Promise are primary objects
--   "No workflow becomes lost." "Patients should never remind Alara about promises."
--   Every state change is event-sourced (events table from migration 001).

-- ─── workflows ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    template_id         TEXT        NOT NULL,
    template_version    TEXT        NOT NULL DEFAULT '1.0.0',
    name                TEXT        NOT NULL,
    for_object_id       UUID        NOT NULL REFERENCES objects(id),
    for_object_type     TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','paused','completed','suppressed','failed')),
    current_step_id     TEXT,
    owner_id            TEXT        NOT NULL,
    steps               JSONB       NOT NULL DEFAULT '[]',
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    suppression_reason  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT wf_tenant_not_empty   CHECK (char_length(tenant_id) > 0),
    CONSTRAINT wf_owner_not_empty    CHECK (char_length(owner_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_workflows_tenant_status  ON workflows (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_workflows_for_object     ON workflows (tenant_id, for_object_id);
CREATE INDEX IF NOT EXISTS idx_workflows_owner          ON workflows (tenant_id, owner_id);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflows_set_updated_at') THEN
        CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON workflows
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── tasks ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    task_type           TEXT        NOT NULL,
    title               TEXT        NOT NULL,
    description         TEXT        NOT NULL DEFAULT '',
    workflow_id         UUID        REFERENCES workflows(id),
    workflow_step_id    TEXT,
    owner_id            TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','completed','overdue','escalated','cancelled')),
    due_at              TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    escalated_at        TIMESTAMPTZ,
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT task_tenant_not_empty  CHECK (char_length(tenant_id) > 0),
    CONSTRAINT task_owner_not_empty   CHECK (char_length(owner_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status  ON tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner          ON tasks (tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow       ON tasks (workflow_id) WHERE workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_at         ON tasks (tenant_id, due_at) WHERE status = 'open';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tasks_set_updated_at') THEN
        CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── promises ─────────────────────────────────────────────────────────────────
-- "Every promise made by Alara becomes an object." (Part XI)

CREATE TABLE IF NOT EXISTS promises (
    id                  UUID        NOT NULL PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    subject_id          UUID        NOT NULL,   -- Patient / subject Alara UUID
    recipient_id        TEXT        NOT NULL,   -- family member, referral source, etc.
    owner_id            TEXT        NOT NULL,   -- workforce member responsible
    status              TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','kept','missed','voided')),
    due_at              TIMESTAMPTZ NOT NULL,
    kept_at             TIMESTAMPTZ,
    missed_at           TIMESTAMPTZ,
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    workflow_id         UUID        REFERENCES workflows(id),
    workflow_step_id    TEXT,
    version             INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT promise_tenant_not_empty    CHECK (char_length(tenant_id) > 0),
    CONSTRAINT promise_desc_not_empty      CHECK (char_length(description) > 0)
);

CREATE INDEX IF NOT EXISTS idx_promises_tenant_status ON promises (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_promises_subject       ON promises (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_promises_due           ON promises (tenant_id, due_at) WHERE status = 'open';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'promises_set_updated_at') THEN
        CREATE TRIGGER promises_set_updated_at BEFORE UPDATE ON promises
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE promises  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='workflows' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON workflows USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tasks' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON tasks USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promises' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON promises USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('003') ON CONFLICT (version) DO NOTHING;
