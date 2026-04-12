/**
 * Dependency Graph Tests
 *
 * Tests for DAG validation, cycle detection, and topological sort
 */

import { describe, it, expect } from 'vitest';
import {
  validateWorkflow,
  computeExecutionPlan,
  type WorkflowDefinition,
} from './dependency-graph.js';

describe('Dependency Graph', () => {
  describe('validateWorkflow', () => {
    it('should validate a simple workflow', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2', dependsOn: ['step1'] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });

    it('should reject empty workflow', () => {
      const workflow: WorkflowDefinition = {
        steps: [],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('EMPTY_WORKFLOW');
    });

    it('should detect duplicate step IDs', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step1', task: 'Task 2' },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('DUPLICATE_STEP_ID');
      expect(result.error?.stepId).toBe('step1');
    });

    it('should detect missing dependencies', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2', dependsOn: ['nonexistent'] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('MISSING_DEPENDENCY');
      expect(result.error?.stepId).toBe('step2');
    });

    it('should detect simple cycles', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1', dependsOn: ['step2'] },
          { id: 'step2', task: 'Task 2', dependsOn: ['step1'] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('CYCLE_DETECTED');
    });

    it('should detect complex cycles', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1', dependsOn: ['step3'] },
          { id: 'step2', task: 'Task 2', dependsOn: ['step1'] },
          { id: 'step3', task: 'Task 3', dependsOn: ['step2'] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('CYCLE_DETECTED');
    });

    it('should allow multiple dependencies', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2' },
          { id: 'step3', task: 'Task 3', dependsOn: ['step1', 'step2'] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });

    it('should allow diamond dependencies', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2', dependsOn: ['step1'] },
          { id: 'step3', task: 'Task 3', dependsOn: ['step1'] },
          { id: 'step4', task: 'Task 4', dependsOn: ['step2', 'step3'] },
        ],
      };

      const result = validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });
  });

  describe('computeExecutionPlan', () => {
    it('should compute linear execution order', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2', dependsOn: ['step1'] },
          { id: 'step3', task: 'Task 3', dependsOn: ['step2'] },
        ],
      };

      const plan = computeExecutionPlan(workflow);
      expect(plan.batches).toEqual([['step1'], ['step2'], ['step3']]);
      expect(plan.steps.size).toBe(3);
    });

    it('should identify parallel execution opportunities', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2' },
          { id: 'step3', task: 'Task 3' },
        ],
      };

      const plan = computeExecutionPlan(workflow);
      // All steps can run in parallel
      expect(plan.batches).toHaveLength(1);
      expect(plan.batches[0]).toHaveLength(3);
      expect(plan.batches[0]).toContain('step1');
      expect(plan.batches[0]).toContain('step2');
      expect(plan.batches[0]).toContain('step3');
    });

    it('should handle diamond dependencies correctly', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1' },
          { id: 'step2', task: 'Task 2', dependsOn: ['step1'] },
          { id: 'step3', task: 'Task 3', dependsOn: ['step1'] },
          { id: 'step4', task: 'Task 4', dependsOn: ['step2', 'step3'] },
        ],
      };

      const plan = computeExecutionPlan(workflow);
      expect(plan.batches).toHaveLength(3);
      expect(plan.batches[0]).toEqual(['step1']);
      // step2 and step3 can run in parallel
      expect(plan.batches[1]).toHaveLength(2);
      expect(plan.batches[1]).toContain('step2');
      expect(plan.batches[1]).toContain('step3');
      expect(plan.batches[2]).toEqual(['step4']);
    });

    it('should handle complex dependencies', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'A', task: 'Task A' },
          { id: 'B', task: 'Task B', dependsOn: ['A'] },
          { id: 'C', task: 'Task C', dependsOn: ['A'] },
          { id: 'D', task: 'Task D', dependsOn: ['B'] },
          { id: 'E', task: 'Task E', dependsOn: ['B', 'C'] },
          { id: 'F', task: 'Task F', dependsOn: ['D', 'E'] },
        ],
      };

      const plan = computeExecutionPlan(workflow);

      // Batch 0: A
      expect(plan.batches[0]).toEqual(['A']);

      // Batch 1: B and C (both depend only on A)
      expect(plan.batches[1]).toHaveLength(2);
      expect(plan.batches[1]).toContain('B');
      expect(plan.batches[1]).toContain('C');

      // Batch 2: D and E (D depends on B, E depends on B and C)
      expect(plan.batches[2]).toHaveLength(2);
      expect(plan.batches[2]).toContain('D');
      expect(plan.batches[2]).toContain('E');

      // Batch 3: F (depends on D and E)
      expect(plan.batches[3]).toEqual(['F']);
    });

    it('should preserve step metadata', () => {
      const workflow: WorkflowDefinition = {
        steps: [
          { id: 'step1', task: 'Task 1', model: 'gpt-4', stream: true },
          { id: 'step2', task: 'Task 2', modelHint: 'fast', dependsOn: ['step1'] },
        ],
      };

      const plan = computeExecutionPlan(workflow);
      const step1 = plan.steps.get('step1');
      const step2 = plan.steps.get('step2');

      expect(step1?.model).toBe('gpt-4');
      expect(step1?.stream).toBe(true);
      expect(step2?.modelHint).toBe('fast');
      expect(step2?.dependsOn).toEqual(['step1']);
    });
  });
});
