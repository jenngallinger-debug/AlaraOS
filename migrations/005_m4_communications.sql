-- Alara OS — Migration 005: M4 Communication Engine
--
-- Communications are first-class objects with full lifecycle tracking.
-- Every state change is event-sourced (events table from migration 001).
-- ADR-001: no clinical content in communications.
-- ADR-015: communications are human-authorized; AI may draft but not send autonomously.

CREATE TABLE IF NOT EXISTS communications (
    id              UUID        NOT NULL PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    channel         TEXT        NOT NULL
                    CHECK (channel IN ('internal','patient','family','physician','referral_source')),
    purpose         TEXT        NOT NULL,
    subject_id      UUID        NOT NULL REFERENCES objects(id),
    workflow_id     UUID        REFERENCES workflows(id),
    recipient_type  TEXT        NOT NULL,
    recipient_id    TEXT        NOT NULL,
    subject         TEXT        NOT NULL,
    body            TEXT        NOT NULL DEFAULT '',
    status          TEXT        NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created','queued','sent','delivered','failed')),
    queued_at       TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    failure_reason  TEXT,
    adapter_used    TEXT,
    version         INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT comm_tenant_not_empty    CHECK (char_length(tenant_id) > 0),
    CONSTRAINT comm_recipient_not_empty CHECK (char_length(recipient_id) > 0),
    CONSTRAINT comm_subject_not_empty   CHECK (char_length(subject) > 0)
);

CREATE INDEX IF NOT EXISTS idx_communications_tenant_status ON communications (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_communications_subject       ON communications (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_communications_workflow      ON communications (workflow_id) WHERE workflow_id IS NOT NULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'communications_set_updated_at') THEN
        CREATE TRIGGER communications_set_updated_at BEFORE UPDATE ON communications
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- RLS
ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='communications' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON communications
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('005') ON CONFLICT (version) DO NOTHING;
