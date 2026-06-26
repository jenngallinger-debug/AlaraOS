-- Alara OS — Migration 010 ROLLBACK
DROP TABLE IF EXISTS workforce_teams CASCADE;
DROP TABLE IF EXISTS capacity_snapshots CASCADE;
DROP TABLE IF EXISTS assignments CASCADE;
DROP TABLE IF EXISTS workforce_availability CASCADE;
DROP TABLE IF EXISTS workforce_members CASCADE;
DELETE FROM schema_migrations WHERE version = '010';
