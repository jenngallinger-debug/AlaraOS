/**
 * Alara OS — Pattern Detector Registry
 *
 * Manages registered PatternDetector implementations.
 * The Brain queries the registry to run all detectors for a subject.
 */

import { PatternCategory, PatternDetector } from '../types';

export class PatternDetectorRegistry {
  private readonly detectors = new Map<string, PatternDetector>();

  register(detector: PatternDetector): void {
    if (this.detectors.has(detector.id)) {
      throw new Error(`Pattern detector "${detector.id}" already registered.`);
    }
    this.detectors.set(detector.id, detector);
  }

  getAll(): PatternDetector[] {
    return Array.from(this.detectors.values());
  }

  getByCategory(category: PatternCategory): PatternDetector[] {
    return Array.from(this.detectors.values()).filter(d => d.category === category);
  }

  get(id: string): PatternDetector | undefined {
    return this.detectors.get(id);
  }

  has(id: string): boolean {
    return this.detectors.has(id);
  }
}
