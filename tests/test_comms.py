"""Verification for the Stakeholder Trust Engine (Alara OS v0 — migration v2).

Isolated temp DB. Run from alaraos/:  python3 -m unittest discover -s tests
"""
import os
import sys
import json
import tempfile
import unittest

ALARA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ALARA)
_TMP = tempfile.mkdtemp(prefix="alara_comms_test_")
os.environ["OPS_DB_PATH"] = os.path.join(_TMP, "comms_test.db")

from ops import db, seed  # noqa: E402
from ops import patients as P  # noqa: E402
from ops import stakeholders as SH  # noqa: E402
from ops import comms as C  # noqa: E402
from ops.auth import Forbidden  # noqa: E402


def users():
    conn = db.get_conn()
    try:
        return {r["role"]: dict(r) for r in conn.execute("SELECT * FROM app_user")}
    finally:
        conn.close()


def one(sql, args=()):
    conn = db.get_conn()
    try:
        r = conn.execute(sql, args).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def rows(sql, args=()):
    conn = db.get_conn()
    try:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


class CommsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.migrate()
        seed.run()
        cls.u = users()
        cls.cg = cls.u["care_guide"]
        cls.pid = P.create_patient(cls.cg, {"legal_name": "Maria Vega"})

    # ── seed contract ────────────────────────────────────────────────
    def test_01_seed_templates_and_rules(self):
        self.assertGreater(one("SELECT COUNT(*) c FROM message_template")["c"], 5)
        self.assertGreater(one("SELECT COUNT(*) c FROM communication_rule")["c"], 30)
        # every rule's stakeholder_type is valid
        bad = rows("SELECT DISTINCT stakeholder_type FROM communication_rule WHERE stakeholder_type NOT IN (%s)"
                   % ",".join("'%s'" % t for t in db.ENUMS["stakeholder_type"]))
        self.assertEqual(bad, [])

    # ── stakeholder model ────────────────────────────────────────────
    def test_02_add_stakeholder_seeds_profile_and_pref(self):
        sid = SH.add_stakeholder(self.cg, self.pid, {"type": "physician", "name": "Dr. Lee",
                                                     "email": "lee@clinic.test", "consent_status": "granted"})
        prof = one("SELECT * FROM stakeholder_profile WHERE stakeholder_id=?", (sid,))
        self.assertIsNotNone(prof["job_to_be_done"])
        self.assertTrue(json.loads(prof["update_triggers"]))
        pref = one("SELECT * FROM communication_preference WHERE stakeholder_id=?", (sid,))
        self.assertEqual(pref["category"], "all")
        ev = rows("SELECT * FROM event WHERE type='StakeholderAdded' AND patient_id=?", (self.pid,))
        self.assertGreaterEqual(len(ev), 1)

    def test_03_clinician_cannot_add_stakeholder(self):
        with self.assertRaises(Forbidden):
            SH.add_stakeholder(self.u["clinician"], self.pid, {"type": "family", "name": "X"})

    # ── consent gate ─────────────────────────────────────────────────
    def test_04_missing_consent_suppresses_and_makes_exception_task(self):
        # family with consent 'unknown'
        SH.add_stakeholder(self.cg, self.pid, {"type": "family", "name": "Ana Vega"})
        res = C.record_case_event(self.cg, self.pid, "AuthorizationApproved")
        sup = rows("SELECT * FROM communication_log WHERE patient_id=? AND recipient_type='family' "
                   "AND status='suppressed'", (self.pid,))
        self.assertGreaterEqual(len(sup), 1)
        exc = rows("SELECT * FROM task WHERE patient_id=? AND type='consent_exception'", (self.pid,))
        self.assertGreaterEqual(len(exc), 1)
        self.assertIsNotNone(sup[0]["follow_up_task_id"])

    def test_05_granted_consent_auto_sends(self):
        sid = SH.add_stakeholder(self.cg, self.pid, {"type": "case_manager", "name": "CM Jones",
                                                     "email": "cm@hosp.test", "consent_status": "granted"})
        before = one("SELECT COUNT(*) c FROM notification")["c"]
        C.record_case_event(self.cg, self.pid, "AuthorizationApproved")
        sent = rows("SELECT * FROM communication_log WHERE stakeholder_id=? AND status='sent'", (sid,))
        self.assertGreaterEqual(len(sent), 1)
        self.assertEqual(sent[0]["delivery_status"], "delivered")
        self.assertGreater(one("SELECT COUNT(*) c FROM notification")["c"], before)

    # ── review mode + send ───────────────────────────────────────────
    def test_06_review_mode_drafts_and_send_clears_task(self):
        sid = SH.add_stakeholder(self.cg, self.pid, {"type": "attorney", "name": "Atty Park",
                                                     "email": "park@law.test", "consent_status": "granted"})
        C.record_case_event(self.cg, self.pid, "AuthorizationDenied", {"detail": "Missing causal note."})
        draft = rows("SELECT * FROM communication_log WHERE stakeholder_id=? AND status='drafted'", (sid,))
        self.assertGreaterEqual(len(draft), 1)
        task_id = draft[0]["follow_up_task_id"]
        self.assertIsNotNone(task_id)
        # send it
        C.send_communication(self.cg, draft[0]["id"])
        after = one("SELECT * FROM communication_log WHERE id=?", (draft[0]["id"],))
        self.assertEqual(after["status"], "sent")
        t = one("SELECT * FROM task WHERE id=?", (task_id,))
        self.assertEqual(t["status"], "completed")

    # ── internal task mode ───────────────────────────────────────────
    def test_07_internal_event_creates_role_task(self):
        C.record_case_event(self.cg, self.pid, "ReauthWindowOpened")
        t = rows("SELECT * FROM task WHERE patient_id=? AND type='comm_ReauthWindowOpened'", (self.pid,))
        self.assertGreaterEqual(len(t), 1)
        self.assertEqual(t[0]["role"], "auth_specialist")
        log = rows("SELECT * FROM communication_log WHERE patient_id=? AND recipient_type='auth_specialist' "
                   "AND event_type='ReauthWindowOpened'", (self.pid,))
        self.assertEqual(log[0]["channel"], "inapp")
        self.assertEqual(log[0]["status"], "sent")

    # ── referral intake + stage ──────────────────────────────────────
    def test_08_log_referral_and_stage_progression(self):
        pid = P.create_patient(self.cg, {"legal_name": "Sam Okafor"})
        rid = C.log_referral(self.cg, {"patient_id": pid, "kind": "website_lead", "channel": "email"})
        ref = one("SELECT * FROM referral WHERE id=?", (rid,))
        self.assertEqual(ref["kind"], "website_lead")
        self.assertEqual(ref["stage"], "received")
        # progress the case
        C.record_case_event(self.cg, pid, "CaseAccepted")
        self.assertEqual(one("SELECT stage FROM referral WHERE id=?", (rid,))["stage"], "accepted")
        C.record_case_event(self.cg, pid, "SOCCompleted")
        self.assertEqual(one("SELECT stage FROM referral WHERE id=?", (rid,))["stage"], "active_care")

    # ── record_case_event semantics ──────────────────────────────────
    def test_09_record_case_event_appends_event_and_audit(self):
        before_ev = one("SELECT COUNT(*) c FROM event")["c"]
        before_au = one("SELECT COUNT(*) c FROM audit_log")["c"]
        out = C.record_case_event(self.cg, self.pid, "Discharged")
        self.assertEqual(out["event"], "Discharged")
        self.assertGreaterEqual(out["communications"], 0)
        self.assertGreater(one("SELECT COUNT(*) c FROM event")["c"], before_ev)
        self.assertGreater(one("SELECT COUNT(*) c FROM audit_log")["c"], before_au)

    def test_10_unknown_event_rejected(self):
        with self.assertRaises(ValueError):
            C.record_case_event(self.cg, self.pid, "NotARealEvent")

    # ── pending/suppressed reads (join must not be ambiguous) ────────
    def test_12_list_pending_and_suppressed(self):
        # both queries join communication_log + patient (both have a 'status' col)
        pend = C.list_pending(self.cg, status="drafted")
        supp = C.list_pending(self.cg, status="suppressed")
        self.assertIsInstance(pend, list)
        self.assertIsInstance(supp, list)
        self.assertGreaterEqual(len(supp), 1)  # the family-consent suppression from test_04
        self.assertTrue(all("patient_name" in r for r in supp))

    # ── daily digest ─────────────────────────────────────────────────
    def test_11_daily_digest_generated_and_idempotent(self):
        first = C.run_daily_digest("2026-06-24")
        self.assertGreaterEqual(first, 1)
        second = C.run_daily_digest("2026-06-24")
        self.assertEqual(second, 0)  # idempotent per recipient/day
        dg = rows("SELECT * FROM daily_digest WHERE recipient_user_id=? AND digest_date='2026-06-24'",
                  (self.cg["id"],))
        self.assertGreaterEqual(len(dg), 1)
        self.assertIn("Daily digest", dg[0]["body"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
