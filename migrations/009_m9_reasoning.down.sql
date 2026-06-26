-- Alara OS — Migration 009 ROLLBACK
DROP TABLE IF EXISTS missing_information CASCADE;
DROP TABLE IF EXISTS narratives CASCADE;
DROP TABLE IF EXISTS recommendations CASCADE;
DROP TABLE IF EXISTS hypotheses CASCADE;
DELETE FROM schema_migrations WHERE version = '009';
