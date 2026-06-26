-- Alara OS — Migration 011 ROLLBACK
-- Additive migration; rollback drops only the Journey Engine tables.
-- Canonical projections table and proj_type_valid are untouched.
DROP TABLE IF EXISTS journey_capability_tokens CASCADE;
DROP TABLE IF EXISTS journey_projections CASCADE;
DROP TABLE IF EXISTS journey_events CASCADE;
DROP TABLE IF EXISTS journey_references CASCADE;
DROP TABLE IF EXISTS journeys CASCADE;

DELETE FROM schema_migrations WHERE version = '011';
