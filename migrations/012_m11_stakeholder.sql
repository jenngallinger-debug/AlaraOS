-- Alara OS — Migration 012: M11 Stakeholder Object
--
-- Constitutional alignment:
--   "Technology exists to carry organizational burden so people can carry
--    human responsibility." (Part XI — Platform Design Philosophy)
--
-- BD-013 Objecthood (Architect ratified):
--   Stakeholder is a first-class Object with independent identity, durable
--   state, relationships, event history, and behavior.
--
-- Stakeholder OWNS:
--   type, display/contact identity, durable consent state, consent scope,
--   communication preferences, promise profile, active status.
--
-- Stakeholder REFERENCES (never owns):
--   Patient · Organization · WorkforceMember · Journey · Referral ·
--   Communication logs · Tasks
--
-- Internal vs external (Architect ratified):
--   is_internal stored as classification; internal stakeholders receive
--   tasks, external receive communications. Does NOT grant permissions.
--
-- Consent convergence (Architect ratified):
--   Stakeholder owns durable consent state. ConsentPolicyModule reads
--   stakeholder consent via getConsentFact() to produce a ConsentFact.
--
-- Promise profile (Architect ratified):
--   Owned configuration on Stakeholder. Distinct from Promise Engine
--   individual commitments. Seeded from type defaults at creation.
--
-- Tables:
--   stakeholders                — the Stakeholder Object
--   stakeholder_preferences     — per-category channel/cadence opt-in
--   stakeholder_promise_profiles — the standing relational contract

-- ─── stakeholders ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stakeholders (
    id                      UUID        NOT NULL PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,

    -- Reference to Patient (Stakeholder does not own Patient)
    patient_id              UUID        NOT NULL,

    -- OWNED: type / classification
    type                    TEXT        NOT NULL
                            CHECK (type IN (
                                'patient', 'family', 'physician', 'case_manager',
                                'discharge_planner', 'dol_resource_center', 'attorney',
                                'authorized_rep', 'owcp_nurse_cm', 'employer_feca',
                                'care_guide', 'auth_specialist', 'don'
                            )),
    is_internal             BOOLEAN     NOT NULL DEFAULT FALSE,

    -- OWNED: display identity + contact identity for coordination
    display_name            TEXT,
    organization_name       TEXT,
    email                   TEXT,
    phone                   TEXT,
    fax                     TEXT,

    -- OWNED: durable consent state
    -- ConsentPolicyModule reads these columns via getConsentFact()
    consent_status          TEXT        NOT NULL DEFAULT 'unknown'
                            CHECK (consent_status IN ('unknown', 'granted', 'restricted', 'revoked')),
    consent_scope           TEXT        NOT NULL DEFAULT 'status',
    consent_granted_at      TIMESTAMPTZ,
    consent_revoked_at      TIMESTAMPTZ,
    consent_expires_at      TIMESTAMPTZ,
    consent_granted_by      TEXT,

    -- Reference to WorkforceMember (for internal stakeholders)
    workforce_member_ref    UUID,

    -- OWNED: active / inactive
    active                  BOOLEAN     NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version                 INTEGER     NOT NULL DEFAULT 1,

    CONSTRAINT sh_tenant_not_empty  CHECK (char_length(tenant_id) > 0),
    CONSTRAINT sh_type_not_empty    CHECK (char_length(type) > 0)
);

CREATE INDEX IF NOT EXISTS idx_stakeholders_patient
    ON stakeholders (patient_id, tenant_id, is_internal, type)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_stakeholders_consent
    ON stakeholders (tenant_id, consent_status, type)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_stakeholders_wm_ref
    ON stakeholders (workforce_member_ref, tenant_id)
    WHERE workforce_member_ref IS NOT NULL;

-- ─── stakeholder_preferences ─────────────────────────────────────────────────
-- OWNED: per-category channel and cadence preferences.
-- One row per (stakeholder, category). 'all' is the default catch-all.

CREATE TABLE IF NOT EXISTS stakeholder_preferences (
    stakeholder_id  UUID        NOT NULL REFERENCES stakeholders(id) ON DELETE CASCADE,
    tenant_id       TEXT        NOT NULL,

    category        TEXT        NOT NULL
                    CHECK (category IN ('all', 'clinical', 'benefits', 'status', 'scheduling')),
    channel         TEXT        NOT NULL
                    CHECK (channel IN ('email', 'sms', 'phone', 'fax', 'portal', 'inapp', 'none')),
    cadence         TEXT        NOT NULL
                    CHECK (cadence IN ('realtime', 'daily_digest', 'weekly', 'on_milestone', 'none')),
    opt_in          BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT sh_pref_pk PRIMARY KEY (stakeholder_id, category)
);

CREATE INDEX IF NOT EXISTS idx_sh_prefs_lookup
    ON stakeholder_preferences (stakeholder_id, tenant_id, category);

-- ─── stakeholder_promise_profiles ────────────────────────────────────────────
-- OWNED: standing relational contract per Stakeholder.
-- Seeded from type defaults at creation; operator-configurable post-creation.
-- Distinct from Promise Engine individual commitments.

CREATE TABLE IF NOT EXISTS stakeholder_promise_profiles (
    stakeholder_id              UUID        NOT NULL PRIMARY KEY
                                REFERENCES stakeholders(id) ON DELETE CASCADE,
    tenant_id                   TEXT        NOT NULL,

    job_to_be_done              TEXT,
    responsibility_transferred  TEXT,
    success_definition          TEXT,
    anxiety_risk                TEXT,
    communication_promise       TEXT,
    update_triggers             TEXT[]      NOT NULL DEFAULT '{}',

    CONSTRAINT sh_profile_tenant_not_empty CHECK (char_length(tenant_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_sh_profiles_tenant
    ON stakeholder_promise_profiles (tenant_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE stakeholders                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholder_preferences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholder_promise_profiles  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename='stakeholders' AND policyname='tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON stakeholders
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename='stakeholder_preferences' AND policyname='tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON stakeholder_preferences
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename='stakeholder_promise_profiles' AND policyname='tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON stakeholder_promise_profiles
            USING (tenant_id = current_setting('app.tenant_id', TRUE));
    END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES ('012') ON CONFLICT (version) DO NOTHING;
