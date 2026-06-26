-- Alara OS — Migration 001 ROLLBACK
-- Tears down the M0 spine tables in reverse dependency order.

DROP TABLE IF EXISTS external_references CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS objects CASCADE;
DROP FUNCTION IF EXISTS set_updated_at CASCADE;
DELETE FROM schema_migrations WHERE version = '001';
