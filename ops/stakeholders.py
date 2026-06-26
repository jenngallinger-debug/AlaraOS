"""Stakeholder model + promise profile + communication preferences (CRUD).

A stakeholder is attached to a patient. On creation we auto-seed:
  * a promise profile (job-to-be-done, responsibility transferred, success,
    anxiety, communication promise, update triggers) from the type defaults, and
  * a default 'all' communication_preference mirroring the chosen channel/cadence.
"""
import json

from . import db
from .core import tx, now_iso, new_id, mutate, row_to_dict
from .auth import require
from . import comms_data as CD

WRITE = ["care_guide", "ops_lead", "admin"]
READ = ["care_guide", "auth_specialist", "clinician", "don", "ops_lead", "admin"]

_ENUM = db.ENUMS


def _validate_enum(val, key, default=None):
    if val is None and default is not None:
        return default
    if val not in _ENUM[key]:
        raise ValueError("invalid %s: %r" % (key, val))
    return val


def add_stakeholder(actor, patient_id, data):
    require(actor, WRITE)
    sh_type = data.get("type")
    if sh_type not in _ENUM["stakeholder_type"]:
        raise ValueError("invalid stakeholder type: %r" % sh_type)
    channel = _validate_enum(data.get("preferred_channel"), "channel", "email")
    cadence = _validate_enum(data.get("cadence"), "cadence", "on_milestone")
    consent = _validate_enum(data.get("consent_status"), "consent_status", "unknown")
    is_internal = 1 if sh_type in CD.INTERNAL_TYPES else 0

    with tx() as conn:
        if not conn.execute("SELECT 1 FROM patient WHERE id=?", (patient_id,)).fetchone():
            raise ValueError("patient not found: %s" % patient_id)
        sid = new_id()
        conn.execute(
            "INSERT INTO stakeholder(id, patient_id, type, name, org, email, phone, fax, "
            "preferred_channel, cadence, consent_status, consent_scope, is_internal, user_id, "
            "active, notes, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)",
            (sid, patient_id, sh_type, data.get("name"), data.get("org"), data.get("email"),
             data.get("phone"), data.get("fax"), channel, cadence, consent,
             data.get("consent_scope") or "status", is_internal, data.get("user_id"),
             data.get("notes"), now_iso(), actor["id"]),
        )
        # auto-seed promise profile
        d = CD.PROMISE_DEFAULTS.get(sh_type, {})
        conn.execute(
            "INSERT INTO stakeholder_profile(id, stakeholder_id, job_to_be_done, "
            "responsibility_transferred, success_definition, anxiety_risk, communication_promise, "
            "update_triggers, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (new_id(), sid, d.get("job"), d.get("responsibility"), d.get("success"),
             d.get("anxiety"), d.get("promise"), json.dumps(d.get("triggers", [])),
             now_iso(), actor["id"]),
        )
        # default 'all' preference mirrors the chosen channel/cadence
        conn.execute(
            "INSERT INTO communication_preference(id, stakeholder_id, category, channel, cadence, "
            "opt_in, created_at, created_by) VALUES (?,?,?,?,?,1,?,?)",
            (new_id(), sid, "all", channel, cadence, now_iso(), actor["id"]),
        )
        after = row_to_dict(conn.execute("SELECT * FROM stakeholder WHERE id=?", (sid,)).fetchone())
        mutate(conn, actor["id"], "create", "stakeholder", sid, None, after,
               events=[("StakeholderAdded", patient_id,
                        {"stakeholder_id": sid, "type": sh_type})])
        return sid


def update_stakeholder(actor, sid, data):
    require(actor, WRITE)
    allowed = ("name", "org", "email", "phone", "fax", "preferred_channel", "cadence",
               "consent_status", "consent_scope", "active", "notes", "user_id")
    fields = {k: data[k] for k in allowed if k in data and data[k] is not None}
    if "preferred_channel" in fields:
        _validate_enum(fields["preferred_channel"], "channel")
    if "cadence" in fields:
        _validate_enum(fields["cadence"], "cadence")
    if "consent_status" in fields:
        _validate_enum(fields["consent_status"], "consent_status")
    if "active" in fields:
        fields["active"] = 1 if str(fields["active"]) in ("1", "true", "yes", "on") else 0
    if not fields:
        return
    with tx() as conn:
        before = conn.execute("SELECT * FROM stakeholder WHERE id=?", (sid,)).fetchone()
        if not before:
            raise ValueError("stakeholder not found: %s" % sid)
        before = row_to_dict(before)
        sets = ", ".join("%s=?" % k for k in fields) + ", updated_at=?"
        conn.execute("UPDATE stakeholder SET %s WHERE id=?" % sets,
                     list(fields.values()) + [now_iso(), sid])
        after = row_to_dict(conn.execute("SELECT * FROM stakeholder WHERE id=?", (sid,)).fetchone())
        events = []
        if "consent_status" in fields and before["consent_status"] != after["consent_status"]:
            events.append(("StakeholderConsentChanged", before["patient_id"],
                           {"stakeholder_id": sid, "from": before["consent_status"],
                            "to": after["consent_status"]}))
        events.append(("StakeholderUpdated", before["patient_id"], {"stakeholder_id": sid}))
        mutate(conn, actor["id"], "update", "stakeholder", sid, before, after, events=events)


def list_stakeholders(actor, patient_id):
    require(actor, READ)
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT s.*, "
            "(SELECT COUNT(*) FROM communication_log c WHERE c.stakeholder_id=s.id) AS comm_count, "
            "(SELECT COUNT(*) FROM communication_log c WHERE c.stakeholder_id=s.id "
            " AND c.status IN ('drafted','queued','suppressed')) AS comm_pending "
            "FROM stakeholder s WHERE s.patient_id=? AND s.soft_deleted_at IS NULL "
            "ORDER BY s.is_internal, s.type", (patient_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_stakeholder(actor, sid):
    require(actor, READ)
    conn = db.get_conn()
    try:
        s = conn.execute("SELECT * FROM stakeholder WHERE id=?", (sid,)).fetchone()
        if not s:
            return None
        out = dict(s)
        out["profile"] = row_to_dict(conn.execute(
            "SELECT * FROM stakeholder_profile WHERE stakeholder_id=?", (sid,)).fetchone())
        out["preferences"] = [dict(r) for r in conn.execute(
            "SELECT * FROM communication_preference WHERE stakeholder_id=? ORDER BY category",
            (sid,)).fetchall()]
        out["communications"] = [dict(r) for r in conn.execute(
            "SELECT * FROM communication_log WHERE stakeholder_id=? ORDER BY created_at DESC LIMIT 50",
            (sid,)).fetchall()]
        return out
    finally:
        conn.close()
