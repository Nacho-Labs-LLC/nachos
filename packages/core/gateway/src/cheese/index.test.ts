import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Cheese, createCheese } from './index.js';
import type { SecurityRequest } from './types/index.js';

describe('Cheese', () => {
  const testPoliciesDir = '/tmp/cheese-test-policies';

  beforeEach(() => {
    // Create test policies directory
    if (existsSync(testPoliciesDir)) {
      rmSync(testPoliciesDir, { recursive: true, force: true });
    }
    mkdirSync(testPoliciesDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testPoliciesDir)) {
      rmSync(testPoliciesDir, { recursive: true, force: true });
    }
  });

  describe('Construction', () => {
    it('should create Cheese instance with valid policies', () => {
      const policyContent = `
version: "1.0"
rules:
  - id: "allow-llm"
    priority: 1000
    match:
      resource: "llm"
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), policyContent);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      expect(cheese).toBeDefined();
      expect(cheese.getValidationErrors()).toHaveLength(0);

      cheese.destroy();
    });

    it('should load policies on construction', () => {
      const policyContent = `
version: "1.0"
rules:
  - id: "test-rule"
    priority: 100
    match: {}
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), policyContent);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const stats = cheese.getStats();
      expect(stats.policiesLoaded).toBe(1);
      expect(stats.rulesActive).toBe(1);

      cheese.destroy();
    });
  });

  describe('evaluate', () => {
    it('should evaluate security requests', () => {
      const policyContent = `
version: "1.0"
rules:
  - id: "allow-browser"
    priority: 100
    match:
      resource: "tool"
      resourceId: "browser"
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), policyContent);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

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
      };

      const result = cheese.evaluate(request);
      expect(result.allowed).toBe(true);
      expect(result.ruleId).toBe('allow-browser');

      cheese.destroy();
    });

    it('should apply default deny when no rule matches', () => {
      writeFileSync(join(testPoliciesDir, 'test.yaml'), 'version: "1.0"\nrules: []');

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

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
      };

      const result = cheese.evaluate(request);
      expect(result.allowed).toBe(false);
      expect(result.effect).toBe('deny');

      cheese.destroy();
    });

    it('should evaluate in less than 1ms', () => {
      const policyContent = `
version: "1.0"
rules:
  - id: "test-rule"
    priority: 100
    match:
      resource: "tool"
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), policyContent);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const request: SecurityRequest = {
        requestId: 'test-perf',
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
      };

      const result = cheese.evaluate(request);
      expect(result.evaluationTimeMs).toBeLessThan(1);

      cheese.destroy();
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const policyContent = `
version: "1.0"
rules:
  - id: "rule-1"
    priority: 100
    match: {}
    effect: "allow"
  - id: "rule-2"
    priority: 200
    match: {}
    effect: "deny"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), policyContent);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const request: SecurityRequest = {
        requestId: 'test-stats',
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
      };

      cheese.evaluate(request);
      cheese.evaluate(request);

      const stats = cheese.getStats();
      expect(stats.policiesLoaded).toBe(1);
      expect(stats.rulesActive).toBe(2);
      expect(stats.evaluationsTotal).toBe(2);
      expect(stats.avgEvaluationTimeMs).toBeGreaterThan(0);
      expect(stats.lastReload).toBeDefined();

      cheese.destroy();
    });
  });

  describe('getValidationErrors', () => {
    it('should report validation errors', () => {
      const invalidPolicy = `
version: "1.0"
rules:
  - id: "invalid"
    priority: "not-a-number"
    match: {}
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'invalid.yaml'), invalidPolicy);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const errors = cheese.getValidationErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(cheese.hasValidationErrors()).toBe(true);

      cheese.destroy();
    });

    it('should return empty array when no errors', () => {
      const validPolicy = `
version: "1.0"
rules:
  - id: "valid"
    priority: 100
    match: {}
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'valid.yaml'), validPolicy);

      const cheese = new Cheese({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const errors = cheese.getValidationErrors();
      expect(errors).toHaveLength(0);
      expect(cheese.hasValidationErrors()).toBe(false);

      cheese.destroy();
    });
  });

  describe('createCheese helper', () => {
    it('should create Cheese with defaults', () => {
      writeFileSync(join(testPoliciesDir, 'test.yaml'), 'version: "1.0"\nrules: []');

      const cheese = createCheese(testPoliciesDir);

      expect(cheese).toBeDefined();
      expect(cheese.getStats().policiesLoaded).toBe(1);

      cheese.destroy();
    });

    it('should accept custom security mode', () => {
      writeFileSync(join(testPoliciesDir, 'test.yaml'), 'version: "1.0"\nrules: []');

      const cheese = createCheese(testPoliciesDir, 'strict');

      expect(cheese).toBeDefined();

      cheese.destroy();
    });
  });
});
