"""T3 — Task manager: owner + SLA mandatory, queues, escalation, SLA monitor.

Invariants enforced here:
  * a task cannot exist without owner_id and sla_due (validated + DB NOT NULL)
  * every transition writes audit_log and emits an event
  * an overdue task is auto-escalated to a supervisor (no deadline in a head)
"""
from . import db
from .core import tx, now_iso, mutate, queue_notification, row_to_dict, new_id, iso_in
from .auth import require, Forbidden
from .seed import user_by_role, system_user_id

OPEN_STATES = ("open", "assigned", "in_progress")


def _user_active(conn, uid):
    if not uid:
        return False
    return conn.execute(
        "SELECT 1 FROM app_user WHERE id=? AND active=1", (uid,)
    ).fetchone() is not None


def insert_task(conn, actor_id, data):
    """Low-level insert used by create_task and by automations (shares a tx)."""
    owner_id = data.get("owner_id")
    sla_due = data.get("sla_due")
    ttype = data.get("type")
    title = data.get("title")
    queue = data.get("queue", "judgment")
    if not owner_id:
        raise ValueError("task requires an owner_id (no ownerless tasks)")
    if not sla_due:
        raise ValueError("task requires an sla_due (no deadline outside the system)")
    if not _user_active(conn, owner_id):
        raise ValueError("task owner must be an active user")
    if not ttype or not title:
        raise ValueError("task requires type and title")
    if queue not in db.ENUMS["task_queue"]:
        raise ValueError("invalid task queue: %s" % queue)

    tid = new_id()
    priority = data.get("priority", "p1")
    role = data.get("role")
    conn.execute(
        "INSERT INTO task(id, patient_id, type, title, queue, role, owner_id, priority, "
        "status, sla_due, context_ref, parent_event_id, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, data.get("patient_id"), ttype, title, queue, role, owner_id, priority,
         "open", sla_due, data.get("context_ref"), data.get("parent_event_id"),
         now_iso(), actor_id),
    )
    after = row_to_dict(conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone())
    mutate(conn, actor_id, "create", "task", tid, None, after,
           events=[("TaskCreated", data.get("patient_id"),
                    {"task_id": tid, "type": ttype, "owner_id": owner_id, "sla_due": sla_due})])
    return tid


def create_task(actor, data):
    require(actor, ["*"])  # any authenticated staff may create a task
    with tx() as conn:
        return insert_task(conn, actor["id"], data)


def _load(conn, tid):
    row = conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone()
    if not row:
        raise ValueError("task not found: %s" % tid)
    return row


def assign_task(actor, tid, new_owner_id):
    with tx() as conn:
        t = _load(conn, tid)
        if actor["role"] not in ("ops_lead", "don", "admin") and actor["id"] != t["owner_id"]:
            raise Forbidden("only the owner or a supervisor may reassign")
        if not _user_active(conn, new_owner_id):
            raise ValueError("new owner must be an active user")
        before = row_to_dict(t)
        new_status = "assigned" if t["status"] == "open" else t["status"]
        conn.execute("UPDATE task SET owner_id=?, status=?, updated_at=? WHERE id=?",
                     (new_owner_id, new_status, now_iso(), tid))
        after = row_to_dict(conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone())
        mutate(conn, actor["id"], "assign", "task", tid, before, after,
               events=[("TaskAssigned", t["patient_id"], {"task_id": tid, "owner_id": new_owner_id})])
        queue_notification(conn, "user", new_owner_id, "inapp", "task_assigned", {"task_id": tid})


def start_task(actor, tid):
    with tx() as conn:
        t = _load(conn, tid)
        if actor["role"] != "admin" and actor["id"] != t["owner_id"]:
            raise Forbidden("only the owner may start this task")
        before = row_to_dict(t)
        conn.execute("UPDATE task SET status='in_progress', updated_at=? WHERE id=?",
                     (now_iso(), tid))
        after = row_to_dict(conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone())
        mutate(conn, actor["id"], "start", "task", tid, before, after,
               events=[("TaskStarted", t["patient_id"], {"task_id": tid})])


def complete_task(actor, tid):
    with tx() as conn:
        t = _load(conn, tid)
        if actor["role"] != "admin" and actor["id"] != t["owner_id"]:
            raise Forbidden("only the owner (or admin) may complete this task")
        before = row_to_dict(t)
        ts = now_iso()
        conn.execute("UPDATE task SET status='completed', completed_at=?, updated_at=? WHERE id=?",
                     (ts, ts, tid))
        after = row_to_dict(conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone())
        mutate(conn, actor["id"], "complete", "task", tid, before, after,
               events=[("TaskCompleted", t["patient_id"], {"task_id": tid})])


def list_my_queue(actor):
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM task WHERE owner_id=? AND status IN ('open','assigned','in_progress') "
            "AND soft_deleted_at IS NULL ORDER BY sla_due ASC",
            (actor["id"],),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def list_queue(actor, queue=None, status=None):
    require(actor, ["ops_lead", "don", "admin"])
    conn = db.get_conn()
    try:
        sql = "SELECT * FROM task WHERE soft_deleted_at IS NULL"
        args = []
        if queue:
            sql += " AND queue=?"; args.append(queue)
        if status:
            sql += " AND status=?"; args.append(status)
        sql += " ORDER BY sla_due ASC"
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


def get_task(actor, tid):
    require(actor, ["*"])
    conn = db.get_conn()
    try:
        row = conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def supervisor_for(conn, role):
    """clinician escalations go to the DON; everything else to ops_lead."""
    target = "don" if role == "clinician" else "ops_lead"
    sup = user_by_role(conn, target) or user_by_role(conn, "ops_lead") or user_by_role(conn, "admin")
    return sup["id"] if sup else None


def run_sla_monitor():
    """T3-J1: escalate overdue open tasks. Returns the count escalated.

    Idempotent: tasks already in the escalation queue are skipped, so re-running
    (cron + in-process thread together) never double-escalates.
    """
    now = now_iso()
    escalated = 0
    with tx() as conn:
        actor_id = system_user_id(conn)
        rows = conn.execute(
            "SELECT * FROM task WHERE status IN ('open','assigned','in_progress') "
            "AND queue != 'escalation' AND sla_due < ? AND soft_deleted_at IS NULL",
            (now,),
        ).fetchall()
        for t in rows:
            sup = supervisor_for(conn, t["role"])
            if not sup:
                continue
            before = dict(t)
            conn.execute(
                "UPDATE task SET status='escalated', queue='escalation', owner_id=?, updated_at=? WHERE id=?",
                (sup, now, t["id"]),
            )
            after = dict(conn.execute("SELECT * FROM task WHERE id=?", (t["id"],)).fetchone())
            mutate(conn, actor_id, "status_change", "task", t["id"], before, after, events=[
                ("SLABreached", t["patient_id"],
                 {"task_id": t["id"], "owner_id": t["owner_id"], "sla_due": t["sla_due"]}),
                ("TaskEscalated", t["patient_id"],
                 {"task_id": t["id"], "from_owner": t["owner_id"], "to_owner": sup}),
            ])
            queue_notification(conn, "user", t["owner_id"], "inapp", "task_sla_breached", {"task_id": t["id"]})
            queue_notification(conn, "user", sup, "inapp", "task_escalation_assigned", {"task_id": t["id"]})
            escalated += 1
    return escalated
