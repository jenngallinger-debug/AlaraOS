"""Alara OS v0 — internal operating system that wraps the bought EHR.

This package is the structured, migration-ready operational substrate for Phase 1
(T1 schema/event/audit foundation, T2 patient case store, T3 task manager + SLA).
It is intentionally zero-dependency: it uses only the Python standard library
(sqlite3, uuid, hmac) so it runs inside the existing AlaraOS http.server.

Design rules that protect the future migration into the full Alara OS:
  * UUID (text) primary keys everywhere.
  * Append-only `event` and `audit_log` tables (enforced by triggers).
  * Every mutation writes audit_log; every domain action emits an event.
  * Every task has an owner and an SLA; no deadline lives outside the system.
  * Enums are CHECK constraints; JSON is stored as TEXT — both map cleanly to
    Postgres (enum types / jsonb) when this is migrated.
"""
__all__ = ["db", "core", "auth", "seed", "patients", "tasks", "web"]
