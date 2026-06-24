"""T1 — seed reference data: programs, reauth_config, the system user, and one
staff user per role so RBAC and login work out of the box.

Idempotent: safe to run on every boot. Real staff users can be added later; the
seeded role users give the founder a working console immediately and let the
SLA monitor reassign escalations to a real supervisor (ops_lead / DON).
"""
from . import db
from .core import new_id, now_iso

PROGRAMS = [
    ("eeoicpa", "EEOICPA / White Card"),
    ("owcp_feca", "Federal Workers Compensation (OWCP / FECA)"),
    ("va_ccn", "VA Community Care Network"),
    ("medicare", "Medicare"),
]

# (role, name, email). One per role; the founder/DON is named.
USERS = [
    ("system", "Alara System", "system@alarahomecare.local"),
    ("admin", "Alara Admin", "admin@alarahomecare.local"),
    ("ops_lead", "Operations Lead", "ops@alarahomecare.local"),
    ("don", "Jenn Gallinger", "don@alarahomecare.local"),
    ("care_guide", "Care Guide", "careguide@alarahomecare.local"),
    ("auth_specialist", "Authorization Specialist", "auth@alarahomecare.local"),
    ("clinician", "Field Clinician", "clinician@alarahomecare.local"),
    ("staffing_coordinator", "Staffing Coordinator", "staffing@alarahomecare.local"),
]


def run():
    conn = db.get_conn()
    try:
        for code, name in PROGRAMS:
            conn.execute(
                "INSERT OR IGNORE INTO program(id, code, name) VALUES (?,?,?)",
                (new_id(), code, name),
            )
        for role, name, email in USERS:
            exists = conn.execute(
                "SELECT 1 FROM app_user WHERE email=?", (email,)
            ).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO app_user(id, name, role, email, active, created_at) "
                    "VALUES (?,?,?,?,1,?)",
                    (new_id(), name, role, email, now_iso()),
                )
        has_cfg = conn.execute("SELECT 1 FROM reauth_config LIMIT 1").fetchone()
        if not has_cfg:
            conn.execute(
                "INSERT INTO reauth_config(id, threshold_days, lead_min_days) VALUES (?,?,?)",
                (new_id(), "[30,21,14]", 14),
            )
        conn.commit()
    finally:
        conn.close()


# --- lookups used by services / automations -----------------------------------
def user_by_role(conn, role):
    return conn.execute(
        "SELECT * FROM app_user WHERE role=? AND active=1 ORDER BY created_at LIMIT 1",
        (role,),
    ).fetchone()


def system_user_id(conn):
    row = user_by_role(conn, "system")
    return row["id"] if row else None
