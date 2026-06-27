/**
 * Alara OS — Identity Resolution Phase 2: deterministic matcher
 *
 * Proves classification (docs/architecture/identity-resolution-spec.md §4, §4.1):
 *   - exact external reference → MATCH
 *   - identifying evidence but no reference → NO_MATCH
 *   - empty input → INSUFFICIENT_EVIDENCE
 *   - multiple candidates (id collision) → POSSIBLE_MATCH_REVIEW_REQUIRED
 *   - conflicting demographic evidence on a match → POSSIBLE_MATCH_REVIEW_REQUIRED
 *   - deterministic output for the same input
 *   - no demographic auto-match (demographics never produce a MATCH)
 */

import { ObjectCommandHandler } from '../src/object-graph/command-handler';
import { EventStore } from '../src/events/store';
import { ObjectGraphRepository } from '../src/object-graph/repository';
import { IdentityResolutionRepository, IdentityResolutionEngine } from '../src/identity-resolution';
import { DatabaseClient } from '../src/shared/database';
import { InMemoryStore } from './helpers/in-memory-store';

const TENANT = 'tenant-1';
const REF = { system: 'Automynd', extType: 'patient_id', value: 'AM-883201' };

function setup() {
  const store = new InMemoryStore();
  const db = store as unknown as DatabaseClient;
  const repo = new ObjectGraphRepository(db);
  const eventStore = new EventStore(db);
  const handler = new ObjectCommandHandler(db, repo, eventStore);
  const engine = new IdentityResolutionEngine(new IdentityResolutionRepository(db));
  return { store, handler, engine };
}

describe('Identity Resolution — deterministic matcher (Phase 2)', () => {
  test('exact external reference → MATCH', async () => {
    const { handler, engine } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const r = await engine.resolve({ tenantId: TENANT, externalReferences: [REF] });
    expect(r.outcome).toBe('MATCH');
    expect(r.matchedPatientId).toBe(patient.id);
    expect(r.reasonCodes).toContain('exact_external_reference');
  });

  test('identifying evidence but no reference → NO_MATCH', async () => {
    const { engine } = setup();
    const r = await engine.resolve({ tenantId: TENANT, name: 'Jane Doe' });
    expect(r.outcome).toBe('NO_MATCH');
    expect(r.matchedPatientId).toBeUndefined();
    expect(r.reasonCodes).toContain('no_external_reference_match');
  });

  test('empty input → INSUFFICIENT_EVIDENCE', async () => {
    const { engine } = setup();
    const r = await engine.resolve({ tenantId: TENANT });
    expect(r.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.reasonCodes).toContain('no_identifying_evidence');
  });

  test('multiple candidates (id collision) → POSSIBLE_MATCH_REVIEW_REQUIRED', async () => {
    const { handler, engine } = setup();
    const { object: p1 } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    const { object: p2 } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, p1.id, REF, 'system');
    await handler.addExternalReference(TENANT, p2.id, REF, 'system');

    const r = await engine.resolve({ tenantId: TENANT, externalReferences: [REF] });
    expect(r.outcome).toBe('POSSIBLE_MATCH_REVIEW_REQUIRED');
    expect(r.matchedPatientId).toBeUndefined();
    expect(r.candidateIds.sort()).toEqual([p1.id, p2.id].sort());
    expect(r.reasonCodes).toContain('multiple_candidates');
    expect(r.conflicts.every((c) => c.code === 'ID_COLLISION')).toBe(true);
  });

  test('conflicting demographic evidence on a match → POSSIBLE_MATCH_REVIEW_REQUIRED', async () => {
    const { handler, engine } = setup();
    const { object: patient } = await handler.createObject({
      tenantId: TENANT, type: 'Patient', actor: 'system', attributes: { dob: '1950-01-01' },
    });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const r = await engine.resolve({ tenantId: TENANT, externalReferences: [REF], dob: '1960-02-02' });
    expect(r.outcome).toBe('POSSIBLE_MATCH_REVIEW_REQUIRED');
    expect(r.reasonCodes).toContain('conflicting_evidence');
    expect(r.conflicts.some((c) => c.code === 'DOB_MISMATCH')).toBe(true);
  });

  test('no demographic auto-match — demographics alone never produce a MATCH', async () => {
    const { handler, engine } = setup();
    // A Patient exists with matching name/dob but the input carries NO external reference.
    const { object: patient } = await handler.createObject({
      tenantId: TENANT, type: 'Patient', actor: 'system', attributes: { name: 'Jane Doe', dob: '1950-01-01' },
    });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const r = await engine.resolve({ tenantId: TENANT, name: 'Jane Doe', dob: '1950-01-01' });
    expect(r.outcome).toBe('NO_MATCH'); // not MATCH — no external reference in the input
  });

  test('deterministic output for the same input', async () => {
    const { handler, engine } = setup();
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');

    const a = await engine.resolve({ tenantId: TENANT, externalReferences: [REF] });
    const b = await engine.resolve({ tenantId: TENANT, externalReferences: [REF] });
    expect(a).toEqual(b);
  });

  test('multiple references resolving to the same single Patient → MATCH (deduped)', async () => {
    const { handler, engine } = setup();
    const ref2 = { system: 'VA', extType: 'auth_id', value: 'VA-1' };
    const { object: patient } = await handler.createObject({ tenantId: TENANT, type: 'Patient', actor: 'system' });
    await handler.addExternalReference(TENANT, patient.id, REF, 'system');
    await handler.addExternalReference(TENANT, patient.id, ref2, 'system');

    const r = await engine.resolve({ tenantId: TENANT, externalReferences: [REF, ref2] });
    expect(r.outcome).toBe('MATCH');
    expect(r.candidateIds).toEqual([patient.id]);
  });
});
