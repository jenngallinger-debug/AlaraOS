"""Verification for Alara OS v0 T1-T3.

Runs against an isolated temp SQLite DB (OPS_DB_PATH set before importing ops).
Run:  python3 -m unittest discover -s tests   (from the alaraos/ directory)
"""
import os
import sys
import tempfile
import unittest

ALARA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ALARA)

# Point the ops layer at a throwaway DB BEFORE importing it.
_TMP = tempfile.mkdtemp(prefix="alara_ops_test_")
os.environ["OPS_DB_PATH"] = os.path.join(_TMP, "ops_test.db")

from ops import db, seed  # noqa: E402
from ops.core import iso_in  # noqa: E402
from ops import patients as P  # noqa: E402
from ops import tasks as T  # noqa: E402
from ops.auth import Forbidden  # noqa: E402


def _users():
    conn = db.get_conn()
    try:
        return {r["role"]: dict(r) for r in conn.execute("SELECT * FROM app_user").fetchall()}
    finally:
        conn.close()


class OpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.migrate()
        seed.run()
        cls.u = _users()

    # T1 ---------------------------------------------------------------
    def test_01_migrations_create_tables(self):
        names = set(db.table_names())
        for t in ("app_user", "program", "patient", "entitlement", "contact",
                  "referral", "authorization", "task", "observation",
                  "event", "audit_log", "schema_migrations", "reauth_config"):
            self.assertIn(t, names, "missing table: %s" % t)
        conn = db.get_conn()
        try:
            v = conn.execute("SELECT MAX(version) v FROM schema_migrations").fetchone()["v"]
            self.assertEqual(v, db.SCHEMA_VERSION)
        finally:
            conn.close()

    def test_02_seed_programs_and_roles(self):
        conn = db.get_conn()
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) c FROM program").fetchone()["c"], 4)
            self.assertIsNotNone(seed.user_by_role(conn, "care_guide"))
            self.assertIsNotNone(seed.system_user_id(conn))
        finally:
            conn.close()

    # T2 ---------------------------------------------------------------
    def test_03_create_patient_emits_event_and_audit(self):
        pid = P.create_patient(self.u["care_guide"], {"legal_name": "Test Patient One"})
        conn = db.get_conn()
        try:
            ev = conn.execute(
                "SELECT * FROM event WHERE type='PatientCreated' AND patient_id=?", (pid,)).fetchall()
            self.assertEqual(len(ev), 1)
            au = conn.execute(
                "SELECT * FROM audit_log WHERE object_type='patient' AND object_id=? AND action='create'",
                (pid,)).fetchall()
            self.assertEqual(len(au), 1)
            self.assertIsNotNone(au[0]["after"])
        finally:
            conn.close()

    def test_04_patient_created_creates_onboarding_task(self):
        pid = P.create_patient(self.u["care_guide"], {"legal_name": "Test Patient Two"})
        conn = db.get_conn()
        try:
            tasks = conn.execute(
                "SELECT * FROM task WHERE patient_id=? AND type='onboarding'", (pid,)).fetchall()
            self.assertEqual(len(tasks), 1)
            t = tasks[0]
            self.assertIsNotNone(t["owner_id"])      # never ownerless
            self.assertIsNotNone(t["sla_due"])       # deadline lives in the system
            self.assertEqual(t["status"], "open")
        finally:
            conn.close()

    def test_05_stub_patient_allowed_when_no_identifiers(self):
        pid = P.create_patient(self.u["care_guide"], {})
        conn = db.get_conn()
        try:
            row = conn.execute("SELECT status FROM patient WHERE id=?", (pid,)).fetchone()
            self.assertEqual(row["status"], "stub")
        finally:
            conn.close()

    def test_06_status_change_emits_event(self):
        pid = P.create_patient(self.u["care_guide"], {"legal_name": "Status Mover"})
        P.update_patient(self.u["care_guide"], pid, {"status": "screening"})
        conn = db.get_conn()
        try:
            ev = conn.execute(
                "SELECT * FROM event WHERE type='PatientStatusChanged' AND patient_id=?", (pid,)).fetchall()
            self.assertEqual(len(ev), 1)
        finally:
            conn.close()

    def test_07_clinician_cannot_create_patient(self):
        with self.assertRaises(Forbidden):
            P.create_patient(self.u["clinician"], {"legal_name": "Should Fail"})

    # T3 ---------------------------------------------------------------
    def test_08_task_requires_owner_and_sla(self):
        with self.assertRaises(ValueError):
            T.create_task(self.u["ops_lead"],
                          {"type": "x", "title": "no owner", "sla_due": iso_in(hours=1)})
        with self.assertRaises(ValueError):
            T.create_task(self.u["ops_lead"],
                          {"type": "x", "title": "no sla", "owner_id": self.u["care_guide"]["id"]})

    def test_09_sla_breach_escalates_task(self):
        tid = T.create_task(self.u["care_guide"], {
            "type": "test", "title": "overdue task", "queue": "judgment",
            "role": "care_guide", "owner_id": self.u["care_guide"]["id"],
            "sla_due": iso_in(hours=-1)})  # already past
        n = T.run_sla_monitor()
        self.assertGreaterEqual(n, 1)
        conn = db.get_conn()
        try:
            t = conn.execute("SELECT * FROM task WHERE id=?", (tid,)).fetchone()
            self.assertEqual(t["status"], "escalated")
            self.assertEqual(t["queue"], "escalation")
            self.assertEqual(t["owner_id"], self.u["ops_lead"]["id"])  # reassigned to supervisor
            ev = {r["type"] for r in conn.execute(
                "SELECT type FROM event WHERE json_extract(payload,'$.task_id')=?", (tid,)).fetchall()}
            self.assertIn("SLABreached", ev)
            self.assertIn("TaskEscalated", ev)
        finally:
            conn.close()

    def test_10_sla_monitor_idempotent(self):
        T.create_task(self.u["care_guide"], {
            "type": "test", "title": "overdue idempotent", "queue": "judgment",
            "role": "care_guide", "owner_id": self.u["care_guide"]["id"],
            "sla_due": iso_in(hours=-2)})
        first = T.run_sla_monitor()
        second = T.run_sla_monitor()
        self.assertGreaterEqual(first, 1)
        self.assertEqual(second, 0)  # already-escalated tasks are skipped

    def test_11_non_owner_cannot_complete_task(self):
        tid = T.create_task(self.u["care_guide"], {
            "type": "test", "title": "owned task", "queue": "judgment",
            "role": "care_guide", "owner_id": self.u["care_guide"]["id"],
            "sla_due": iso_in(hours=6)})
        with self.assertRaises(Forbidden):
            T.complete_task(self.u["auth_specialist"], tid)
        # owner can
        T.complete_task(self.u["care_guide"], tid)
        conn = db.get_conn()
        try:
            t = conn.execute("SELECT status FROM task WHERE id=?", (tid,)).fetchone()
            self.assertEqual(t["status"], "completed")
        finally:
            conn.close()

    # T1 append-only ---------------------------------------------------
    def test_12_event_append_only(self):
        conn = db.get_conn()
        try:
            row = conn.execute("SELECT id FROM event LIMIT 1").fetchone()
            self.assertIsNotNone(row, "need at least one event")
            with self.assertRaises(Exception):
                conn.execute("UPDATE event SET type='x' WHERE id=?", (row["id"],))
                conn.commit()
            with self.assertRaises(Exception):
                conn.execute("DELETE FROM event WHERE id=?", (row["id"],))
                conn.commit()
        finally:
            conn.close()

    def test_13_audit_append_only(self):
        conn = db.get_conn()
        try:
            row = conn.execute("SELECT id FROM audit_log LIMIT 1").fetchone()
            self.assertIsNotNone(row)
            with self.assertRaises(Exception):
                conn.execute("DELETE FROM audit_log WHERE id=?", (row["id"],))
                conn.commit()
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
