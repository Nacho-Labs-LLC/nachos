import { describe, it, expect, beforeEach } from 'vitest'
import { PolicyEvaluator } from './evaluator.js'
import type { PolicyDocument, SecurityRequest } from '../types/index.js'

describe('PolicyEvaluator', () => {
  let evaluator: PolicyEvaluator

  beforeEach(() => {
    evaluator = new PolicyEvaluator('deny')
  })

  describe('Basic Evaluation', () => {
    it('should allow when rule matches with allow effect', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-tool-read',
            priority: 100,
            match: {
              resource: 'tool',
              action: 'read',
            },
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request: SecurityRequest = {
        requestId: 'test-1',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: {
          type: 'tool',
          id: 'browser',
        },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      const result = evaluator.evaluate(request)
      expect(result.allowed).toBe(true)
      expect(result.effect).toBe('allow')
      expect(result.ruleId).toBe('allow-tool-read')
    })

    it('should deny when rule matches with deny effect', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'deny-shell',
            priority: 100,
            match: {
              resource: 'tool',
              resourceId: 'shell',
            },
            effect: 'deny',
            reason: 'Shell access is not allowed',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request: SecurityRequest = {
        requestId: 'test-2',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: {
          type: 'tool',
          id: 'shell',
        },
        action: 'execute',
        metadata: {},
        timestamp: new Date(),
      }

      const result = evaluator.evaluate(request)
      expect(result.allowed).toBe(false)
      expect(result.effect).toBe('deny')
      expect(result.ruleId).toBe('deny-shell')
      expect(result.reason).toBe('Shell access is not allowed')
    })

    it('should apply default deny when no rule matches', () => {
      evaluator.loadPolicies([])

      const request: SecurityRequest = {
        requestId: 'test-3',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: {
          type: 'tool',
          id: 'browser',
        },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      const result = evaluator.evaluate(request)
      expect(result.allowed).toBe(false)
      expect(result.effect).toBe('deny')
      expect(result.ruleId).toBeUndefined()
      expect(result.reason).toContain('default deny')
    })

    it('should evaluate rules in priority order', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'low-priority-deny',
            priority: 50,
            match: {
              resource: 'tool',
            },
            effect: 'deny',
          },
          {
            id: 'high-priority-allow',
            priority: 100,
            match: {
              resource: 'tool',
            },
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request: SecurityRequest = {
        requestId: 'test-4',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: {
          type: 'tool',
          id: 'browser',
        },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      const result = evaluator.evaluate(request)
      expect(result.allowed).toBe(true)
      expect(result.ruleId).toBe('high-priority-allow')
    })
  })

  describe('Match Criteria', () => {
    it('should match specific resource ID', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-browser',
            priority: 100,
            match: {
              resource: 'tool',
              resourceId: 'browser',
            },
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      // Should match browser
      const request1: SecurityRequest = {
        requestId: 'test-5',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'browser' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(request1).allowed).toBe(true)

      // Should not match shell
      const request2: SecurityRequest = {
        ...request1,
        resource: { type: 'tool', id: 'shell' },
      }

      expect(evaluator.evaluate(request2).allowed).toBe(false)
    })

    it('should match multiple resource IDs', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-safe-tools',
            priority: 100,
            match: {
              resource: 'tool',
              resourceId: ['browser', 'web_search'],
            },
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request1: SecurityRequest = {
        requestId: 'test-6',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'browser' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(request1).allowed).toBe(true)

      const request2: SecurityRequest = {
        ...request1,
        resource: { type: 'tool', id: 'web_search' },
      }

      expect(evaluator.evaluate(request2).allowed).toBe(true)
    })

    it('should match multiple actions', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-read-write',
            priority: 100,
            match: {
              resource: 'filesystem',
              action: ['read', 'write'],
            },
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const baseRequest: SecurityRequest = {
        requestId: 'test-7',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'filesystem', id: 'workspace' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(baseRequest).allowed).toBe(true)
      expect(evaluator.evaluate({ ...baseRequest, action: 'write' }).allowed).toBe(true)
      expect(evaluator.evaluate({ ...baseRequest, action: 'execute' }).allowed).toBe(false)
    })
  })

  describe('Condition Evaluation', () => {
    it('should evaluate equals condition', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-standard-mode',
            priority: 100,
            match: { resource: 'tool' },
            conditions: [
              {
                field: 'security_mode',
                operator: 'equals',
                value: 'standard',
              },
            ],
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request1: SecurityRequest = {
        requestId: 'test-8',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'browser' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(request1).allowed).toBe(true)

      const request2: SecurityRequest = {
        ...request1,
        securityMode: 'strict',
      }

      expect(evaluator.evaluate(request2).allowed).toBe(false)
    })

    it('should evaluate in condition', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-relaxed-modes',
            priority: 100,
            match: { resource: 'tool' },
            conditions: [
              {
                field: 'security_mode',
                operator: 'in',
                value: ['standard', 'permissive'],
              },
            ],
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const baseRequest: SecurityRequest = {
        requestId: 'test-9',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'browser' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(baseRequest).allowed).toBe(true)
      expect(evaluator.evaluate({ ...baseRequest, securityMode: 'permissive' }).allowed).toBe(
        true
      )
      expect(evaluator.evaluate({ ...baseRequest, securityMode: 'strict' }).allowed).toBe(false)
    })

    it('should evaluate starts_with condition', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-workspace-files',
            priority: 100,
            match: { resource: 'filesystem' },
            conditions: [
              {
                field: 'metadata.path',
                operator: 'starts_with',
                value: './workspace',
              },
            ],
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request1: SecurityRequest = {
        requestId: 'test-10',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'filesystem', id: 'file' },
        action: 'read',
        metadata: { path: './workspace/file.txt' },
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(request1).allowed).toBe(true)

      const request2: SecurityRequest = {
        ...request1,
        metadata: { path: './etc/passwd' },
      }

      expect(evaluator.evaluate(request2).allowed).toBe(false)
    })

    it('should evaluate matches (regex) condition', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-specific-users',
            priority: 100,
            match: { resource: 'dm' },
            conditions: [
              {
                field: 'user_id',
                operator: 'matches',
                value: '^admin-.*',
              },
            ],
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request1: SecurityRequest = {
        requestId: 'test-11',
        userId: 'admin-123',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'dm', id: 'dm-1' },
        action: 'send',
        metadata: {},
        timestamp: new Date(),
      }

      expect(evaluator.evaluate(request1).allowed).toBe(true)

      const request2: SecurityRequest = {
        ...request1,
        userId: 'user-123',
      }

      expect(evaluator.evaluate(request2).allowed).toBe(false)
    })

    it('should require all conditions to match (AND logic)', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'allow-specific-combo',
            priority: 100,
            match: { resource: 'tool' },
            conditions: [
              {
                field: 'security_mode',
                operator: 'equals',
                value: 'standard',
              },
              {
                field: 'metadata.explicitly_enabled',
                operator: 'equals',
                value: true,
              },
            ],
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const baseRequest: SecurityRequest = {
        requestId: 'test-12',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'shell' },
        action: 'execute',
        metadata: { explicitly_enabled: true },
        timestamp: new Date(),
      }

      // Both conditions match
      expect(evaluator.evaluate(baseRequest).allowed).toBe(true)

      // Wrong mode
      expect(
        evaluator.evaluate({ ...baseRequest, securityMode: 'strict' }).allowed
      ).toBe(false)

      // Not enabled
      expect(
        evaluator.evaluate({
          ...baseRequest,
          metadata: { explicitly_enabled: false },
        }).allowed
      ).toBe(false)
    })
  })

  describe('Performance', () => {
    it('should evaluate in less than 1ms', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: Array.from({ length: 100 }, (_, i) => ({
          id: `rule-${i}`,
          priority: 1000 - i,
          match: {
            resource: 'tool',
            resourceId: `tool-${i}`,
          },
          effect: 'allow' as const,
        })),
      }

      evaluator.loadPolicies([policy])

      const request: SecurityRequest = {
        requestId: 'test-perf',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'tool-99' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      const result = evaluator.evaluate(request)
      expect(result.evaluationTimeMs).toBeLessThan(1)
    })
  })

  describe('Statistics', () => {
    it('should track evaluation statistics', () => {
      const policy: PolicyDocument = {
        version: '1.0',
        rules: [
          {
            id: 'test-rule',
            priority: 100,
            match: {},
            effect: 'allow',
          },
        ],
      }

      evaluator.loadPolicies([policy])

      const request: SecurityRequest = {
        requestId: 'test-stats',
        userId: 'user-1',
        sessionId: 'session-1',
        securityMode: 'standard',
        resource: { type: 'tool', id: 'browser' },
        action: 'read',
        metadata: {},
        timestamp: new Date(),
      }

      evaluator.evaluate(request)
      evaluator.evaluate(request)
      evaluator.evaluate(request)

      const stats = evaluator.getStats()
      expect(stats.evaluationCount).toBe(3)
      expect(stats.rulesLoaded).toBe(1)
      expect(stats.avgEvaluationTimeMs).toBeGreaterThan(0)
    })
  })
})
