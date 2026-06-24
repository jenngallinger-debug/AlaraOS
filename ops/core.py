"""T1 — service helpers: ids, time, transactions, events, audit, notifications.

These are the only sanctioned ways to mutate the database. Every service action
in T2/T3 goes through `tx()` and calls `write_mutation` (audit) + `emit_event`
(domain event) so the two invariants always hold:
    * every mutation writes audit_log
    * every domain action emits an event
"""
import json
import uuid
import datetime
from contextlib import contextmanager

from . import db


def new_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_in(**delta):
    t = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(**delta)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _dump(v):
    if v is None or isinstance(v, str):
        return v
    return json.dumps(v, default=str, sort_keys=True)


@contextmanager
def tx():
    """Transactional unit of work. Commits on success, rolls back on error."""
    conn = db.get_conn()
    try:
        conn.execute("BEGIN")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def write_mutation(conn, actor_id, action, object_type, object_id, before, after):
    """Append one audit_log row for a state-changing action (== spec writeMutation)."""
    conn.execute(
        "INSERT INTO audit_log(id, actor_id, action, object_type, object_id, before, after, ts) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (new_id(), actor_id, action, object_type, object_id,
         _dump(before), _dump(after), now_iso()),
    )


def emit_event(conn, etype, patient_id, payload, actor_id, source="app"):
    """Append one event row for a domain action. Returns the event id."""
    eid = new_id()
    conn.execute(
        "INSERT INTO event(id, type, patient_id, payload, emitted_at, source, actor_id) "
        "VALUES (?,?,?,?,?,?,?)",
        (eid, etype, patient_id, _dump(payload), now_iso(), source, actor_id),
    )
    return eid


def mutate(conn, actor_id, action, object_type, object_id, before, after, events=None):
    """Mutation wrapper: write the audit row, then emit any domain events.

    `events` is a list of (type, patient_id, payload) tuples. Returns the list of
    emitted event ids (parallel to `events`).
    """
    write_mutation(conn, actor_id, action, object_type, object_id, before, after)
    ids = []
    for etype, patient_id, payload in (events or []):
        ids.append(emit_event(conn, etype, patient_id, payload, actor_id))
    return ids


def queue_notification(conn, recipient_type, recipient_ref, channel, template, payload):
    """Queue an in-system notification (no external send in P0)."""
    conn.execute(
        "INSERT INTO notification(id, recipient_type, recipient_ref, channel, template, payload, status, created_at) "
        "VALUES (?,?,?,?,?,?, 'queued', ?)",
        (new_id(), recipient_type, recipient_ref, channel, template, _dump(payload), now_iso()),
    )


def row_to_dict(row):
    return dict(row) if row is not None else None
