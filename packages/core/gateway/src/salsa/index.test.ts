import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Salsa, createSalsa } from './index.js';
import type { SecurityRequest } from './types/index.js';

describe('Salsa', () => {
  const testPoliciesDir = '/tmp/salsa-test-policies';

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
    it('should create Salsa instance with valid policies', () => {
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

      const salsa = new Salsa({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      expect(salsa).toBeDefined();
      expect(salsa.getValidationErrors()).toHaveLength(0);

      salsa.destroy();
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

      const salsa = new Salsa({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const stats = salsa.getStats();
      expect(stats.policiesLoaded).toBe(1);
      expect(stats.rulesActive).toBe(1);

      salsa.destroy();
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

      const salsa = new Salsa({
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

      const result = salsa.evaluate(request);
      expect(result.allowed).toBe(true);
      expect(result.ruleId).toBe('allow-browser');

      salsa.destroy();
    });

    it('should apply default deny when no rule matches', () => {
      writeFileSync(join(testPoliciesDir, 'test.yaml'), 'version: "1.0"\nrules: []');

      const salsa = new Salsa({
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

      const result = salsa.evaluate(request);
      expect(result.allowed).toBe(false);
      expect(result.effect).toBe('deny');

      salsa.destroy();
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

      const salsa = new Salsa({
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

      const result = salsa.evaluate(request);
      expect(result.evaluationTimeMs).toBeLessThan(1);

      salsa.destroy();
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

      const salsa = new Salsa({
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

      salsa.evaluate(request);
      salsa.evaluate(request);

      const stats = salsa.getStats();
      expect(stats.policiesLoaded).toBe(1);
      expect(stats.rulesActive).toBe(2);
      expect(stats.evaluationsTotal).toBe(2);
      expect(stats.avgEvaluationTimeMs).toBeGreaterThan(0);
      expect(stats.lastReload).toBeDefined();

      salsa.destroy();
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

      const salsa = new Salsa({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const errors = salsa.getValidationErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(salsa.hasValidationErrors()).toBe(true);

      salsa.destroy();
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

      const salsa = new Salsa({
        policiesPath: testPoliciesDir,
        securityMode: 'standard',
        enableHotReload: false,
        defaultEffect: 'deny',
      });

      const errors = salsa.getValidationErrors();
      expect(errors).toHaveLength(0);
      expect(salsa.hasValidationErrors()).toBe(false);

      salsa.destroy();
    });
  });

  describe('createSalsa helper', () => {
    it('should create Salsa with defaults', () => {
      writeFileSync(join(testPoliciesDir, 'test.yaml'), 'version: "1.0"\nrules: []');

      const salsa = createSalsa(testPoliciesDir);

      expect(salsa).toBeDefined();
      expect(salsa.getStats().policiesLoaded).toBe(1);

      salsa.destroy();
    });

    it('should accept custom security mode', () => {
      writeFileSync(join(testPoliciesDir, 'test.yaml'), 'version: "1.0"\nrules: []');

      const salsa = createSalsa(testPoliciesDir, 'strict');

      expect(salsa).toBeDefined();

      salsa.destroy();
    });
  });
});
