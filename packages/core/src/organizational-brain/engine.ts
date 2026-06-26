/**
 * Alara OS — Organizational Brain Engine
 *
 * Runs pattern detectors against event streams.
 * Persists detected patterns as first-class objects.
 * Emits canonical events for every pattern state change.
 *
 * The Brain:
 *   DOES: observe, aggregate, correlate, classify, publish
 *   DOES NOT: assign tasks, change workflows, create communications,
 *              execute commands, change permissions, call AI
 *
 * All emitted events and patterns are ADVISORY.
 */

import { DatabaseClient } from '../shared/database';
import { newAlaraId } from '../shared/ids';
import { AlaraId } from '../shared/types';
import { EventStore } from '../events/store';
import { EventType } from '../events/types';
import { PatternDetectorRegistry } from './pattern-detectors/registry';
import { OrganizationalBrainRepository } from './repository';
import {
  DetectedPattern,
  DismissPatternCommand,
  OpportunitySurfacedPayload,
  PatternCategory,
  PatternConfidence,
  PatternDetectedPayload,
  PatternDismissedPayload,
  PatternEvidence,
  PatternNotFoundError,
  PatternResolvedPayload,
  PatternSeverity,
  PatternStatus,
  PatternSupersededPayload,
  ResolvePatternCommand,
  RiskSurfacedPayload,
  RunBrainAnalysisCommand,
  StalePatternError,
  SupersedePatternCommand,
  TrendDetectedPayload,
} from './types';

// ─── Row type ─────────────────────────────────────────────────────────────────

interface PatternRow {
  id: string; tenant_id: string; category: string; title: string;
  description: string; subject_id: string; subject_type: string;
  evidence: unknown; confidence: string; severity: string; status: string;
  detector_id: string; detector_version: string; superseded_by_id: string | null;
  first_detected_at: string; last_confirmed_at: string;
  resolved_at: string | null; version: number;
}

// ─── Brain Analysis Result ─────────────────────────────────────────────────────

export interface BrainAnalysisResult {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly patternsDetected: readonly DetectedPattern[];
  readonly patternsResolved: readonly string[];
  readonly eventIds: readonly string[];
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class OrganizationalBrainEngine {
  readonly repo: OrganizationalBrainRepository;

  constructor(
    private readonly db: DatabaseClient,
    private readonly eventStore: EventStore,
    private readonly registry: PatternDetectorRegistry,
  ) {
    this.repo = new OrganizationalBrainRepository(db);
  }

  /**
   * Run all registered pattern detectors against the subject's event stream.
   * Persist new patterns. Resolve patterns that are no longer detected.
   * Emit canonical events for all state changes.
   *
   * This is the primary Brain operation.
   * It is READ-ONLY from the perspective of the operational OS —
   * it only writes to the detected_patterns table and appends to the event store.
   * It never touches objects, workflows, tasks, promises, or communications.
   */
  async runAnalysis(cmd: RunBrainAnalysisCommand): Promise<BrainAnalysisResult> {
    const events = await this.eventStore.loadStream(cmd.tenantId, cmd.subjectId as AlaraId);
    const activePatterns = await this.repo.getActivePatternsForSubject(cmd.tenantId, cmd.subjectId);

    const newPatterns: DetectedPattern[] = [];
    const resolvedPatternIds: string[] = [];
    const eventIds: string[] = [];

    for (const detector of this.registry.getAll()) {
      const result = detector.detect({
        tenantId: cmd.tenantId,
        subjectId: cmd.subjectId,
        subjectType: cmd.subjectType,
        events,
        activePatterns,
      });

      // Persist new patterns
      for (const p of result.patternsDetected) {
        // Deduplication: don't create a second active pattern for same detector+subject
        const existing = await this.repo.getPatternByDetectorAndSubject(
          cmd.tenantId, detector.id, cmd.subjectId,
        );
        if (existing) continue;

        const pattern = await this.persistPattern(cmd.tenantId, p, cmd.actor);
        newPatterns.push(pattern);

        // Emit primary event
        const evtId = await this.emitPatternEvent(cmd.tenantId, pattern, cmd.actor);
        eventIds.push(evtId);
      }

      // Resolve patterns below threshold
      for (const patternId of result.patternsToResolve) {
        const pattern = await this.repo.getPatternById(cmd.tenantId, patternId as AlaraId);
        if (!pattern || pattern.status !== 'active') continue;

        await this.db.transaction(async (client) => {
          await client.query(
            `UPDATE detected_patterns SET status = 'resolved', resolved_at = NOW(), version = version + 1
             WHERE id = $1 AND tenant_id = $2`,
            [patternId, cmd.tenantId],
          );
        });

        const payload: PatternResolvedPayload = {
          patternId,
          category: pattern.category,
          previousVersion: pattern.version,
        };
        const evt = await this.eventStore.append({
          tenantId: cmd.tenantId,
          streamId: patternId as AlaraId,
          type: 'PatternResolved' as EventType,
          payload: payload as unknown as Record<string, unknown>,
          actor: cmd.actor,
        });
        resolvedPatternIds.push(patternId);
        eventIds.push(evt.id);
      }
    }

    return {
      tenantId: cmd.tenantId,
      subjectId: cmd.subjectId,
      subjectType: cmd.subjectType,
      patternsDetected: newPatterns,
      patternsResolved: resolvedPatternIds,
      eventIds,
    };
  }

  async resolvePattern(cmd: ResolvePatternCommand): Promise<void> {
    const pattern = await this.repo.getPatternById(cmd.tenantId, cmd.patternId);
    if (!pattern) throw new PatternNotFoundError(cmd.patternId);
    if (pattern.version !== cmd.expectedVersion) throw new StalePatternError(cmd.patternId, cmd.expectedVersion, pattern.version);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE detected_patterns SET status = 'resolved', resolved_at = NOW(), version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.patternId, cmd.tenantId, cmd.expectedVersion],
      );
    });

    const payload: PatternResolvedPayload = { patternId: String(cmd.patternId), category: pattern.category, previousVersion: cmd.expectedVersion };
    await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.patternId, type: 'PatternResolved' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor });
  }

  async dismissPattern(cmd: DismissPatternCommand): Promise<void> {
    const pattern = await this.repo.getPatternById(cmd.tenantId, cmd.patternId);
    if (!pattern) throw new PatternNotFoundError(cmd.patternId);
    if (pattern.version !== cmd.expectedVersion) throw new StalePatternError(cmd.patternId, cmd.expectedVersion, pattern.version);

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE detected_patterns SET status = 'dismissed', version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND version = $3`,
        [cmd.patternId, cmd.tenantId, cmd.expectedVersion],
      );
    });

    const payload: PatternDismissedPayload = { patternId: String(cmd.patternId), reason: cmd.reason, previousVersion: cmd.expectedVersion };
    await this.eventStore.append({ tenantId: cmd.tenantId, streamId: cmd.patternId, type: 'PatternDismissed' as EventType, payload: payload as unknown as Record<string, unknown>, actor: cmd.actor });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async persistPattern(
    tenantId: string,
    p: Omit<DetectedPattern, 'id' | 'tenantId' | 'firstDetectedAt' | 'lastConfirmedAt' | 'resolvedAt' | 'version' | 'supersededById'>,
    actor: string,
  ): Promise<DetectedPattern> {
    return this.db.transaction(async (client) => {
      const id = newAlaraId();
      await client.query(
        `INSERT INTO detected_patterns
           (id, tenant_id, category, title, description, subject_id, subject_type,
            evidence, confidence, severity, status, detector_id, detector_version, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)`,
        [
          id, tenantId, p.category, p.title, p.description,
          p.subjectId, p.subjectType,
          JSON.stringify(p.evidence), p.confidence, p.severity, 'active',
          p.detectorId, p.detectorVersion,
        ],
      );
      return (await this.repo.getPatternById(tenantId, id))!;
    });
  }

  private async emitPatternEvent(
    tenantId: string,
    pattern: DetectedPattern,
    actor: string,
  ): Promise<string> {
    // Primary: PatternDetected
    const basePayload: PatternDetectedPayload = {
      patternId: String(pattern.id),
      category: pattern.category,
      title: pattern.title,
      severity: pattern.severity,
      confidence: pattern.confidence,
      subjectId: pattern.subjectId,
      subjectType: pattern.subjectType,
      detectorId: pattern.detectorId,
    };

    const evt = await this.eventStore.append({
      tenantId,
      streamId: pattern.id,
      type: 'PatternDetected' as EventType,
      payload: basePayload as unknown as Record<string, unknown>,
      actor,
    });

    // Additional semantic events for critical patterns
    if (pattern.severity === 'critical' || pattern.severity === 'high') {
      const riskPayload: RiskSurfacedPayload = {
        patternId: String(pattern.id),
        title: pattern.title,
        severity: pattern.severity,
        subjectId: pattern.subjectId,
        subjectType: pattern.subjectType,
      };
      await this.eventStore.append({
        tenantId,
        streamId: pattern.id,
        type: 'RiskSurfaced' as EventType,
        payload: riskPayload as unknown as Record<string, unknown>,
        actor,
      });
    }

    if (pattern.severity === 'info') {
      const oppPayload: OpportunitySurfacedPayload = {
        patternId: String(pattern.id),
        title: pattern.title,
        subjectId: pattern.subjectId,
        subjectType: pattern.subjectType,
      };
      await this.eventStore.append({
        tenantId,
        streamId: pattern.id,
        type: 'OpportunitySurfaced' as EventType,
        payload: oppPayload as unknown as Record<string, unknown>,
        actor,
      });
    }

    return evt.id;
  }
}

// ─── Event-sourced reconstruction ─────────────────────────────────────────────

export interface ReconstructedPattern {
  id: AlaraId;
  status: PatternStatus;
  category: PatternCategory;
  severity: PatternSeverity;
  confidence: PatternConfidence;
  version: number;
  supersededById: string | null;
}

export async function reconstructPatternFromEvents(
  eventStore: EventStore,
  tenantId: string,
  patternId: AlaraId,
): Promise<ReconstructedPattern | null> {
  const events = await eventStore.loadStream(tenantId, patternId);
  if (!events.length) return null;

  let status: PatternStatus = 'active';
  let category: PatternCategory = 'organizational';
  let severity: PatternSeverity = 'info';
  let confidence: PatternConfidence = 'low';
  let version = 0;
  let supersededById: string | null = null;

  for (const event of events) {
    version++;
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'PatternDetected':
        category = p.category as PatternCategory;
        severity = p.severity as PatternSeverity;
        confidence = p.confidence as PatternConfidence;
        break;
      case 'PatternResolved':   status = 'resolved'; break;
      case 'PatternDismissed':  status = 'dismissed'; break;
      case 'PatternSuperseded': status = 'superseded'; supersededById = p.newPatternId as string; break;
    }
  }

  return { id: patternId, status, category, severity, confidence, version, supersededById };
}
