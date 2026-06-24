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

SCHEMA_VERSION = 1

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
}


def _check(col, key):
    vals = ",".join("'%s'" % v for v in ENUMS[key])
    return "%s TEXT NOT NULL CHECK(%s IN (%s))" % (col, col, vals)


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


def migrate():
    """Idempotent: apply the schema and record the version."""
    conn = get_conn()
    try:
        conn.executescript(SCHEMA_SQL)
        row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
        if not row or row["v"] is None or row["v"] < SCHEMA_VERSION:
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) "
                "VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                (SCHEMA_VERSION,),
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
