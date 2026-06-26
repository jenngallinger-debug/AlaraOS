"""T2 — OS v0 case store: patient record, entitlements, contacts, timeline.

create_patient also runs the T2-J1 automation inline: on PatientCreated it opens
an onboarding task owned by the patient's care guide (or ops_lead + escalation if
no care guide exists) — in the same transaction, so the event and its consequence
never diverge.
"""
from . import db
from .core import tx, now_iso, iso_in, mutate, row_to_dict, new_id
from .auth import require
from .seed import user_by_role
from .tasks import insert_task

WRITE_PATIENT = ["care_guide", "admin"]
WRITE_ENTITLEMENT = ["care_guide", "auth_specialist", "admin"]
WRITE_CONTACT = ["care_guide", "admin"]
READ_ROLES = ["care_guide", "auth_specialist", "clinician", "don", "ops_lead", "admin"]


def create_patient(actor, data):
    require(actor, WRITE_PATIENT)
    legal_name = (data.get("legal_name") or "").strip() or None
    mrn = (data.get("mrn_ehr") or "").strip() or None
    if not legal_name and not mrn:
        status = "stub"  # partial patient allowed; flagged by status
    else:
        status = data.get("status") or "identified"
    if status not in db.ENUMS["patient_status"]:
        raise ValueError("invalid patient status: %s" % status)

    with tx() as conn:
        # default the care guide to the actor if they are one, else the seeded care guide
        care_guide_id = data.get("care_guide_id")
        if not care_guide_id:
            if actor["role"] == "care_guide":
                care_guide_id = actor["id"]
            else:
                cg = user_by_role(conn, "care_guide")
                care_guide_id = cg["id"] if cg else None

        pid = new_id()
        conn.execute(
            "INSERT INTO patient(id, legal_name, dob, mrn_ehr, service_area, status, "
            "care_guide_id, source_referral_id, created_at, created_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pid, legal_name, data.get("dob"), mrn, data.get("service_area"), status,
             care_guide_id, data.get("source_referral_id"), now_iso(), actor["id"]),
        )
        after = row_to_dict(conn.execute("SELECT * FROM patient WHERE id=?", (pid,)).fetchone())
        eids = mutate(conn, actor["id"], "create", "patient", pid, None, after, events=[
            ("PatientCreated", pid, {"patient_id": pid, "legal_name": legal_name, "mrn_ehr": mrn}),
        ])

        # T2-J1 onboarding task automation (inline, same tx)
        if care_guide_id:
            owner_id, queue, role = care_guide_id, "judgment", "care_guide"
        else:
            ops = user_by_role(conn, "ops_lead") or user_by_role(conn, "admin")
            owner_id, queue, role = (ops["id"] if ops else None), "escalation", "ops_lead"
        insert_task(conn, actor["id"], {
            "patient_id": pid, "type": "onboarding",
            "title": "Onboard patient: %s" % (legal_name or "(unnamed)"),
            "queue": queue, "role": role, "owner_id": owner_id,
            "priority": "p1", "sla_due": iso_in(hours=24),
            "context_ref": "patient:%s" % pid, "parent_event_id": eids[0],
        })
        return pid


def update_patient(actor, pid, data):
    require(actor, WRITE_PATIENT)
    fields = {k: data[k] for k in ("legal_name", "dob", "mrn_ehr", "service_area",
                                   "status", "care_guide_id") if k in data and data[k] is not None}
    if not fields:
        return
    if "status" in fields and fields["status"] not in db.ENUMS["patient_status"]:
        raise ValueError("invalid patient status: %s" % fields["status"])
    with tx() as conn:
        before = conn.execute("SELECT * FROM patient WHERE id=?", (pid,)).fetchone()
        if not before:
            raise ValueError("patient not found: %s" % pid)
        before = row_to_dict(before)
        sets = ", ".join("%s=?" % k for k in fields) + ", updated_at=?"
        conn.execute("UPDATE patient SET %s WHERE id=?" % sets,
                     list(fields.values()) + [now_iso(), pid])
        after = row_to_dict(conn.execute("SELECT * FROM patient WHERE id=?", (pid,)).fetchone())
        events = []
        if "status" in fields and before["status"] != after["status"]:
            events.append(("PatientStatusChanged", pid,
                           {"patient_id": pid, "from": before["status"], "to": after["status"]}))
        mutate(conn, actor["id"], "update", "patient", pid, before, after, events=events)


def create_entitlement(actor, pid, data):
    require(actor, WRITE_ENTITLEMENT)
    program_code = data.get("program_code")
    with tx() as conn:
        if not conn.execute("SELECT 1 FROM patient WHERE id=?", (pid,)).fetchone():
            raise ValueError("patient not found: %s" % pid)
        prog = conn.execute("SELECT * FROM program WHERE code=?", (program_code,)).fetchone()
        if not prog:
            raise ValueError("unknown program: %s" % program_code)
        eid = new_id()
        conn.execute(
            "INSERT INTO entitlement(id, patient_id, program_id, basis, coverage_scope, "
            "status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)",
            (eid, pid, prog["id"], data.get("basis"), data.get("coverage_scope"),
             data.get("status", "unverified"), now_iso(), actor["id"]),
        )
        after = row_to_dict(conn.execute("SELECT * FROM entitlement WHERE id=?", (eid,)).fetchone())
        mutate(conn, actor["id"], "create", "entitlement", eid, None, after,
               events=[("EntitlementCreated", pid, {"entitlement_id": eid, "program_code": program_code})])
        return eid


def add_contact(actor, pid, data):
    require(actor, WRITE_CONTACT)
    role = data.get("role")
    if role not in db.ENUMS["contact_role"]:
        raise ValueError("invalid contact role: %s" % role)
    with tx() as conn:
        if not conn.execute("SELECT 1 FROM patient WHERE id=?", (pid,)).fetchone():
            raise ValueError("patient not found: %s" % pid)
        cid = new_id()
        conn.execute(
            "INSERT INTO contact(id, patient_id, name, relationship, role, phone, email, "
            "created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
            (cid, pid, data.get("name"), data.get("relationship"), role,
             data.get("phone"), data.get("email"), now_iso(), actor["id"]),
        )
        after = row_to_dict(conn.execute("SELECT * FROM contact WHERE id=?", (cid,)).fetchone())
        mutate(conn, actor["id"], "create", "contact", cid, None, after,
               events=[("ContactAdded", pid, {"contact_id": cid, "contact_role": role})])
        return cid


def get_patient(actor, pid):
    require(actor, READ_ROLES)
    conn = db.get_conn()
    try:
        p = conn.execute("SELECT * FROM patient WHERE id=?", (pid,)).fetchone()
        if not p:
            return None
        out = dict(p)
        out["entitlements"] = [dict(r) for r in conn.execute(
            "SELECT e.*, pr.code AS program_code, pr.name AS program_name "
            "FROM entitlement e JOIN program pr ON pr.id=e.program_id "
            "WHERE e.patient_id=? ORDER BY e.created_at", (pid,)).fetchall()]
        out["contacts"] = [dict(r) for r in conn.execute(
            "SELECT * FROM contact WHERE patient_id=? ORDER BY created_at", (pid,)).fetchall()]
        out["tasks"] = [dict(r) for r in conn.execute(
            "SELECT * FROM task WHERE patient_id=? AND status IN ('open','assigned','in_progress','escalated') "
            "ORDER BY sla_due", (pid,)).fetchall()]
        out["authorizations"] = [dict(r) for r in conn.execute(
            "SELECT * FROM authorization WHERE patient_id=? ORDER BY created_at DESC", (pid,)).fetchall()]
        out["visits"] = [dict(r) for r in conn.execute(
            "SELECT * FROM visit WHERE patient_id=? ORDER BY scheduled_at DESC LIMIT 10", (pid,)).fetchall()]
        out["timeline"] = [dict(r) for r in conn.execute(
            "SELECT * FROM event WHERE patient_id=? ORDER BY emitted_at DESC LIMIT 100", (pid,)).fetchall()]
        return out
    finally:
        conn.close()


def list_patients(actor, status=None, q=None):
    require(actor, READ_ROLES)
    conn = db.get_conn()
    try:
        sql = ("SELECT p.*, u.name AS care_guide_name, "
               "(SELECT COUNT(*) FROM task t WHERE t.patient_id=p.id "
               " AND t.status IN ('open','assigned','in_progress','escalated')) AS open_tasks "
               "FROM patient p LEFT JOIN app_user u ON u.id=p.care_guide_id "
               "WHERE p.soft_deleted_at IS NULL")
        args = []
        if status:
            sql += " AND p.status=?"; args.append(status)
        if q:
            sql += " AND (p.legal_name LIKE ? OR p.mrn_ehr LIKE ?)"
            args += ["%" + q + "%", "%" + q + "%"]
        sql += " ORDER BY p.created_at DESC LIMIT 500"
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()
