/**
 * Dependency Graph utilities for multi-step subagent workflows.
 *
 * Provides DAG validation, topological sort, and execution order computation.
 */

export interface WorkflowStep {
  id: string;
  task: string;
  dependsOn?: string[];
  model?: string;
  modelHint?: 'fast' | 'balanced' | 'thorough';
  stream?: boolean;
}

export interface WorkflowDefinition {
  steps: WorkflowStep[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  error?: {
    code: string;
    message: string;
    stepId?: string;
  };
}

export interface ExecutionPlan {
  batches: string[][]; // Array of batches, each batch contains step IDs that can run in parallel
  steps: Map<string, WorkflowStep>;
}

/**
 * Validate a workflow definition for DAG constraints.
 * Checks for:
 * - Duplicate step IDs
 * - Missing dependencies
 * - Cycles
 */
export function validateWorkflow(workflow: WorkflowDefinition): WorkflowValidationResult {
  const { steps } = workflow;

  if (steps.length === 0) {
    return {
      valid: false,
      error: {
        code: 'EMPTY_WORKFLOW',
        message: 'Workflow must contain at least one step',
      },
    };
  }

  // Check for duplicate step IDs
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.id)) {
      return {
        valid: false,
        error: {
          code: 'DUPLICATE_STEP_ID',
          message: `Duplicate step ID: ${step.id}`,
          stepId: step.id,
        },
      };
    }
    stepIds.add(step.id);
  }

  // Build dependency map
  const stepMap = new Map<string, WorkflowStep>();
  for (const step of steps) {
    stepMap.set(step.id, step);
  }

  // Check for missing dependencies
  for (const step of steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (!stepMap.has(depId)) {
          return {
            valid: false,
            error: {
              code: 'MISSING_DEPENDENCY',
              message: `Step "${step.id}" depends on non-existent step "${depId}"`,
              stepId: step.id,
            },
          };
        }
      }
    }
  }

  // Check for cycles using DFS
  const cycleCheck = detectCycle(stepMap);
  if (!cycleCheck.valid) {
    return cycleCheck;
  }

  return { valid: true };
}

/**
 * Detect cycles in the dependency graph using DFS.
 */
function detectCycle(stepMap: Map<string, WorkflowStep>): WorkflowValidationResult {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function dfs(stepId: string, path: string[]): WorkflowValidationResult {
    if (visiting.has(stepId)) {
      const cycle = [...path, stepId].slice(path.indexOf(stepId));
      return {
        valid: false,
        error: {
          code: 'CYCLE_DETECTED',
          message: `Cycle detected: ${cycle.join(' → ')}`,
          stepId,
        },
      };
    }

    if (visited.has(stepId)) {
      return { valid: true };
    }

    visiting.add(stepId);
    const step = stepMap.get(stepId);

    if (step?.dependsOn) {
      for (const depId of step.dependsOn) {
        const result = dfs(depId, [...path, stepId]);
        if (!result.valid) {
          return result;
        }
      }
    }

    visiting.delete(stepId);
    visited.add(stepId);
    return { valid: true };
  }

  for (const stepId of stepMap.keys()) {
    if (!visited.has(stepId)) {
      const result = dfs(stepId, []);
      if (!result.valid) {
        return result;
      }
    }
  }

  return { valid: true };
}

/**
 * Compute execution plan using topological sort (Kahn's algorithm).
 * Returns batches of step IDs that can be executed in parallel.
 */
export function computeExecutionPlan(workflow: WorkflowDefinition): ExecutionPlan {
  const steps = new Map<string, WorkflowStep>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Build graph
  for (const step of workflow.steps) {
    steps.set(step.id, step);
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  // Compute in-degrees and adjacency list
  for (const step of workflow.steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
        adjacency.get(depId)?.push(step.id);
      }
    }
  }

  // Kahn's algorithm: process nodes with in-degree 0
  const batches: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < workflow.steps.length) {
    const batch: string[] = [];

    // Find all nodes with in-degree 0
    for (const [stepId, degree] of inDegree.entries()) {
      if (degree === 0 && !processed.has(stepId)) {
        batch.push(stepId);
      }
    }

    if (batch.length === 0) {
      // Should not happen if validation passed
      throw new Error('Invalid workflow: unable to compute execution order');
    }

    batches.push(batch);

    // Mark as processed and decrease in-degree of dependents
    for (const stepId of batch) {
      processed.add(stepId);
      const dependents = adjacency.get(stepId) ?? [];
      for (const depId of dependents) {
        inDegree.set(depId, (inDegree.get(depId) ?? 1) - 1);
      }
    }
  }

  return { batches, steps };
}
