/**
 * Alara OS — Rules Registry
 *
 * Manages policy modules and rule sets.
 * M1b loads BD-014, ADR-014, ADR-015 here.
 */

import {
  IRulesRegistry,
  PolicyModule,
  RuleSet,
} from './types';

export class RulesRegistry implements IRulesRegistry {
  private readonly modules = new Map<string, PolicyModule>();
  private readonly ruleSets = new Map<string, RuleSet>();

  registerPolicyModule(module: PolicyModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Policy module "${module.id}" is already registered.`);
    }
    this.modules.set(module.id, module);
  }

  unregisterPolicyModule(moduleId: string): void {
    this.modules.delete(moduleId);
  }

  /**
   * Return all policy modules that apply to a given rule set,
   * sorted by priority (lower = evaluated first).
   */
  getPolicyModulesForRuleSet(ruleSetId: string): PolicyModule[] {
    return Array.from(this.modules.values())
      .filter(m => m.ruleSetIds.includes(ruleSetId) || m.ruleSetIds.includes('*'))
      .sort((a, b) => a.priority - b.priority);
  }

  registerRuleSet(ruleSet: RuleSet): void {
    this.ruleSets.set(ruleSet.id, ruleSet);
  }

  getRuleSet(id: string): RuleSet | undefined {
    return this.ruleSets.get(id);
  }

  getAllRuleSets(): RuleSet[] {
    return Array.from(this.ruleSets.values());
  }
}
