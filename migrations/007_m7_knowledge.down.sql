-- Alara OS — Migration 007 ROLLBACK
DROP TABLE IF EXISTS knowledge_entries CASCADE;
DROP TABLE IF EXISTS observations CASCADE;
DELETE FROM schema_migrations WHERE version = '007';
