-- Alara OS — Migration 005 ROLLBACK
DROP TABLE IF EXISTS communications CASCADE;
DELETE FROM schema_migrations WHERE version = '005';
