/**
 * Policy Evaluator
 *
 * Evaluates security requests against loaded policy rules.
 * Implements priority-based matching with condition evaluation.
 */

import type {
  PolicyDocument,
  PolicyRule,
  PolicyMatch,
  PolicyCondition,
  SecurityRequest,
  SecurityResult,
  PolicyEffect,
} from '../types/index.js'

/**
 * Policy Evaluator
 *
 * Evaluates security requests against policy rules in priority order.
 * First matching rule determines the outcome. If no rule matches,
 * the default effect is applied (deny by default).
 */
export class PolicyEvaluator {
  private rules: PolicyRule[] = []
  private defaultEffect: PolicyEffect
  private evaluationCount = 0
  private totalEvaluationTimeMs = 0

  constructor(defaultEffect: PolicyEffect = 'deny') {
    this.defaultEffect = defaultEffect
  }

  /**
   * Load policies into the evaluator
   * Rules are sorted by priority (highest first)
   */
  loadPolicies(policies: PolicyDocument[]): void {
    // Extract all rules from all policy documents
    const allRules: PolicyRule[] = []
    for (const policy of policies) {
      allRules.push(...policy.rules)
    }

    // Sort by priority (highest first)
    allRules.sort((a, b) => b.priority - a.priority)

    this.rules = allRules
    console.log(`[PolicyEvaluator] Loaded ${allRules.length} rule(s)`)
  }

  /**
   * Evaluate a security request against loaded policies
   * @returns Security result with allow/deny decision
   */
  evaluate(request: SecurityRequest): SecurityResult {
    const startTime = performance.now()

    // Find first matching rule
    for (const rule of this.rules) {
      if (this.matchesRule(request, rule)) {
        const evaluationTimeMs = performance.now() - startTime
        this.updateStats(evaluationTimeMs)

        return {
          allowed: rule.effect === 'allow',
          effect: rule.effect,
          ruleId: rule.id,
          reason: rule.effect === 'deny' ? rule.reason : undefined,
          evaluationTimeMs,
        }
      }
    }

    // No matching rule - apply default effect
    const evaluationTimeMs = performance.now() - startTime
    this.updateStats(evaluationTimeMs)

    return {
      allowed: this.defaultEffect === 'allow',
      effect: this.defaultEffect,
      reason:
        this.defaultEffect === 'deny'
          ? 'No policy rule matched - default deny applied'
          : undefined,
      evaluationTimeMs,
    }
  }

  /**
   * Check if a request matches a rule
   */
  private matchesRule(request: SecurityRequest, rule: PolicyRule): boolean {
    // Check match criteria
    if (!this.matchesCriteria(request, rule.match)) {
      return false
    }

    // Check conditions (if any)
    if (rule.conditions && rule.conditions.length > 0) {
      return this.matchesConditions(request, rule.conditions)
    }

    return true
  }

  /**
   * Check if request matches rule's match criteria
   */
  private matchesCriteria(request: SecurityRequest, match: PolicyMatch): boolean {
    // Check resource type
    if (match.resource) {
      const resources = Array.isArray(match.resource) ? match.resource : [match.resource]
      if (!resources.includes(request.resource.type)) {
        return false
      }
    }

    // Check action type
    if (match.action) {
      const actions = Array.isArray(match.action) ? match.action : [match.action]
      if (!actions.includes(request.action)) {
        return false
      }
    }

    // Check resource ID
    if (match.resourceId) {
      const resourceIds = Array.isArray(match.resourceId)
        ? match.resourceId
        : [match.resourceId]
      if (!resourceIds.includes(request.resource.id)) {
        return false
      }
    }

    return true
  }

  /**
   * Check if request matches all conditions
   */
  private matchesConditions(
    request: SecurityRequest,
    conditions: PolicyCondition[]
  ): boolean {
    // All conditions must match (AND logic)
    for (const condition of conditions) {
      if (!this.matchesCondition(request, condition)) {
        return false
      }
    }
    return true
  }

  /**
   * Check if request matches a single condition
   */
  private matchesCondition(
    request: SecurityRequest,
    condition: PolicyCondition
  ): boolean {
    // Get the field value from the request
    const actualValue = this.getFieldValue(request, condition.field)
    const expectedValue = condition.value

    // Apply operator
    switch (condition.operator) {
      case 'equals':
        return actualValue === expectedValue

      case 'not_equals':
        return actualValue !== expectedValue

      case 'in': {
        if (!Array.isArray(expectedValue)) return false
        return expectedValue.includes(String(actualValue))
      }

      case 'not_in': {
        if (!Array.isArray(expectedValue)) return false
        return !expectedValue.includes(String(actualValue))
      }

      case 'contains': {
        if (typeof actualValue !== 'string' || typeof expectedValue !== 'string')
          return false
        return actualValue.includes(expectedValue)
      }

      case 'matches': {
        if (typeof actualValue !== 'string' || typeof expectedValue !== 'string')
          return false
        try {
          const regex = new RegExp(expectedValue)
          return regex.test(actualValue)
        } catch {
          return false
        }
      }

      case 'starts_with': {
        if (typeof actualValue !== 'string' || typeof expectedValue !== 'string')
          return false
        return actualValue.startsWith(expectedValue)
      }

      case 'ends_with': {
        if (typeof actualValue !== 'string' || typeof expectedValue !== 'string')
          return false
        return actualValue.endsWith(expectedValue)
      }

      default:
        return false
    }
  }

  /**
   * Get field value from request using dot notation
   */
  private getFieldValue(request: SecurityRequest, field: string): any {
    // Handle common fields
    switch (field) {
      case 'security_mode':
        return request.securityMode
      case 'user_id':
        return request.userId
      case 'session_id':
        return request.sessionId
      case 'resource_type':
        return request.resource.type
      case 'resource_id':
        return request.resource.id
      case 'action':
        return request.action
    }

    // Handle metadata fields
    if (field.startsWith('metadata.')) {
      const metadataKey = field.substring(9)
      return request.metadata[metadataKey]
    }

    // Handle nested fields with dot notation
    const parts = field.split('.')
    let value: any = request
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part]
      } else {
        return undefined
      }
    }
    return value
  }

  /**
   * Update evaluation statistics
   */
  private updateStats(evaluationTimeMs: number): void {
    this.evaluationCount++
    this.totalEvaluationTimeMs += evaluationTimeMs
  }

  /**
   * Get evaluation statistics
   */
  getStats(): {
    rulesLoaded: number
    evaluationCount: number
    avgEvaluationTimeMs: number
  } {
    return {
      rulesLoaded: this.rules.length,
      evaluationCount: this.evaluationCount,
      avgEvaluationTimeMs:
        this.evaluationCount > 0 ? this.totalEvaluationTimeMs / this.evaluationCount : 0,
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.evaluationCount = 0
    this.totalEvaluationTimeMs = 0
  }

  /**
   * Get currently loaded rules (for debugging)
   */
  getRules(): PolicyRule[] {
    return [...this.rules]
  }
}
