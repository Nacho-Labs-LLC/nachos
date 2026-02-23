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
import { createLogger } from '@nachos/types';

const logger = createLogger('cheese');

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
      securityMode: config.securityMode,
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
   *
   * Atomic reload: if ANY policy document fails validation, the entire
   * reload is rejected and the previous rule set is retained. On initial
   * load (no previous set), the engine falls back to default deny.
   */
  reload(): void {
    logger.info('Loading policies...');
    const [policies, errors] = this.loader.load();

    if (errors.length > 0) {
      logger.error('Policy validation errors — rejecting entire load:');
      for (const error of errors) {
        logger.error(
          { file: error.file, ruleId: error.ruleId },
          error.message
        );
      }
      this.validationErrors = errors;
      if (this.lastReload) {
        logger.warn('Keeping previous policy set intact');
      } else {
        logger.warn('No valid policies loaded on initial start - using default deny');
      }
      return;
    }

    this.validationErrors = [];
    this.lastReload = new Date();

    if (policies.length > 0) {
      this.evaluator.loadPolicies(policies);
      logger.info({ count: policies.length }, 'Loaded policy document(s) successfully');
    } else {
      logger.warn('No policy files found - using default deny');
    }
  }

  /**
   * Handle policy reload from file watcher
   *
   * Atomic reload: if ANY policy document fails validation, the entire
   * reload is rejected and the previous rule set is retained.
   */
  private handleReload(policies: PolicyDocument[], errors: PolicyValidationError[]): void {
    logger.info('Policies reloaded from disk');

    if (errors.length > 0) {
      logger.error('Validation errors after reload — rejecting entire reload:');
      for (const error of errors) {
        logger.error(
          { file: error.file, ruleId: error.ruleId },
          error.message
        );
      }
      logger.warn('Keeping previous policy set intact');
      // Do NOT update validationErrors or evaluator — previous state is retained
      return;
    }

    this.validationErrors = [];
    this.lastReload = new Date();

    if (policies.length > 0) {
      this.evaluator.loadPolicies(policies);
      logger.info({ count: policies.length }, 'Reloaded policy document(s)');
    } else {
      logger.warn('Reload produced zero policies — keeping previous set');
    }
  }

  /**
   * Handle loader errors
   */
  private handleError(error: Error): void {
    logger.error({ err: error }, 'Policy loader error');
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
