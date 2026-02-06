import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PolicyLoader } from './loader.js';

describe('PolicyLoader', () => {
  const testPoliciesDir = '/tmp/test-policies';

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

  describe('load', () => {
    it('should load valid policy files', () => {
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

      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors).toHaveLength(0);
      expect(policies).toHaveLength(1);
      expect(policies[0].rules).toHaveLength(1);
      expect(policies[0].rules[0].id).toBe('test-rule');

      loader.destroy();
    });

    it('should load multiple policy files', () => {
      const policy1 = `
version: "1.0"
rules:
  - id: "rule-1"
    priority: 100
    match: {}
    effect: "allow"
`;
      const policy2 = `
version: "1.0"
rules:
  - id: "rule-2"
    priority: 200
    match: {}
    effect: "deny"
`;
      writeFileSync(join(testPoliciesDir, 'policy1.yaml'), policy1);
      writeFileSync(join(testPoliciesDir, 'policy2.yml'), policy2);

      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors).toHaveLength(0);
      expect(policies).toHaveLength(2);

      loader.destroy();
    });

    it('should report validation errors', () => {
      const invalidPolicy = `
version: "1.0"
rules:
  - id: "invalid-rule"
    priority: "not-a-number"
    match: {}
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'invalid.yaml'), invalidPolicy);

      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors.length).toBeGreaterThan(0);
      expect(policies).toHaveLength(0);

      loader.destroy();
    });

    it('should handle non-existent directory', () => {
      const loader = new PolicyLoader({
        policiesPath: '/tmp/non-existent-dir',
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('does not exist');
      expect(policies).toHaveLength(0);

      loader.destroy();
    });

    it('should handle empty directory', () => {
      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors).toHaveLength(0);
      expect(policies).toHaveLength(0);

      loader.destroy();
    });

    it('should ignore non-YAML files', () => {
      writeFileSync(join(testPoliciesDir, 'readme.txt'), 'Not a policy file');
      writeFileSync(join(testPoliciesDir, 'policy.yaml'), 'version: "1.0"\nrules: []');

      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors).toHaveLength(0);
      expect(policies).toHaveLength(1);

      loader.destroy();
    });

    it('should handle YAML parse errors', () => {
      writeFileSync(join(testPoliciesDir, 'bad.yaml'), 'this is not valid yaml: [[[');

      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      const [policies, errors] = loader.load();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('Failed to load');

      loader.destroy();
    });
  });

  describe('getPolicies', () => {
    it('should return currently loaded policies', () => {
      const policyContent = `
version: "1.0"
rules:
  - id: "test-rule"
    priority: 100
    match: {}
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), policyContent);

      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: false,
      });

      loader.load();
      const policies = loader.getPolicies();

      expect(policies).toHaveLength(1);
      expect(policies[0].rules[0].id).toBe('test-rule');

      loader.destroy();
    });
  });

  describe('Hot Reload', () => {
    it('should detect file changes when watching', (done) => {
      const initialPolicy = `
version: "1.0"
rules:
  - id: "initial-rule"
    priority: 100
    match: {}
    effect: "allow"
`;
      writeFileSync(join(testPoliciesDir, 'test.yaml'), initialPolicy);

      let reloadCount = 0;
      const loader = new PolicyLoader({
        policiesPath: testPoliciesDir,
        enableHotReload: true,
        onReload: (policies, errors) => {
          reloadCount++;
          if (reloadCount === 2) {
            // First reload is from initial load, second is from file change
            expect(policies).toHaveLength(1);
            expect(policies[0].rules[0].id).toBe('updated-rule');
            loader.stopWatching();
            loader.destroy();
            done();
          }
        },
      });

      loader.load();
      loader.startWatching();

      // Wait a bit then update the file
      setTimeout(() => {
        const updatedPolicy = `
version: "1.0"
rules:
  - id: "updated-rule"
    priority: 100
    match: {}
    effect: "deny"
`;
        writeFileSync(join(testPoliciesDir, 'test.yaml'), updatedPolicy);
      }, 200);
    }, 2000);
  });
});
