/**
 * Tool Coordinator
 *
 * Orchestrates tool execution with:
 * - Policy checks via Salsa
 * - Parallel vs sequential execution
 * - Cache integration
 * - NATS communication
 */

import {
  SecurityTier,
  type ToolCall,
  type ToolResult,
  type ExecutionOptions,
  type MessageEnvelope,
} from '@nachos/types';
import type { Salsa, SecurityRequest } from '../salsa/index.js';
import type { ToolCache } from './cache.js';
import type { MessageBus } from '../router.js';
import type { ApprovalManager } from './approval-manager.js';

/**
 * Tool coordinator configuration
 */
export interface ToolCoordinatorConfig {
  bus: MessageBus;
  salsa?: Salsa | null;
  cache?: ToolCache;
  approvalManager?: ApprovalManager | null;
  defaultTimeout?: number;
  securityMode?: 'strict' | 'standard' | 'permissive';
}

/**
 * Tool coordinator for orchestrating tool execution
 */
export class ToolCoordinator {
  private bus: MessageBus;
  private salsa?: Salsa | null;
  private cache?: ToolCache;
  private approvalManager?: ApprovalManager | null;
  private defaultTimeout: number;
  private securityMode?: 'strict' | 'standard' | 'permissive';

  constructor(config: ToolCoordinatorConfig) {
    this.bus = config.bus;
    this.salsa = config.salsa;
    this.cache = config.cache;
    this.approvalManager = config.approvalManager;
    this.defaultTimeout = config.defaultTimeout ?? 30000; // 30 seconds
    this.securityMode = config.securityMode;
  }

  /**
   * Execute multiple tool calls
   * Automatically determines whether to run in parallel or sequential
   */
  async executeTools(toolCalls: ToolCall[], options?: ExecutionOptions): Promise<ToolResult[]> {
    if (toolCalls.length === 0) {
      return [];
    }

    // Check if parallel execution is safe
    const canParallel = options?.forceParallel || this.canExecuteInParallel(toolCalls);

    if (canParallel) {
      return await this.executeParallel(toolCalls, options);
    } else {
      return await this.executeSequential(toolCalls, options);
    }
  }

  /**
   * Execute a single tool call
   */
  async executeSingle(call: ToolCall, options?: ExecutionOptions): Promise<ToolResult> {
    const startTime = Date.now();

    if (!call.sessionId) {
      return {
        success: false,
        content: [],
        error: {
          code: 'MISSING_SESSION',
          message: 'Tool call is missing sessionId',
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }

    const resolvedSecurityTier = this.resolveSecurityTier(call);
    if (resolvedSecurityTier !== undefined) {
      call.securityTier = resolvedSecurityTier;
    }

    if (!call.securityMode) {
      call.securityMode = this.securityMode ?? 'standard';
    }

    try {
      // 1. Check policy (if Salsa is configured)
      if (this.salsa) {
        const policyResult = await this.checkPolicy(call);
        if (!policyResult.allowed) {
          return {
            success: false,
            content: [],
            error: {
              code: 'POLICY_DENIED',
              message: policyResult.reason ?? 'Tool execution denied by policy',
              details: { ruleId: policyResult.ruleId },
            },
            metadata: {
              duration: Date.now() - startTime,
            },
          };
        }
      }

      // 2. Request approval for restricted tools (if configured)
      if (this.approvalManager && resolvedSecurityTier !== undefined) {
        if (this.approvalManager.requiresApproval(resolvedSecurityTier)) {
          const approval = await this.approvalManager.requestApproval(
            call.sessionId,
            call,
            resolvedSecurityTier,
            call.userId
          );

          if (!approval.approved) {
            return {
              success: false,
              content: [],
              error: {
                code: 'APPROVAL_DENIED',
                message: approval.reason ?? 'Tool execution denied by user approval',
                details: { userId: approval.userId },
              },
              metadata: {
                duration: Date.now() - startTime,
              },
            };
          }
        }
      }

      // 3. Check cache (if enabled and not bypassed)
      if (this.cache && !options?.bypassCache) {
        const cached = await this.cache.get(call);
        if (cached) {
          return {
            ...cached,
            metadata: {
              ...cached.metadata,
              cached: true,
              duration: Date.now() - startTime,
            },
          };
        }
      }

      // 4. Execute via message bus
      const result = await this.executeViaNats(call, options);

      // 5. Cache result (if successful and cache is enabled)
      if (this.cache && result.success) {
        const ttl = call.cacheTTL ?? 300; // Default 5 minutes
        await this.cache.set(call, result, ttl);
      }

      // 6. Add duration to metadata
      if (!result.metadata) {
        result.metadata = { duration: 0 };
      }
      result.metadata.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      return {
        success: false,
        content: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error,
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute tools in parallel
   */
  private async executeParallel(
    toolCalls: ToolCall[],
    options?: ExecutionOptions
  ): Promise<ToolResult[]> {
    const promises = toolCalls.map((call) =>
      this.executeSingle(call, options).catch(
        (error) =>
          ({
            success: false,
            content: [],
            error: {
              code: 'EXECUTION_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          }) as ToolResult
      )
    );

    return await Promise.all(promises);
  }

  /**
   * Execute tools sequentially
   */
  private async executeSequential(
    toolCalls: ToolCall[],
    options?: ExecutionOptions
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.executeSingle(call, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a tool via NATS request/reply
   */
  private async executeViaNats(call: ToolCall, options?: ExecutionOptions): Promise<ToolResult> {
    const topic = `nachos.tool.${call.tool}.request`;
    const timeout = options?.timeout ?? call.timeout ?? this.defaultTimeout;

    // Create request envelope
    const envelope: MessageEnvelope = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      source: 'gateway',
      type: 'tool.request',
      payload: {
        sessionId: call.sessionId,
        callId: call.id,
        sandbox: call.sandbox,
        ...call.parameters,
      },
    };

    try {
      // Send request and wait for response
      const response = await this.bus.request(topic, envelope, timeout);

      if (response && typeof response === 'object' && 'payload' in response) {
        const responseEnvelope = response as MessageEnvelope;
        return responseEnvelope.payload as ToolResult;
      }

      if (response && typeof response === 'object' && 'success' in response) {
        return response as ToolResult;
      }

      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_TOOL_RESPONSE',
          message: 'Tool response was not a valid envelope or result',
          details: response,
        },
      };
    } catch (error) {
      // Check if timeout
      if (error instanceof Error && error.message.includes('timeout')) {
        return {
          success: false,
          content: [],
          error: {
            code: 'TIMEOUT',
            message: `Tool execution timed out after ${timeout}ms`,
          },
        };
      }

      // Check if no responders (tool not available)
      if (error instanceof Error && error.message.includes('no responders')) {
        return {
          success: false,
          content: [],
          error: {
            code: 'TOOL_NOT_AVAILABLE',
            message: `Tool '${call.tool}' is not available`,
          },
        };
      }

      // Other errors
      throw error;
    }
  }

  /**
   * Check if tools can be executed in parallel
   * Returns false if there are data dependencies between tools
   */
  private canExecuteInParallel(toolCalls: ToolCall[]): boolean {
    // For now, use a simple heuristic:
    // If any tool appears twice, assume sequential execution is needed
    const toolNames = toolCalls.map((call) => call.tool);
    const uniqueTools = new Set(toolNames);

    if (toolNames.length !== uniqueTools.size) {
      // Duplicate tools detected, run sequentially
      return false;
    }

    // Check for obvious write-then-read patterns
    // (e.g., filesystem_write followed by filesystem_read)
    for (let i = 0; i < toolCalls.length - 1; i++) {
      const current = toolCalls[i];
      const next = toolCalls[i + 1];

      if (!current || !next) {
        continue;
      }

      // If current is a write tool and next is a read tool for the same resource
      if (this.isWriteTool(current.tool) && this.isReadTool(next.tool)) {
        // Check if they operate on the same resource (e.g., same file path)
        if (this.operateOnSameResource(current, next)) {
          return false;
        }
      }
    }

    // No obvious dependencies, can run in parallel
    return true;
  }

  /**
   * Check if a tool is a write tool
   */
  private isWriteTool(toolName: string): boolean {
    return toolName.includes('write') || toolName.includes('edit') || toolName.includes('patch');
  }

  /**
   * Check if a tool is a read tool
   */
  private isReadTool(toolName: string): boolean {
    return toolName.includes('read') || toolName.includes('get') || toolName.includes('list');
  }

  /**
   * Check if two tools operate on the same resource
   */
  private operateOnSameResource(call1: ToolCall, call2: ToolCall): boolean {
    // Check if both have a 'path' parameter and they're the same
    const path1 = call1.parameters.path;
    const path2 = call2.parameters.path;

    if (path1 && path2 && path1 === path2) {
      return true;
    }

    // Check if both have a 'url' parameter and they're the same
    const url1 = call1.parameters.url;
    const url2 = call2.parameters.url;

    if (url1 && url2 && url1 === url2) {
      return true;
    }

    return false;
  }

  /**
   * Check policy for a tool call
   */
  private async checkPolicy(call: ToolCall): Promise<{
    allowed: boolean;
    reason?: string;
    ruleId?: string;
  }> {
    if (!this.salsa) {
      return { allowed: true };
    }

    const request: SecurityRequest = {
      requestId: this.generateId(),
      userId: call.userId ?? call.sessionId,
      sessionId: call.sessionId,
      securityMode: call.securityMode ?? this.securityMode ?? 'standard',
      resource: {
        type: 'tool',
        id: call.tool,
      },
      action: 'execute',
      metadata: {
        ...call.parameters,
        securityTier: call.securityTier,
      },
      timestamp: new Date(),
    };

    const result = this.salsa.evaluate(request);

    return {
      allowed: result.allowed,
      reason: result.reason,
      ruleId: result.ruleId,
    };
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `coord-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private resolveSecurityTier(call: ToolCall): SecurityTier | undefined {
    if (call.securityTier !== undefined) {
      return call.securityTier;
    }

    const tool = call.tool.toLowerCase();

    if (tool.includes('code_runner') || tool.includes('code-runner')) {
      return SecurityTier.RESTRICTED;
    }

    if (
      tool.includes('filesystem_write') ||
      tool.includes('filesystem_edit') ||
      tool.includes('filesystem_patch')
    ) {
      return SecurityTier.ELEVATED;
    }

    if (tool.includes('browser')) {
      return SecurityTier.STANDARD;
    }

    if (tool.includes('read') || tool.includes('list') || tool.includes('get')) {
      return SecurityTier.SAFE;
    }

    return undefined;
  }
}
