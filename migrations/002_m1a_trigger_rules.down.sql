-- Alara OS — Migration 002 ROLLBACK
DROP TABLE IF EXISTS rule_audit_log CASCADE;
DROP TABLE IF EXISTS rule_sets CASCADE;
DROP TABLE IF EXISTS triggers CASCADE;
DELETE FROM schema_migrations WHERE version = '002';
