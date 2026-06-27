-- Alara OS — Migration 012: Consent subject-targeted read index
--
-- Additive only. Backs the hot consent authorization read path
-- (ConsentRepository.findForSubject), which queries Consent objects by
-- tenant, type, and attributes->>'subjectId'. Without this index that read
-- previously scanned every Consent object in the tenant and filtered in app code.
--
-- A partial expression index keyed on the consent subject. Scoped to Consent
-- objects so it stays small and is only consulted for the consent read path.
CREATE INDEX IF NOT EXISTS idx_objects_consent_subject
    ON objects ((attributes->>'subjectId'))
    WHERE type = 'Consent';
