-- Alara OS — Migration 012 (down): drop the consent subject-targeted read index.
DROP INDEX IF EXISTS idx_objects_consent_subject;
