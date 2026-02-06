/**
 * Tool Chain Executor
 *
 * Executes tools in a chain with context passing between steps.
 * Supports variable substitution from previous results.
 */

import type {
  ToolCall,
  ToolResult,
  ChainResult,
  ChainContext,
} from '@nachos/types';
import type { ToolCoordinator } from './coordinator.js';

/**
 * Tool chain executor for sequential execution with context
 */
export class ToolChainExecutor {
  constructor(private coordinator: ToolCoordinator) {}

  /**
   * Execute a chain of tool calls sequentially
   * Each step can reference results from previous steps
   */
  async executeChain(
    chain: ToolCall[],
    initialContext: ChainContext = {}
  ): Promise<ChainResult> {
    const results: ToolResult[] = [];
    let currentContext = { ...initialContext };

    for (let i = 0; i < chain.length; i++) {
      const call = chain[i];
      if (!call) {
        return {
          success: false,
          results,
          failedAt: i,
        };
      }

      // Enrich call with context from previous steps
      const enrichedCall = this.enrichWithContext(call, currentContext);

      // Execute the tool
      const result = await this.coordinator.executeSingle(enrichedCall);
      results.push(result);

      // Check if execution failed
      if (!result.success) {
        return {
          success: false,
          results,
          failedAt: i,
        };
      }

      // Update context for next step
      currentContext = this.updateContext(currentContext, call, result, i);
    }

    return {
      success: true,
      results,
    };
  }

  /**
   * Enrich tool call parameters with context values
   * Supports variable substitution like ${previous.result.filename}
   */
  private enrichWithContext(call: ToolCall, context: ChainContext): ToolCall {
    // Deep clone the parameters
    const enrichedParams = JSON.parse(JSON.stringify(call.parameters));

    // Replace variables in all string values
    const enriched = this.replaceVariables(enrichedParams, context);

    return {
      ...call,
      parameters: enriched,
    };
  }

  /**
   * Recursively replace variables in an object
   */
  private replaceVariables(
    obj: Record<string, unknown>,
    context: ChainContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Replace ${path.to.value} with actual value from context
        result[key] = this.replaceStringVariables(value, context);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null
            ? this.replaceVariables(item as Record<string, unknown>, context)
            : typeof item === 'string'
              ? this.replaceStringVariables(item, context)
              : item
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.replaceVariables(
          value as Record<string, unknown>,
          context
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Replace variables in a string
   * Supports:
   * - ${previous.result} - Result from previous step
   * - ${step.0.result} - Result from specific step
   * - ${context.variableName} - Value from context
   */
  private replaceStringVariables(str: string, context: ChainContext): string {
    return str.replace(/\$\{([^}]+)\}/g, (match, path) => {
      const value = this.getValueByPath(context, path);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Get a value from an object by dot-notation path
   */
  private getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Update context with results from the current step
   */
  private updateContext(
    context: ChainContext,
    call: ToolCall,
    result: ToolResult,
    stepIndex: number
  ): ChainContext {
    // Extract result data from content blocks
    const resultData = this.extractResultData(result);

    return {
      ...context,
      previous: {
        tool: call.tool,
        result: resultData,
        success: result.success,
        metadata: result.metadata,
      },
      [`step.${stepIndex}`]: {
        tool: call.tool,
        result: resultData,
        success: result.success,
        metadata: result.metadata,
      },
    };
  }

  /**
   * Extract structured data from tool result
   */
  private extractResultData(result: ToolResult): unknown {
    // If there's only one text content block, try to parse it as JSON
    const firstBlock = result.content[0];
    if (result.content.length === 1 && firstBlock && firstBlock.type === 'text') {
      const text = firstBlock.text;
      try {
        return JSON.parse(text);
      } catch {
        // Not JSON, return as text
        return text;
      }
    }

    // Multiple content blocks or non-text, return structured
    return {
      content: result.content,
      metadata: result.metadata,
    };
  }

  /**
   * Validate that a chain can be executed
   * Checks for circular dependencies and invalid variable references
   */
  validateChain(chain: ToolCall[]): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const call = chain[i];
      if (!call) {
        errors.push(`Step ${i} is undefined`);
        continue;
      }

      // Check for invalid forward references
      const variables = this.extractVariables(call.parameters);
      for (const variable of variables) {
        // Check if variable references a future step
        const stepMatch = variable.match(/^step\.(\d+)\./);
        if (stepMatch) {
          const stepIndexValue = stepMatch[1];
          if (!stepIndexValue) {
            continue;
          }

          const refIndex = parseInt(stepIndexValue, 10);
          if (refIndex >= i) {
            errors.push(
              `Step ${i} references future step ${refIndex} in variable ${variable}`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Extract all variable references from parameters
   */
  private extractVariables(
    obj: Record<string, unknown>,
    variables: string[] = []
  ): string[] {
    for (const value of Object.values(obj)) {
      if (typeof value === 'string') {
        const matches = value.matchAll(/\$\{([^}]+)\}/g);
        for (const match of matches) {
          const variable = match[1];
          if (variable) {
            variables.push(variable);
          }
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            this.extractVariables(item as Record<string, unknown>, variables);
          } else if (typeof item === 'string') {
            const matches = item.matchAll(/\$\{([^}]+)\}/g);
            for (const match of matches) {
              const variable = match[1];
              if (variable) {
                variables.push(variable);
              }
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        this.extractVariables(value as Record<string, unknown>, variables);
      }
    }

    return variables;
  }

  /**
   * Create a chain preview showing what will be executed
   * Useful for debugging and validation
   */
  createChainPreview(
    chain: ToolCall[],
    _context: ChainContext = {}
  ): Array<{
    step: number;
    tool: string;
    parameters: Record<string, unknown>;
    variables: string[];
  }> {
    return chain
      .filter((call): call is ToolCall => call !== undefined)
      .map((call, i) => ({
        step: i,
        tool: call.tool,
        parameters: call.parameters,
        variables: this.extractVariables(call.parameters),
      }));
  }
}
