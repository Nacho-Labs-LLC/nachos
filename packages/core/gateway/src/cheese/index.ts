/**
 * Cheese Policy Engine
 *
 * Main entry point for the embedded policy engine.
 * Combines loader and evaluator with hot-reload support.
 */

import type {
  PolicyEngineConfig,
  PolicyEngineStats,
  SecurityRequest,
  SecurityResult,
  PolicyDocument,
  PolicyValidationError,
} from './types/index.js';
import { PolicyLoader } from './policy/loader.js';
import { PolicyEvaluator } from './policy/evaluator.js';

/**
 * Cheese Policy Engine
 *
 * Embedded security policy engine for Gateway.
 * Provides <1ms policy evaluation with hot-reload support.
 */
export class Cheese {
  private loader: PolicyLoader;
  private evaluator: PolicyEvaluator;
  private lastReload: Date | null = null;
  private validationErrors: PolicyValidationError[] = [];

  constructor(config: PolicyEngineConfig) {
    // Create evaluator with default deny
    this.evaluator = new PolicyEvaluator(config.defaultEffect);

    // Create loader
    this.loader = new PolicyLoader({
      policiesPath: config.policiesPath,
      enableHotReload: config.enableHotReload,
      onReload: (policies, errors) => this.handleReload(policies, errors),
      onError: (error) => this.handleError(error),
    });

    // Initial load
    this.reload();

    // Start watching if enabled
    if (config.enableHotReload) {
      this.loader.startWatching();
    }
  }

  /**
   * Evaluate a security request against loaded policies
   * @param request - Security request to evaluate
   * @returns Security result with allow/deny decision
   */
  evaluate(request: SecurityRequest): SecurityResult {
    return this.evaluator.evaluate(request);
  }

  /**
   * Reload policies from disk
   */
  reload(): void {
    console.log('[Cheese] Loading policies...');
    const [policies, errors] = this.loader.load();

    this.validationErrors = errors;
    this.lastReload = new Date();

    if (errors.length > 0) {
      console.error('[Cheese] Policy validation errors:');
      for (const error of errors) {
        console.error(
          `  [${error.file}${error.ruleId ? `:${error.ruleId}` : ''}] ${error.message}`
        );
      }
    }

    // Load valid policies into evaluator
    if (policies.length > 0) {
      this.evaluator.loadPolicies(policies);
      console.log(`[Cheese] Loaded ${policies.length} policy document(s) successfully`);
    } else {
      console.warn('[Cheese] No valid policies loaded - using default deny');
    }
  }

  /**
   * Handle policy reload from file watcher
   */
  private handleReload(policies: PolicyDocument[], errors: PolicyValidationError[]): void {
    console.log('[Cheese] Policies reloaded from disk');
    this.validationErrors = errors;
    this.lastReload = new Date();

    if (errors.length > 0) {
      console.error('[Cheese] Validation errors after reload:');
      for (const error of errors) {
        console.error(
          `  [${error.file}${error.ruleId ? `:${error.ruleId}` : ''}] ${error.message}`
        );
      }
    }

    if (policies.length > 0) {
      this.evaluator.loadPolicies(policies);
      console.log(`[Cheese] Reloaded ${policies.length} policy document(s)`);
    }
  }

  /**
   * Handle loader errors
   */
  private handleError(error: Error): void {
    console.error('[Cheese] Policy loader error:', error);
  }

  /**
   * Get engine statistics
   */
  getStats(): PolicyEngineStats {
    const evalStats = this.evaluator.getStats();
    const policies = this.loader.getPolicies();

    return {
      policiesLoaded: policies.length,
      rulesActive: evalStats.rulesLoaded,
      evaluationsTotal: evalStats.evaluationCount,
      avgEvaluationTimeMs: evalStats.avgEvaluationTimeMs,
      lastReload: this.lastReload ?? undefined,
    };
  }

  /**
   * Get current validation errors
   */
  getValidationErrors(): PolicyValidationError[] {
    return this.validationErrors;
  }

  /**
   * Check if engine has validation errors
   */
  hasValidationErrors(): boolean {
    return this.validationErrors.length > 0;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.loader.destroy();
  }
}

/**
 * Create a Cheese instance with sensible defaults
 */
export function createCheese(
  policiesPath: string,
  securityMode: 'strict' | 'standard' | 'permissive' = 'standard'
): Cheese {
  return new Cheese({
    policiesPath,
    securityMode,
    enableHotReload: true,
    defaultEffect: 'deny', // Secure by default
  });
}

// Re-export types for convenience
export type {
  PolicyEngineConfig,
  PolicyEngineStats,
  SecurityRequest,
  SecurityResult,
  PolicyValidationError,
  PolicyDocument,
  PolicyRule,
} from './types/index.js';
