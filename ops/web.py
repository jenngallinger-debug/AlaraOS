"""Ops console HTTP layer — server-rendered screens + router.

Exposes a single `handle(method, path, query, headers, body)` that the main
AlaraOS server delegates to for `/ops*` and `/internal/jobs/sla-monitor`. Returns
(status, content_type, body, extra_headers) or None to let the main site handle
the path. Server-rendered HTML forms (no JS/build step) keep this zero-dependency.
"""
import os
import json
import html as H
import hmac
from urllib.parse import parse_qs

from . import db, seed
from .core import now_iso
from .auth import (current_user, verify_login, login_choices, make_session,
                   set_cookie_header, clear_cookie_header, Forbidden)
from . import patients as P
from . import tasks as T

_INITIALIZED = set()


def ensure_initialized():
    path = db.db_path()
    if path in _INITIALIZED:
        return
    db.migrate()
    seed.run()
    _INITIALIZED.add(path)


def _job_token():
    return os.environ.get("OPS_JOB_TOKEN") or "alara-dev-job"


# --- response helpers ---------------------------------------------------------
def esc(s):
    return H.escape("" if s is None else str(s))


def _html(code, body, extra=None):
    return (code, "text/html; charset=utf-8", body, extra or {})


def _json(code, obj):
    return (code, "application/json", json.dumps(obj), {})


def _redirect(location, extra=None):
    h = {"Location": location}
    if extra:
        h.update(extra)
    return (303, "text/html; charset=utf-8", "", h)


def form(body):
    d = parse_qs(body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else (body or ""))
    return {k: v[0] for k, v in d.items()}


def active_users():
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, role FROM app_user WHERE active=1 AND role!='system' ORDER BY role"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# --- chrome -------------------------------------------------------------------
def ops_page(title, body, user=None, active=""):
    nav_items = [("/ops/patients", "Patients"), ("/ops/tasks", "My Queue"),
                 ("/ops/tasks/queue?queue=escalation", "Escalations")]
    nav = "".join(
        '<a href="%s"%s>%s</a>' % (h, ' class="on"' if a == active else "", esc(l))
        for (h, l, a) in [(h, l, h.split("?")[0]) for (h, l) in nav_items])
    whoami = ""
    if user:
        whoami = ('<span class="who">%s <em>%s</em></span>'
                  '<a class="logout" href="/ops/logout">Sign out</a>'
                  % (esc(user["name"]), esc(user["role"])))
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<meta name=\"robots\" content=\"noindex,nofollow\">"
        "<title>" + esc(title) + " &middot; Alara OS</title>"
        "<link rel=\"stylesheet\" href=\"/public/tokens.css\">"
        "<link rel=\"stylesheet\" href=\"/public/ops.css\"></head><body class=\"ops\">"
        "<header class=\"ops-head\"><a class=\"ops-brand\" href=\"/ops/patients\">ALARA&nbsp;OS "
        "<span>v0 &middot; internal</span></a><nav class=\"ops-nav\">" + nav + "</nav>"
        "<div class=\"ops-who\">" + whoami + "</div></header>"
        "<main class=\"ops-main\">" + body + "</main></body></html>")


def _badge(text, kind="n"):
    return '<span class="badge b-%s">%s</span>' % (kind, esc(text))


def _sla_cell(sla_due, status):
    overdue = status in T.OPEN_STATES and sla_due and sla_due < now_iso()
    cls = "overdue" if overdue else ""
    flag = " &#9888;" if overdue else ""
    return '<td class="%s">%s%s</td>' % (cls, esc(sla_due), flag)


# --- auth screens -------------------------------------------------------------
def view_login(msg=""):
    opts = "".join('<option value="%s">%s &mdash; %s</option>'
                   % (esc(u["id"]), esc(u["name"]), esc(u["role"])) for u in login_choices())
    err = '<p class="err">%s</p>' % esc(msg) if msg else ""
    body = (
        '<section class="card narrow"><h1>Alara OS &mdash; sign in</h1>'
        + err +
        '<form method="post" action="/ops/login">'
        '<label>Staff member<select name="user_id" required>' + opts + '</select></label>'
        '<label>Access password<input type="password" name="password" required></label>'
        '<button class="btn" type="submit">Sign in</button></form>'
        '<p class="muted">Internal use only. This console is not indexed and is not the public site.</p>'
        '</section>')
    return ops_page("Sign in", body)


# --- patient screens ----------------------------------------------------------
def view_patient_list(user, query):
    status = query.get("status", [None])[0] if isinstance(query, dict) else None
    q = query.get("q", [None])[0] if isinstance(query, dict) else None
    rows = P.list_patients(user, status=status, q=q)
    if rows:
        trs = "".join(
            '<tr><td><a href="/ops/patients/%s">%s</a></td><td>%s</td><td>%s</td>'
            '<td>%s</td><td>%s</td></tr>'
            % (esc(r["id"]), esc(r["legal_name"] or "(unnamed)"), _badge(r["status"], "s"),
               esc(r.get("care_guide_name") or "—"),
               (_badge(str(r["open_tasks"]), "t") if r["open_tasks"] else "0"),
               esc((r["created_at"] or "")[:10]))
            for r in rows)
        table = ('<table class="grid"><thead><tr><th>Patient</th><th>Status</th>'
                 '<th>Care guide</th><th>Open tasks</th><th>Created</th></tr></thead>'
                 '<tbody>' + trs + '</tbody></table>')
    else:
        table = '<p class="empty">No patients yet &mdash; create the first.</p>'
    body = ('<div class="bar"><h1>Patients</h1>'
            '<a class="btn" href="/ops/patients/new">New patient</a></div>' + table)
    return ops_page("Patients", body, user, active="/ops/patients")


def view_patient_new(user):
    statuses = "".join('<option value="%s">%s</option>' % (s, s)
                       for s in ("identified", "screening", "stub"))
    cgs = "".join('<option value="%s">%s</option>' % (esc(u["id"]), esc(u["name"]))
                  for u in active_users() if u["role"] in ("care_guide", "admin"))
    body = (
        '<div class="bar"><h1>New patient</h1><a class="btn ghost" href="/ops/patients">Cancel</a></div>'
        '<form class="card" method="post" action="/ops/patients">'
        '<label>Legal name<input name="legal_name"></label>'
        '<label>Date of birth<input name="dob" type="date"></label>'
        '<label>EHR MRN<input name="mrn_ehr"></label>'
        '<label>Service area<input name="service_area" value="Southern Nevada"></label>'
        '<label>Status<select name="status">' + statuses + '</select></label>'
        '<label>Care guide<select name="care_guide_id"><option value="">(default)</option>' + cgs + '</select></label>'
        '<button class="btn" type="submit">Create patient</button>'
        '<p class="muted">A patient with no name or MRN is saved as a flagged <em>stub</em>.</p>'
        '</form>')
    return ops_page("New patient", body, user, active="/ops/patients")


def view_patient_detail(user, pid):
    p = P.get_patient(user, pid)
    if not p:
        return _html(404, ops_page("Not found", '<p class="empty">Patient not found.</p>', user))
    ents = "".join('<li>%s %s <span class="muted">%s</span></li>'
                   % (esc(e["program_name"]), _badge(e["status"], "s"), esc(e.get("basis") or ""))
                   for e in p["entitlements"]) or '<li class="muted">None</li>'
    contacts = "".join('<li>%s &mdash; %s %s %s</li>'
                       % (esc(c["name"]), esc(c["role"]), esc(c["phone"] or ""), esc(c["email"] or ""))
                       for c in p["contacts"]) or '<li class="muted">None</li>'
    tasks = "".join('<li><a href="/ops/tasks/%s">%s</a> %s %s</li>'
                    % (esc(t["id"]), esc(t["title"]), _badge(t["status"], "s"),
                       _badge(t["queue"], "q"))
                    for t in p["tasks"]) or '<li class="muted">None</li>'
    auths = "".join('<li>%s %s exp %s</li>'
                    % (esc(a["type"]), _badge(a["status"], "s"), esc(a["expiry_date"] or "—"))
                    for a in p["authorizations"]) or '<li class="muted">None</li>'
    timeline = "".join('<li><span class="t">%s</span> <b>%s</b> <span class="muted">%s</span></li>'
                       % (esc((ev["emitted_at"] or "")[:19]), esc(ev["type"]),
                          esc((ev["payload"] or "")[:120]))
                       for ev in p["timeline"]) or '<li class="muted">No activity yet.</li>'
    status_opts = "".join('<option value="%s"%s>%s</option>'
                          % (s, " selected" if s == p["status"] else "", s)
                          for s in db.ENUMS["patient_status"])
    prog_opts = "".join('<option value="%s">%s</option>' % (c, c)
                        for c in db.ENUMS["program_code"])
    role_opts = "".join('<option value="%s">%s</option>' % (r, r)
                        for r in db.ENUMS["contact_role"])
    can_write = user["role"] in ("care_guide", "admin")
    forms = ""
    if can_write:
        forms = (
            '<div class="cols">'
            '<form class="card" method="post" action="/ops/patients/%s/update">'
            '<h3>Change status</h3><select name="status">%s</select>'
            '<button class="btn sm" type="submit">Update</button></form>'
            '<form class="card" method="post" action="/ops/patients/%s/entitlements">'
            '<h3>Add entitlement</h3><select name="program_code">%s</select>'
            '<input name="basis" placeholder="basis (optional)">'
            '<button class="btn sm" type="submit">Add</button></form>'
            '<form class="card" method="post" action="/ops/patients/%s/contacts">'
            '<h3>Add contact</h3><input name="name" placeholder="name" required>'
            '<input name="relationship" placeholder="relationship">'
            '<select name="role">%s</select>'
            '<input name="phone" placeholder="phone"><input name="email" placeholder="email">'
            '<button class="btn sm" type="submit">Add</button></form>'
            '</div>'
            % (esc(pid), status_opts, esc(pid), prog_opts, esc(pid), role_opts))
    body = (
        '<div class="bar"><h1>%s</h1>%s</div>'
        '<p class="sub">%s &middot; DOB %s &middot; MRN %s &middot; %s</p>'
        '<div class="cols">'
        '<section class="card"><h3>Entitlements</h3><ul>%s</ul></section>'
        '<section class="card"><h3>Contacts</h3><ul>%s</ul></section>'
        '<section class="card"><h3>Open tasks</h3><ul>%s</ul></section>'
        '<section class="card"><h3>Authorizations</h3><ul>%s</ul></section>'
        '</div>%s'
        '<section class="card"><h3>Timeline</h3><ul class="timeline">%s</ul></section>'
        % (esc(p["legal_name"] or "(unnamed)"), _badge(p["status"], "s"),
           esc(p["service_area"] or ""), esc(p["dob"] or "—"), esc(p["mrn_ehr"] or "—"),
           esc((p["created_at"] or "")[:10]), ents, contacts, tasks, auths, forms, timeline))
    return ops_page(p["legal_name"] or "Patient", body, user, active="/ops/patients")


# --- task screens -------------------------------------------------------------
def _task_table(rows, show_owner=False):
    head = ("<tr><th>Task</th><th>Patient</th><th>Queue</th><th>Priority</th>"
            + ("<th>Owner</th>" if show_owner else "") + "<th>Status</th><th>SLA due</th></tr>")
    trs = ""
    for r in rows:
        owner = ("<td>%s</td>" % esc(r.get("owner_name") or r["owner_id"][:8])) if show_owner else ""
        trs += ('<tr><td><a href="/ops/tasks/%s">%s</a></td><td>%s</td><td>%s</td><td>%s</td>%s<td>%s</td>%s</tr>'
                % (esc(r["id"]), esc(r["title"]), esc((r["patient_id"] or "")[:8]),
                   _badge(r["queue"], "q"), _badge(r["priority"], "p"), owner,
                   _badge(r["status"], "s"), _sla_cell(r["sla_due"], r["status"])))
    return '<table class="grid"><thead>' + head + '</thead><tbody>' + trs + '</tbody></table>'


def view_my_queue(user):
    rows = T.list_my_queue(user)
    if rows:
        table = _task_table(rows)
    else:
        table = '<p class="empty">Queue clear.</p>'
    body = '<div class="bar"><h1>My queue</h1></div>' + table
    return ops_page("My queue", body, user, active="/ops/tasks")


def view_queue(user, query):
    queue = query.get("queue", ["escalation"])[0]
    rows = T.list_queue(user, queue=queue)
    # attach owner names
    if rows:
        umap = {u["id"]: u["name"] for u in active_users()}
        for r in rows:
            r["owner_name"] = umap.get(r["owner_id"], r["owner_id"][:8])
        table = _task_table(rows, show_owner=True)
    else:
        table = '<p class="empty">No tasks in this queue.</p>'
    tabs = "".join('<a class="%s" href="/ops/tasks/queue?queue=%s">%s</a>'
                   % ("on" if q == queue else "", q, q)
                   for q in ("escalation", "exception", "judgment", "review"))
    body = ('<div class="bar"><h1>Queues</h1></div><nav class="tabs">' + tabs + '</nav>' + table)
    return ops_page("Queues", body, user, active="/ops/tasks/queue")


def view_task_detail(user, tid):
    t = T.get_task(user, tid)
    if not t:
        return _html(404, ops_page("Not found", '<p class="empty">Task not found.</p>', user))
    conn = db.get_conn()
    try:
        hist = [dict(r) for r in conn.execute(
            "SELECT * FROM audit_log WHERE object_type='task' AND object_id=? ORDER BY ts", (tid,)).fetchall()]
        umap = {u["id"]: u["name"] for u in active_users()}
    finally:
        conn.close()
    is_owner = user["id"] == t["owner_id"] or user["role"] == "admin"
    actions = ""
    if t["status"] in T.OPEN_STATES:
        if is_owner:
            if t["status"] != "in_progress":
                actions += ('<form method="post" action="/ops/tasks/%s/start">'
                            '<button class="btn sm" type="submit">Start</button></form>' % esc(tid))
            actions += ('<form method="post" action="/ops/tasks/%s/complete">'
                        '<button class="btn sm" type="submit">Complete</button></form>' % esc(tid))
        owner_opts = "".join('<option value="%s">%s</option>' % (esc(u["id"]), esc(u["name"]))
                             for u in active_users())
        if user["role"] in ("ops_lead", "don", "admin") or is_owner:
            actions += ('<form method="post" action="/ops/tasks/%s/assign" class="inline">'
                        '<select name="owner_id">%s</select>'
                        '<button class="btn sm ghost" type="submit">Reassign</button></form>'
                        % (esc(tid), owner_opts))
    hist_html = "".join('<li><span class="t">%s</span> <b>%s</b> by %s</li>'
                        % (esc((h["ts"] or "")[:19]), esc(h["action"]),
                           esc(umap.get(h["actor_id"], (h["actor_id"] or "system")[:8])))
                        for h in hist) or '<li class="muted">No history.</li>'
    sla = _sla_cell(t["sla_due"], t["status"])
    body = (
        '<div class="bar"><h1>%s</h1></div>'
        '<table class="kv"><tr><th>Type</th><td>%s</td></tr>'
        '<tr><th>Queue</th><td>%s</td></tr><tr><th>Priority</th><td>%s</td></tr>'
        '<tr><th>Status</th><td>%s</td></tr><tr><th>Owner</th><td>%s</td></tr>'
        '<tr><th>SLA due</th>%s</tr><tr><th>Patient</th><td>%s</td></tr></table>'
        '<div class="actions">%s</div>'
        '<section class="card"><h3>History</h3><ul class="timeline">%s</ul></section>'
        % (esc(t["title"]), esc(t["type"]), _badge(t["queue"], "q"), _badge(t["priority"], "p"),
           _badge(t["status"], "s"), esc(umap.get(t["owner_id"], t["owner_id"][:8])),
           sla, ('<a href="/ops/patients/%s">%s</a>' % (esc(t["patient_id"]), esc(t["patient_id"][:8])) if t["patient_id"] else "&mdash;"),
           actions, hist_html))
    return ops_page(t["title"], body, user, active="/ops/tasks")


def _err_page(user, code, msg):
    return _html(code, ops_page("Error", '<section class="card narrow"><h1>%s</h1>'
                                '<p class="err">%s</p><a class="btn ghost" href="/ops/patients">Back</a></section>'
                                % (code, esc(msg)), user))


# --- router -------------------------------------------------------------------
def handle(method, path, query, headers, body):
    if not (path == "/internal/jobs/sla-monitor" or path == "/ops" or path.startswith("/ops/")):
        return None
    ensure_initialized()
    q = parse_qs(query or "")

    # job worker endpoint (external cron) -------------------------------------
    if path == "/internal/jobs/sla-monitor":
        if method != "POST":
            return _json(405, {"error": "POST only"})
        token = headers.get("X-Job-Token", "") if headers else ""
        if not hmac.compare_digest(token, _job_token()):
            return _json(403, {"error": "invalid job token"})
        return _json(200, {"escalated": T.run_sla_monitor(), "ran_at": now_iso()})

    # auth --------------------------------------------------------------------
    if path == "/ops/login":
        if method == "GET":
            return _html(200, view_login())
        f = form(body)
        user = verify_login(f.get("user_id", ""), f.get("password", ""))
        if not user:
            return _html(200, view_login("Sign-in failed. Check the staff member and password."))
        token = make_session(user["id"])
        return _redirect("/ops/patients", {"Set-Cookie": set_cookie_header(token)})
    if path == "/ops/logout":
        return _redirect("/ops/login", {"Set-Cookie": clear_cookie_header()})

    user = current_user(headers)
    if not user:
        return _redirect("/ops/login")

    seg = path.strip("/").split("/")  # ['ops', ...]
    try:
        if path == "/ops" or seg == ["ops"]:
            return _redirect("/ops/patients")

        # patients
        if seg[1:] == ["patients"]:
            if method == "GET":
                return _html(200, view_patient_list(user, q))
            if method == "POST":
                pid = P.create_patient(user, form(body))
                return _redirect("/ops/patients/%s" % pid)
        if seg[1:] == ["patients", "new"] and method == "GET":
            return _html(200, view_patient_new(user))
        if len(seg) == 3 and seg[1] == "patients" and method == "GET":
            return _html(200, view_patient_detail(user, seg[2]))
        if len(seg) == 4 and seg[1] == "patients" and method == "POST":
            pid, action = seg[2], seg[3]
            f = form(body)
            if action == "update":
                P.update_patient(user, pid, f)
            elif action == "entitlements":
                P.create_entitlement(user, pid, f)
            elif action == "contacts":
                P.add_contact(user, pid, f)
            else:
                return _err_page(user, 404, "Unknown action")
            return _redirect("/ops/patients/%s" % pid)

        # tasks
        if seg[1:] == ["tasks"]:
            if method == "GET":
                return _html(200, view_my_queue(user))
            if method == "POST":
                tid = T.create_task(user, form(body))
                return _redirect("/ops/tasks/%s" % tid)
        if seg[1:] == ["tasks", "queue"] and method == "GET":
            return _html(200, view_queue(user, q))
        if len(seg) == 3 and seg[1] == "tasks" and method == "GET":
            return _html(200, view_task_detail(user, seg[2]))
        if len(seg) == 4 and seg[1] == "tasks" and method == "POST":
            tid, action = seg[2], seg[3]
            if action == "start":
                T.start_task(user, tid)
            elif action == "complete":
                T.complete_task(user, tid)
            elif action == "assign":
                T.assign_task(user, tid, form(body).get("owner_id"))
            else:
                return _err_page(user, 404, "Unknown action")
            return _redirect("/ops/tasks/%s" % tid)

        return _err_page(user, 404, "Page not found")
    except Forbidden as e:
        return _err_page(user, 403, str(e))
    except ValueError as e:
        return _err_page(user, 400, str(e))
