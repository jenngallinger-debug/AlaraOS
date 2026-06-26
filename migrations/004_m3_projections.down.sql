-- Alara OS — Migration 004 ROLLBACK
-- Safe to run — the projections table is a cache. No truth is lost.
DROP TABLE IF EXISTS projections CASCADE;
DELETE FROM schema_migrations WHERE version = '004';
