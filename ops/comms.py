"""Stakeholder Trust Engine — rule evaluation, dispatch, intake, digest.

The core loop: a domain event is emitted -> evaluate communication_rules for that
event -> for each matching stakeholder, decide who/what/when/channel, then:
  * auto    -> queue (stub send) + log 'sent'  (+ follow-up task if the rule asks)
  * review  -> log 'drafted' + Care Guide task carrying the draft
  * task    -> internal task for the role (care_guide/auth_specialist/don) + log
  * manual  -> log 'drafted' only (sent on demand from the pending queue)
  * (consent/scope missing) -> log 'suppressed' + exception task; never sent.

Sending is stubbed: we queue a notification row and mark the log 'sent'. No real
SMS/email is wired. Clinical charting stays in Automynd — this only tracks the
communications and responsibility-transfer around a case.
"""
from . import db
from .core import tx, now_iso, iso_in, new_id, mutate, queue_notification, row_to_dict
from .auth import require
from .tasks import insert_task
from .seed import user_by_role
from . import comms_data as CD

RECORD_ROLES = ["care_guide", "auth_specialist", "clinician", "don", "ops_lead", "admin"]
SEND_ROLES = ["care_guide", "ops_lead", "admin"]


# ── rendering ────────────────────────────────────────────────────────────────
class _Safe(dict):
    def __missing__(self, k):
        return ""


def _render(text, ctx):
    try:
        return str(text or "").format_map(_Safe(ctx))
    except Exception:
        return str(text or "")


def _ctx(patient, stakeholder, event_type, payload):
    label, plain = CD.EVENT_LABELS.get(event_type, (event_type, event_type))
    detail = payload.get("detail") if payload else None
    name = (stakeholder or {}).get("name") or ""
    return {
        "patient_name": patient.get("legal_name") or "the patient",
        "recipient_first": (name.split()[0] if name else "there"),
        "recipient_name": name,
        "org": (stakeholder or {}).get("org") or "",
        "event_label": label,
        "event_plain": plain,
        "detail": (" " + str(detail)) if detail else "",
        "action": (payload.get("action") if payload else None) or "Review and handle this case event.",
    }


def _message(conn, event_type, sh_type, ctx):
    row = conn.execute(
        "SELECT subject, body FROM message_template WHERE event_type=? AND stakeholder_type=?",
        (event_type, sh_type)).fetchone()
    if row:
        return _render(row["subject"], ctx), _render(row["body"], ctx)
    tone = CD.TONE_BY_TYPE.get(sh_type, "operational")
    subj, body = CD.GENERIC_BY_TONE[tone]
    return _render(subj, ctx), _render(body, ctx)


# ── helpers ──────────────────────────────────────────────────────────────────
def _role_user(conn, role):
    u = user_by_role(conn, role)
    return u["id"] if u else None


def _user_name(conn, uid):
    if not uid:
        return None
    r = conn.execute("SELECT name FROM app_user WHERE id=?", (uid,)).fetchone()
    return r["name"] if r else None


def _prio(sla_hours):
    return "p0" if sla_hours <= 4 else ("p1" if sla_hours <= 24 else "p2")


def _consent_ok(sh, category):
    cs = sh.get("consent_status")
    if cs == "granted":
        return True
    if cs == "restricted":
        scope = sh.get("consent_scope") or ""
        return "full" in scope or "all" in scope or category in scope
    return False  # unknown / revoked -> never send


def _addr_for(sh, channel):
    if channel == "email":
        return sh.get("email")
    if channel in ("sms", "phone"):
        return sh.get("phone")
    if channel == "fax":
        return sh.get("fax")
    return sh.get("email") or sh.get("phone")


def _insert_log(conn, actor_id, **kw):
    lid = new_id()
    conn.execute(
        "INSERT INTO communication_log(id, patient_id, stakeholder_id, recipient_type, event_id, "
        "event_type, template_key, channel, recipient_name, recipient_address, subject, body, "
        "status, delivery_status, follow_up_required, follow_up_task_id, owner_id, sla_due, sent_at, "
        "created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (lid, kw["patient_id"], kw.get("stakeholder_id"), kw["recipient_type"], kw.get("event_id"),
         kw["event_type"], kw.get("template_key"), kw["channel"], kw.get("recipient_name"),
         kw.get("recipient_address"), kw.get("subject"), kw.get("body"), kw["status"],
         kw.get("delivery_status", "pending"), 1 if kw.get("follow_up_required") else 0,
         kw.get("follow_up_task_id"), kw.get("owner_id"), kw.get("sla_due"), kw.get("sent_at"),
         now_iso(), actor_id))
    after = row_to_dict(conn.execute("SELECT * FROM communication_log WHERE id=?", (lid,)).fetchone())
    mutate(conn, actor_id, "create", "communication_log", lid, None, after,
           events=[("CommunicationCreated", kw["patient_id"],
                    {"log_id": lid, "event": kw["event_type"], "type": kw["recipient_type"],
                     "status": kw["status"]})])
    return lid


def _update_stage(conn, patient_id, event_type, actor_id):
    stage = CD.EVENT_TO_STAGE.get(event_type)
    if not stage:
        return
    ref = conn.execute(
        "SELECT * FROM referral WHERE patient_id=? ORDER BY received_at DESC LIMIT 1",
        (patient_id,)).fetchone()
    if not ref or ref["stage"] == stage:
        return
    before = row_to_dict(ref)
    conn.execute("UPDATE referral SET stage=?, updated_at=? WHERE id=?",
                 (stage, now_iso(), ref["id"]))
    after = row_to_dict(conn.execute("SELECT * FROM referral WHERE id=?", (ref["id"],)).fetchone())
    mutate(conn, actor_id, "update", "referral", ref["id"], before, after,
           events=[("ReferralStageChanged", patient_id, {"stage": stage})])


# ── the dispatcher ───────────────────────────────────────────────────────────
def dispatch_for_event(conn, *, event_type, patient_id, event_id, payload, actor_id):
    p = conn.execute("SELECT * FROM patient WHERE id=?", (patient_id,)).fetchone()
    if not p:
        return []
    p = dict(p)
    care_owner = p.get("care_guide_id") or _role_user(conn, "care_guide") or _role_user(conn, "ops_lead")
    rules = conn.execute(
        "SELECT * FROM communication_rule WHERE event_type=? AND active=1", (event_type,)).fetchall()
    created = []
    for rule in rules:
        st, mode, category = rule["stakeholder_type"], rule["delivery_mode"], rule["category"]
        sla_due = iso_in(hours=rule["sla_hours"])

        # internal stakeholder types -> create a task for the role
        if st in CD.INTERNAL_TYPES:
            owner = (p.get("care_guide_id") if st == "care_guide" and p.get("care_guide_id")
                     else _role_user(conn, CD.TYPE_TO_ROLE[st]))
            if not owner:
                continue
            subj, body = _message(conn, event_type, st, _ctx(p, None, event_type, payload))
            tid = insert_task(conn, actor_id, {
                "patient_id": patient_id, "type": "comm_" + event_type,
                "title": subj or (event_type + " — " + (p.get("legal_name") or "patient")),
                "queue": "judgment", "role": CD.TYPE_TO_ROLE[st], "owner_id": owner,
                "priority": _prio(rule["sla_hours"]), "sla_due": sla_due,
                "context_ref": "comm_rule:" + event_type, "parent_event_id": event_id})
            lid = _insert_log(conn, actor_id, patient_id=patient_id, stakeholder_id=None,
                              recipient_type=st, event_id=event_id, event_type=event_type,
                              template_key=rule["template_key"], channel="inapp",
                              recipient_name=_user_name(conn, owner), recipient_address=None,
                              subject=subj, body=body, status="sent", delivery_status="delivered",
                              sent_at=now_iso(), follow_up_required=rule["follow_up"],
                              follow_up_task_id=tid, owner_id=owner, sla_due=sla_due)
            created.append({"log_id": lid, "type": st, "mode": "task"})
            continue

        # external stakeholders -> one message each
        shs = conn.execute(
            "SELECT * FROM stakeholder WHERE patient_id=? AND type=? AND active=1 "
            "AND soft_deleted_at IS NULL", (patient_id, st)).fetchall()
        for sh in shs:
            sh = dict(sh)
            channel = rule["channel"] or sh.get("preferred_channel") or "email"
            addr = _addr_for(sh, channel)
            subj, body = _message(conn, event_type, st, _ctx(p, sh, event_type, payload))

            if not _consent_ok(sh, category):
                tid = insert_task(conn, actor_id, {
                    "patient_id": patient_id, "type": "consent_exception",
                    "title": "Consent/scope missing — " + CD.STAKEHOLDER_LABELS.get(st, st)
                             + " for " + (p.get("legal_name") or "patient"),
                    "queue": "exception", "role": "care_guide", "owner_id": care_owner,
                    "priority": "p1", "sla_due": sla_due,
                    "context_ref": "stakeholder:" + sh["id"], "parent_event_id": event_id})
                lid = _insert_log(conn, actor_id, patient_id=patient_id, stakeholder_id=sh["id"],
                                  recipient_type=st, event_id=event_id, event_type=event_type,
                                  template_key=rule["template_key"], channel=channel,
                                  recipient_name=sh.get("name"), recipient_address=addr,
                                  subject=subj, body=body, status="suppressed",
                                  follow_up_required=1, follow_up_task_id=tid,
                                  owner_id=care_owner, sla_due=sla_due)
                created.append({"log_id": lid, "type": st, "mode": "suppressed"})
                continue

            if mode == "auto":
                queue_notification(conn, "external", addr or (sh.get("name") or st), channel,
                                   "comm_" + event_type, {"subject": subj})
                lid = _insert_log(conn, actor_id, patient_id=patient_id, stakeholder_id=sh["id"],
                                  recipient_type=st, event_id=event_id, event_type=event_type,
                                  template_key=rule["template_key"], channel=channel,
                                  recipient_name=sh.get("name"), recipient_address=addr,
                                  subject=subj, body=body, status="sent",
                                  delivery_status="delivered", sent_at=now_iso(),
                                  follow_up_required=rule["follow_up"], owner_id=care_owner,
                                  sla_due=sla_due)
                if rule["follow_up"]:
                    tid = insert_task(conn, actor_id, {
                        "patient_id": patient_id, "type": "comm_followup",
                        "title": "Follow up: " + (subj or event_type), "queue": "judgment",
                        "role": "care_guide", "owner_id": care_owner,
                        "priority": _prio(rule["sla_hours"]), "sla_due": sla_due,
                        "context_ref": "comm_log:" + lid, "parent_event_id": event_id})
                    conn.execute("UPDATE communication_log SET follow_up_task_id=? WHERE id=?", (tid, lid))
                created.append({"log_id": lid, "type": st, "mode": "auto"})

            elif mode == "review":
                tid = insert_task(conn, actor_id, {
                    "patient_id": patient_id, "type": "comm_review",
                    "title": "Review & send to " + CD.STAKEHOLDER_LABELS.get(st, st) + ": "
                             + (subj or event_type), "queue": "judgment", "role": "care_guide",
                    "owner_id": care_owner, "priority": _prio(rule["sla_hours"]),
                    "sla_due": sla_due, "context_ref": "comm_review", "parent_event_id": event_id})
                lid = _insert_log(conn, actor_id, patient_id=patient_id, stakeholder_id=sh["id"],
                                  recipient_type=st, event_id=event_id, event_type=event_type,
                                  template_key=rule["template_key"], channel=channel,
                                  recipient_name=sh.get("name"), recipient_address=addr,
                                  subject=subj, body=body, status="drafted",
                                  follow_up_required=1, follow_up_task_id=tid,
                                  owner_id=care_owner, sla_due=sla_due)
                created.append({"log_id": lid, "type": st, "mode": "review"})

            else:  # manual
                lid = _insert_log(conn, actor_id, patient_id=patient_id, stakeholder_id=sh["id"],
                                  recipient_type=st, event_id=event_id, event_type=event_type,
                                  template_key=rule["template_key"], channel=channel,
                                  recipient_name=sh.get("name"), recipient_address=addr,
                                  subject=subj, body=body, status="drafted",
                                  follow_up_required=rule["follow_up"], owner_id=care_owner,
                                  sla_due=sla_due)
                created.append({"log_id": lid, "type": st, "mode": "manual"})

    _update_stage(conn, patient_id, event_type, actor_id)
    return created


# ── public actions ───────────────────────────────────────────────────────────
def record_case_event(actor, patient_id, event_type, payload=None):
    """Append a case event AND run the stakeholder communication rules for it."""
    require(actor, RECORD_ROLES)
    if event_type not in CD.ALL_EVENTS:
        raise ValueError("unknown event type: %s" % event_type)
    payload = payload or {}
    with tx() as conn:
        if not conn.execute("SELECT 1 FROM patient WHERE id=?", (patient_id,)).fetchone():
            raise ValueError("patient not found: %s" % patient_id)
        eids = mutate(conn, actor["id"], "case_event", "patient", patient_id, None,
                      dict({"event": event_type}, **payload),
                      events=[(event_type, patient_id, payload)])
        created = dispatch_for_event(conn, event_type=event_type, patient_id=patient_id,
                                     event_id=eids[0], payload=payload, actor_id=actor["id"])
    return {"event": event_type, "communications": len(created), "detail": created}


def log_referral(actor, data):
    """Record a referral/lead (kind=website_lead|clinical_referral) on a patient,
    set the referrer-facing stage, and fire ReferralReceived. Clinical charting
    still belongs to Automynd; this is only the stakeholder-comms anchor."""
    require(actor, SEND_ROLES)
    patient_id = data.get("patient_id")
    kind = data.get("kind") or "website_lead"
    if kind not in db.ENUMS["referral_kind"]:
        raise ValueError("invalid referral kind: %s" % kind)
    channel = data.get("channel") or "email"
    if channel not in db.ENUMS["referral_channel"]:
        channel = "other"
    with tx() as conn:
        if not patient_id or not conn.execute("SELECT 1 FROM patient WHERE id=?", (patient_id,)).fetchone():
            raise ValueError("a valid patient_id is required to log a referral")
        rid = new_id()
        conn.execute(
            "INSERT INTO referral(id, patient_id, channel, received_at, payload, status, kind, "
            "stage, owner_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, patient_id, channel, now_iso(), data.get("notes"), "received", kind,
             "received", data.get("owner_id"), now_iso(), actor["id"]))
        conn.execute("UPDATE patient SET source_referral_id=?, updated_at=? WHERE id=? AND source_referral_id IS NULL",
                     (rid, now_iso(), patient_id))
        eids = mutate(conn, actor["id"], "create", "referral", rid, None,
                      row_to_dict(conn.execute("SELECT * FROM referral WHERE id=?", (rid,)).fetchone()),
                      events=[("ReferralReceived", patient_id, {"referral_id": rid, "kind": kind})])
        dispatch_for_event(conn, event_type="ReferralReceived", patient_id=patient_id,
                           event_id=eids[0], payload={"kind": kind}, actor_id=actor["id"])
        return rid


def send_communication(actor, log_id):
    """Mark a drafted/queued communication as sent (stub) and clear its review task."""
    require(actor, SEND_ROLES)
    with tx() as conn:
        log = conn.execute("SELECT * FROM communication_log WHERE id=?", (log_id,)).fetchone()
        if not log:
            raise ValueError("communication not found: %s" % log_id)
        if log["status"] in ("sent", "suppressed"):
            raise ValueError("communication is %s; nothing to send" % log["status"])
        before = row_to_dict(log)
        ts = now_iso()
        conn.execute(
            "UPDATE communication_log SET status='sent', delivery_status='delivered', sent_at=?, "
            "updated_at=? WHERE id=?", (ts, ts, log_id))
        queue_notification(conn, "external", log["recipient_address"] or (log["recipient_name"] or log["recipient_type"]),
                           log["channel"], "comm_" + log["event_type"], {"subject": log["subject"]})
        after = row_to_dict(conn.execute("SELECT * FROM communication_log WHERE id=?", (log_id,)).fetchone())
        mutate(conn, actor["id"], "send", "communication_log", log_id, before, after,
               events=[("CommunicationSent", log["patient_id"], {"log_id": log_id})])
        if log["follow_up_task_id"]:
            t = conn.execute("SELECT status FROM task WHERE id=?", (log["follow_up_task_id"],)).fetchone()
            if t and t["status"] not in ("completed", "cancelled"):
                conn.execute("UPDATE task SET status='completed', completed_at=?, updated_at=? WHERE id=?",
                             (ts, ts, log["follow_up_task_id"]))
                mutate(conn, actor["id"], "complete", "task", log["follow_up_task_id"], None,
                       {"status": "completed"}, events=[("TaskCompleted", log["patient_id"],
                        {"task_id": log["follow_up_task_id"]})])


# ── reads ────────────────────────────────────────────────────────────────────
def list_communications(actor, patient_id):
    require(actor, RECORD_ROLES)
    conn = db.get_conn()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM communication_log WHERE patient_id=? ORDER BY created_at DESC", (patient_id,))]
    finally:
        conn.close()


def list_pending(actor, status="drafted"):
    require(actor, RECORD_ROLES)
    conn = db.get_conn()
    try:
        if status == "suppressed":
            where = "c.status='suppressed'"
        else:
            where = "c.status IN ('drafted','queued')"
        return [dict(r) for r in conn.execute(
            "SELECT c.*, p.legal_name AS patient_name FROM communication_log c "
            "LEFT JOIN patient p ON p.id=c.patient_id WHERE " + where +
            " ORDER BY c.sla_due ASC")]
    finally:
        conn.close()


def get_communication(actor, log_id):
    require(actor, RECORD_ROLES)
    conn = db.get_conn()
    try:
        r = conn.execute("SELECT * FROM communication_log WHERE id=?", (log_id,)).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def list_referrals(actor):
    require(actor, RECORD_ROLES)
    conn = db.get_conn()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT r.*, p.legal_name AS patient_name FROM referral r "
            "LEFT JOIN patient p ON p.id=r.patient_id ORDER BY r.received_at DESC LIMIT 200")]
    finally:
        conn.close()


# ── daily digest job ─────────────────────────────────────────────────────────
def run_daily_digest(digest_date=None):
    """Assemble a daily digest per Care Guide (their active cases) and per external
    stakeholder set to daily_digest cadence. Stubbed: builds + queues, no real send.
    Returns the number of digests created."""
    day = digest_date or now_iso()[:10]
    made = 0
    with tx() as conn:
        actor_id = _role_user(conn, "system")
        # internal Care Guides
        guides = conn.execute("SELECT * FROM app_user WHERE role='care_guide' AND active=1").fetchall()
        for g in guides:
            pats = conn.execute(
                "SELECT * FROM patient WHERE care_guide_id=? AND soft_deleted_at IS NULL "
                "AND status NOT IN ('discharged','deceased','lost')", (g["id"],)).fetchall()
            if not pats:
                continue
            if conn.execute("SELECT 1 FROM daily_digest WHERE recipient_user_id=? AND digest_date=?",
                            (g["id"], day)).fetchone():
                continue
            lines = []
            for p in pats:
                opens = conn.execute(
                    "SELECT COUNT(*) c FROM task WHERE patient_id=? AND status IN "
                    "('open','assigned','in_progress','escalated')", (p["id"],)).fetchone()["c"]
                last = conn.execute(
                    "SELECT type FROM event WHERE patient_id=? ORDER BY emitted_at DESC LIMIT 1",
                    (p["id"],)).fetchone()
                lines.append("• %s — %s · %d open task(s) · last: %s"
                             % (p["legal_name"] or "(unnamed)", p["status"], opens,
                                (last["type"] if last else "—")))
            body = ("Daily digest for %s (%s)\nActive cases: %d\n\n%s"
                    % (g["name"], day, len(pats), "\n".join(lines)))
            did = new_id()
            conn.execute(
                "INSERT INTO daily_digest(id, recipient_user_id, recipient_type, digest_date, channel, "
                "body, case_count, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (did, g["id"], "care_guide", day, "inapp", body, len(pats), "queued", now_iso(), actor_id))
            queue_notification(conn, "user", g["id"], "inapp", "daily_digest", {"date": day, "cases": len(pats)})
            mutate(conn, actor_id, "create", "daily_digest", did, None, {"cases": len(pats)},
                   events=[("DailyDigestGenerated", None, {"recipient": g["id"], "cases": len(pats)})])
            made += 1

        # external stakeholders set to daily_digest
        ext = conn.execute(
            "SELECT s.*, p.legal_name AS patient_name FROM stakeholder s "
            "JOIN patient p ON p.id=s.patient_id WHERE s.cadence='daily_digest' AND s.active=1 "
            "AND s.is_internal=0 AND s.soft_deleted_at IS NULL").fetchall()
        for s in ext:
            if conn.execute("SELECT 1 FROM daily_digest WHERE recipient_stakeholder_id=? AND digest_date=?",
                            (s["id"], day)).fetchone():
                continue
            recent = conn.execute(
                "SELECT event_type, status FROM communication_log WHERE stakeholder_id=? "
                "AND created_at >= ? ORDER BY created_at DESC LIMIT 10", (s["id"], day + "T00:00:00Z")).fetchall()
            lines = ["• %s (%s)" % (CD.EVENT_LABELS.get(r["event_type"], (r["event_type"],))[0], r["status"])
                     for r in recent] or ["• No new activity in the last day."]
            body = ("Daily digest for %s re: %s (%s)\n\n%s"
                    % (s["name"] or CD.STAKEHOLDER_LABELS.get(s["type"], s["type"]),
                       s["patient_name"] or "case", day, "\n".join(lines)))
            did = new_id()
            conn.execute(
                "INSERT INTO daily_digest(id, recipient_stakeholder_id, recipient_type, digest_date, "
                "channel, body, case_count, status, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (did, s["id"], s["type"], day, s.get("preferred_channel") or "email", body, 1,
                 "queued", now_iso(), actor_id))
            queue_notification(conn, "external", s.get("email") or s.get("name") or s["type"],
                               s.get("preferred_channel") or "email", "daily_digest", {"date": day})
            mutate(conn, actor_id, "create", "daily_digest", did, None, {"stakeholder": s["id"]},
                   events=[("DailyDigestGenerated", s["patient_id"], {"stakeholder": s["id"]})])
            made += 1
    return made
