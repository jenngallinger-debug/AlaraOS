-- Alara OS — Migration 008 ROLLBACK
DROP TABLE IF EXISTS detected_patterns CASCADE;
DELETE FROM schema_migrations WHERE version = '008';
