-- Alara OS — Migration 006 ROLLBACK
DROP TABLE IF EXISTS edges CASCADE;
DROP TABLE IF EXISTS relationships CASCADE;
DELETE FROM schema_migrations WHERE version = '006';
