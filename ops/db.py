"""T1 — Migration-ready schema, connection management, and append-only protection.

SQLite is the practical v0 substrate (stdlib, zero-dependency). The schema mirrors
the Postgres implementation spec one-to-one so migration is mechanical:
  * Postgres ENUM  -> TEXT + CHECK(... IN ...)
  * Postgres jsonb -> TEXT holding JSON
  * Postgres bool  -> INTEGER 0/1
  * gen_random_uuid() -> uuid4 generated in Python (ops.core.new_id)

Reserved-word table renames (documented for migration):
  app_user   == spec "user"
  care_order == spec "order"
All other table names match the spec exactly.
"""
import os
import sqlite3

OPS_DIR = os.path.dirname(os.path.abspath(__file__))
ALARA_DIR = os.path.dirname(OPS_DIR)
DATA_DIR = os.path.join(ALARA_DIR, "data")

SCHEMA_VERSION = 2

# --- enum value sets (kept in one place so core.py / services can validate) ----
ENUMS = {
    "role": ("admin", "care_guide", "auth_specialist", "clinician", "don",
             "staffing_coordinator", "ops_lead", "system"),
    "patient_status": ("stub", "identified", "screening", "eligibility_confirmed",
                       "onboarding", "documentation_pending", "authorization_pending",
                       "authorized", "staffing", "care_active", "suspended",
                       "discharged", "deceased", "lost"),
    "entitlement_status": ("unverified", "verifying", "confirmed", "inactive", "expired"),
    "program_code": ("eeoicpa", "owcp_feca", "va_ccn", "medicare"),
    "contact_role": ("family", "poa", "caregiver", "emergency"),
    "referral_source_type": ("physician", "case_manager", "discharge_planner",
                             "attorney", "resource_center", "self", "family"),
    "referral_channel": ("phone", "fax", "email", "portal", "ehr", "other"),
    "referral_status": ("received", "acknowledged", "screening", "accepted",
                        "declined", "converted"),
    "order_status": ("drafted", "sent_for_signature", "signed", "rejected", "expired"),
    "authorization_type": ("initial", "reauth", "expansion"),
    "authorization_status": ("draft", "submitted", "pending", "approved", "denied",
                             "active", "expiring", "renewed", "expired", "appealing"),
    "service_type": ("skilled_nursing", "wound_care", "infusion", "pt", "ot", "aide",
                     "family_aide", "med_management", "care_coordination", "monitoring"),
    "service_status": ("planned", "active", "held", "ended"),
    "visit_status": ("scheduled", "en_route", "in_progress", "completed", "missed",
                     "cancelled", "documented"),
    "task_queue": ("judgment", "exception", "escalation", "review"),
    "task_priority": ("p0", "p1", "p2"),
    "task_status": ("open", "assigned", "in_progress", "completed", "escalated", "cancelled"),
    "document_type": ("sop", "authorization_submission", "order", "consent", "other"),
    "notification_status": ("queued", "sent", "failed"),
    # --- v2: stakeholder trust engine ---
    "stakeholder_type": ("patient", "family", "physician", "case_manager",
                         "discharge_planner", "dol_resource_center", "attorney",
                         "authorized_rep", "owcp_nurse_cm", "employer_feca",
                         "care_guide", "auth_specialist", "don"),
    "channel": ("email", "sms", "phone", "fax", "portal", "inapp", "none"),
    "cadence": ("realtime", "daily_digest", "weekly", "on_milestone", "none"),
    "consent_status": ("unknown", "granted", "restricted", "revoked"),
    "comm_status": ("drafted", "queued", "sent", "failed", "skipped", "suppressed"),
    "delivery_status": ("pending", "delivered", "bounced", "unknown"),
    "delivery_mode": ("auto", "review", "task", "manual"),
    "comm_category": ("clinical", "benefits", "status", "scheduling", "all"),
    "digest_status": ("queued", "sent", "failed"),
    "tone": ("operational", "reassuring", "benefit_execution", "neutral_compliant",
             "task_action"),
    "referral_kind": ("clinical_referral", "website_lead", "internal"),
    "referral_stage": ("received", "under_review", "need_information", "accepted",
                       "authorization_pending", "staffing", "soc_scheduled",
                       "active_care", "closed_declined"),
}


def _check(col, key):
    vals = ",".join("'%s'" % v for v in ENUMS[key])
    return "%s TEXT NOT NULL CHECK(%s IN (%s))" % (col, col, vals)


def _ncheck(col, key):
    """Nullable enum column."""
    vals = ",".join("'%s'" % v for v in ENUMS[key])
    return "%s TEXT CHECK(%s IS NULL OR %s IN (%s))" % (col, col, col, vals)


# Common audit columns appended to every business table.
_AUDIT_COLS = (
    "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), "
    "updated_at TEXT, "
    "created_by TEXT REFERENCES app_user(id), "
    "soft_deleted_at TEXT"
)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  {role_enum},
  email TEXT UNIQUE,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS program (
  id TEXT PRIMARY KEY,
  {program_enum},
  name TEXT NOT NULL,
  UNIQUE(code)
);

CREATE TABLE IF NOT EXISTS patient (
  id TEXT PRIMARY KEY,
  legal_name TEXT,
  dob TEXT,
  mrn_ehr TEXT,
  service_area TEXT,
  {patient_status_enum},
  care_guide_id TEXT REFERENCES app_user(id),
  source_referral_id TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS entitlement (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  program_id TEXT NOT NULL REFERENCES program(id),
  basis TEXT,
  coverage_scope TEXT,
  {ent_status_enum},
  verified_at TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS contact (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  name TEXT NOT NULL,
  relationship TEXT,
  {contact_role_enum},
  phone TEXT,
  email TEXT,
  consent_id TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS referral_source (
  id TEXT PRIMARY KEY,
  {ref_source_type_enum},
  org TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS referral (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patient(id),
  source_id TEXT REFERENCES referral_source(id),
  {ref_channel_enum},
  received_at TEXT NOT NULL,
  payload TEXT,
  {ref_status_enum},
  acknowledged_at TEXT,
  owner_id TEXT REFERENCES app_user(id),
  {audit}
);

CREATE TABLE IF NOT EXISTS care_order (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  provider_id TEXT,
  program_id TEXT REFERENCES program(id),
  {order_status_enum},
  document_id TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS authorization (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  program_id TEXT NOT NULL REFERENCES program(id),
  order_id TEXT REFERENCES care_order(id),
  {auth_type_enum},
  requested_scope TEXT,
  approved_scope TEXT,
  frequency TEXT,
  {auth_status_enum},
  owner_id TEXT NOT NULL REFERENCES app_user(id),
  requested_at TEXT,
  submitted_at TEXT,
  start_date TEXT,
  expiry_date TEXT,
  next_action TEXT,
  next_action_due TEXT,
  denial_reason TEXT,
  submission_document_id TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS service (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES authorization(id),
  {service_type_enum},
  frequency TEXT,
  {service_status_enum},
  {audit}
);

CREATE TABLE IF NOT EXISTS visit (
  id TEXT PRIMARY KEY,
  service_id TEXT REFERENCES service(id),
  patient_id TEXT NOT NULL REFERENCES patient(id),
  clinician_id TEXT REFERENCES app_user(id),
  scheduled_at TEXT,
  completed_at TEXT,
  {visit_status_enum},
  ehr_visit_ref TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS observation (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  visit_id TEXT REFERENCES visit(id),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  structured TEXT NOT NULL,
  note_text TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patient(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  {task_queue_enum},
  role TEXT CHECK(role IS NULL OR role IN ({role_vals})),
  owner_id TEXT NOT NULL REFERENCES app_user(id),
  {task_priority_enum},
  {task_status_enum},
  sla_due TEXT NOT NULL,
  completed_at TEXT,
  context_ref TEXT,
  parent_event_id TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patient(id),
  {doc_type_enum},
  storage_ref TEXT,
  signed INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  version INTEGER,
  approver_id TEXT REFERENCES app_user(id),
  effective_date TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS reauth_config (
  id TEXT PRIMARY KEY,
  threshold_days TEXT NOT NULL DEFAULT '[30,21,14]',
  lead_min_days INTEGER NOT NULL DEFAULT 14
);

CREATE TABLE IF NOT EXISTS notification (
  id TEXT PRIMARY KEY,
  recipient_type TEXT NOT NULL,
  recipient_ref TEXT NOT NULL,
  channel TEXT NOT NULL,
  template TEXT NOT NULL,
  payload TEXT,
  {notif_status_enum},
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  sent_at TEXT
);

-- append-only --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  patient_id TEXT,
  payload TEXT,
  emitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  source TEXT,
  actor_id TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  before TEXT,
  after TEXT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- append-only protection ---------------------------------------------------
CREATE TRIGGER IF NOT EXISTS event_no_update BEFORE UPDATE ON event
  BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS event_no_delete BEFORE DELETE ON event
  BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- indexes ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_patient_status ON patient(status);
CREATE INDEX IF NOT EXISTS ix_entitlement_patient ON entitlement(patient_id);
CREATE INDEX IF NOT EXISTS ix_auth_patient_status ON authorization(patient_id, status);
CREATE INDEX IF NOT EXISTS ix_auth_expiry ON authorization(expiry_date);
CREATE INDEX IF NOT EXISTS ix_task_owner ON task(owner_id, status, sla_due);
CREATE INDEX IF NOT EXISTS ix_task_queue ON task(queue, status);
CREATE INDEX IF NOT EXISTS ix_referral_status ON referral(status, received_at);
CREATE INDEX IF NOT EXISTS ix_observation_patient ON observation(patient_id, recorded_at);
CREATE INDEX IF NOT EXISTS ix_event_patient ON event(patient_id, emitted_at);
CREATE INDEX IF NOT EXISTS ix_audit_object ON audit_log(object_type, object_id, ts);
""".format(
    role_enum=_check("role", "role"),
    role_vals=",".join("'%s'" % v for v in ENUMS["role"]),
    program_enum=_check("code", "program_code"),
    patient_status_enum=_check("status", "patient_status"),
    ent_status_enum=_check("status", "entitlement_status"),
    contact_role_enum=_check("role", "contact_role"),
    ref_source_type_enum=_check("type", "referral_source_type"),
    ref_channel_enum=_check("channel", "referral_channel"),
    ref_status_enum=_check("status", "referral_status"),
    order_status_enum=_check("status", "order_status"),
    auth_type_enum=_check("type", "authorization_type"),
    auth_status_enum=_check("status", "authorization_status"),
    service_type_enum=_check("type", "service_type"),
    service_status_enum=_check("status", "service_status"),
    visit_status_enum=_check("status", "visit_status"),
    task_queue_enum=_check("queue", "task_queue"),
    task_priority_enum=_check("priority", "task_priority"),
    task_status_enum=_check("status", "task_status"),
    doc_type_enum=_check("type", "document_type"),
    notif_status_enum=_check("status", "notification_status"),
    audit=_AUDIT_COLS,
)


# ============================================================================
# v2 — Stakeholder Trust Engine
# ============================================================================
STAKEHOLDER_SQL = """
CREATE TABLE IF NOT EXISTS stakeholder (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  {sh_type},
  name TEXT,
  org TEXT,
  email TEXT,
  phone TEXT,
  fax TEXT,
  {pref_channel},
  {cadence},
  {consent_status},
  consent_scope TEXT NOT NULL DEFAULT 'status',
  is_internal INTEGER NOT NULL DEFAULT 0,
  user_id TEXT REFERENCES app_user(id),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS stakeholder_profile (
  id TEXT PRIMARY KEY,
  stakeholder_id TEXT NOT NULL UNIQUE REFERENCES stakeholder(id),
  job_to_be_done TEXT,
  responsibility_transferred TEXT,
  success_definition TEXT,
  anxiety_risk TEXT,
  communication_promise TEXT,
  update_triggers TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS communication_rule (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  {rule_sh_type},
  {rule_category},
  {rule_delivery_mode},
  template_key TEXT,
  {rule_channel},
  follow_up INTEGER NOT NULL DEFAULT 0,
  sla_hours INTEGER NOT NULL DEFAULT 24,
  active INTEGER NOT NULL DEFAULT 1,
  {audit},
  UNIQUE(event_type, stakeholder_type)
);

CREATE TABLE IF NOT EXISTS message_template (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  {tmpl_sh_type},
  {tmpl_tone},
  {tmpl_channel},
  subject TEXT,
  body TEXT NOT NULL,
  {audit}
);

CREATE TABLE IF NOT EXISTS communication_log (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  stakeholder_id TEXT REFERENCES stakeholder(id),
  {log_recipient_type},
  event_id TEXT,
  event_type TEXT NOT NULL,
  template_key TEXT,
  {log_channel},
  recipient_name TEXT,
  recipient_address TEXT,
  subject TEXT,
  body TEXT,
  {log_status},
  {log_delivery_status},
  follow_up_required INTEGER NOT NULL DEFAULT 0,
  follow_up_task_id TEXT REFERENCES task(id),
  owner_id TEXT REFERENCES app_user(id),
  sla_due TEXT,
  sent_at TEXT,
  {audit}
);

CREATE TABLE IF NOT EXISTS communication_preference (
  id TEXT PRIMARY KEY,
  stakeholder_id TEXT NOT NULL REFERENCES stakeholder(id),
  {pref_category},
  {pref2_channel},
  {pref_cadence},
  opt_in INTEGER NOT NULL DEFAULT 1,
  {audit},
  UNIQUE(stakeholder_id, category)
);

CREATE TABLE IF NOT EXISTS daily_digest (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT REFERENCES app_user(id),
  recipient_stakeholder_id TEXT REFERENCES stakeholder(id),
  {digest_recipient_type},
  digest_date TEXT NOT NULL,
  {digest_channel},
  body TEXT,
  case_count INTEGER NOT NULL DEFAULT 0,
  {digest_status},
  sent_at TEXT,
  {audit}
);

CREATE INDEX IF NOT EXISTS ix_stakeholder_patient ON stakeholder(patient_id, type);
CREATE INDEX IF NOT EXISTS ix_commlog_patient ON communication_log(patient_id, created_at);
CREATE INDEX IF NOT EXISTS ix_commlog_status ON communication_log(status);
CREATE INDEX IF NOT EXISTS ix_commlog_stakeholder ON communication_log(stakeholder_id);
CREATE INDEX IF NOT EXISTS ix_commrule_event ON communication_rule(event_type);
CREATE INDEX IF NOT EXISTS ix_tmpl_event_type ON message_template(event_type, stakeholder_type);
CREATE INDEX IF NOT EXISTS ix_digest_user ON daily_digest(recipient_user_id, digest_date);
""".format(
    sh_type=_check("type", "stakeholder_type"),
    pref_channel=_check("preferred_channel", "channel").replace(
        "NOT NULL CHECK", "NOT NULL DEFAULT 'email' CHECK"),
    cadence=_check("cadence", "cadence").replace(
        "NOT NULL CHECK", "NOT NULL DEFAULT 'on_milestone' CHECK"),
    consent_status=_check("consent_status", "consent_status").replace(
        "NOT NULL CHECK", "NOT NULL DEFAULT 'unknown' CHECK"),
    rule_sh_type=_check("stakeholder_type", "stakeholder_type"),
    rule_category=_check("category", "comm_category"),
    rule_delivery_mode=_check("delivery_mode", "delivery_mode"),
    rule_channel=_ncheck("channel", "channel"),
    tmpl_sh_type=_check("stakeholder_type", "stakeholder_type"),
    tmpl_tone=_check("tone", "tone"),
    tmpl_channel=_ncheck("channel", "channel"),
    log_recipient_type=_check("recipient_type", "stakeholder_type"),
    log_channel=_check("channel", "channel"),
    log_status=_check("status", "comm_status"),
    log_delivery_status=_check("delivery_status", "delivery_status").replace(
        "NOT NULL CHECK", "NOT NULL DEFAULT 'pending' CHECK"),
    pref_category=_check("category", "comm_category"),
    pref2_channel=_check("channel", "channel"),
    pref_cadence=_check("cadence", "cadence"),
    digest_recipient_type=_check("recipient_type", "stakeholder_type"),
    digest_channel=_check("channel", "channel"),
    digest_status=_check("status", "digest_status").replace(
        "NOT NULL CHECK", "NOT NULL DEFAULT 'queued' CHECK"),
    audit=_AUDIT_COLS,
)


def db_path():
    return os.environ.get("OPS_DB_PATH") or os.path.join(DATA_DIR, "ops.db")


def get_conn():
    """A fresh connection per call (ThreadingHTTPServer-safe). FKs + WAL on."""
    path = db_path()
    d = os.path.dirname(path)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _add_col(conn, table, col, decl):
    """Idempotently add a column (SQLite errors if it already exists)."""
    have = [r["name"] for r in conn.execute("PRAGMA table_info(%s)" % table)]
    if col not in have:
        conn.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, decl))


def _migrate_v1(conn):
    conn.executescript(SCHEMA_SQL)


def _migrate_v2(conn):
    """Stakeholder Trust Engine: new tables + referral kind/stage columns.

    referral.kind distinguishes website leads from clinical referrals (which
    belong to Automynd); referral.stage is the referrer-facing case status.
    """
    conn.executescript(STAKEHOLDER_SQL)
    _add_col(conn, "referral", "kind", "TEXT")     # referral_kind (validated in service layer)
    _add_col(conn, "referral", "stage", "TEXT")    # referral_stage


MIGRATIONS = [(1, _migrate_v1), (2, _migrate_v2)]


def migrate():
    """Idempotent: apply any pending versioned migrations and record them."""
    conn = get_conn()
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        applied = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
        for version, fn in MIGRATIONS:
            if version in applied:
                continue
            fn(conn)
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) "
                "VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                (version,),
            )
        conn.commit()
    finally:
        conn.close()


def table_names():
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        return [r["name"] for r in rows]
    finally:
        conn.close()
