/**
 * Local Tool Handler
 *
 * Handles tool execution for gateway-integrated tools (tools that run
 * in the same process as the gateway, not as separate containers).
 *
 * Currently supports:
 * - shell/exec: CLI command execution with skill-based allowlisting
 * - browser_*: Browser automation via @playwright/mcp
 */

import type { ToolCall, ToolResult, ContentBlock } from '@nachos/types';
import { ShellTool, type ShellToolConfig } from './shell-tool.js';
import { BrowserLocalTool, type BrowserToolConfig } from './browser-local.js';

/**
 * Logger interface (pino-compatible)
 */
interface Logger {
  info(msg: string): void;
  info(obj: object, msg?: string): void;
  warn(msg: string): void;
  warn(obj: object, msg?: string): void;
  error(msg: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * Local tool handler configuration
 */
export interface LocalToolHandlerConfig {
  logger: Logger;
  shellConfig?: Partial<ShellToolConfig>;
  browserConfig?: Partial<BrowserToolConfig>;
}

/**
 * Handles execution of local (gateway-integrated) tools
 */
export class LocalToolHandler {
  private logger: Logger;
  private shellTool: ShellTool;
  private browserTool: BrowserLocalTool;

  constructor(config: LocalToolHandlerConfig) {
    this.logger = config.logger;

    // Initialize shell tool
    this.shellTool = new ShellTool({
      logger: config.logger,
      ...config.shellConfig,
    });

    // Initialize browser tool (lazy — Chromium only starts on first use)
    this.browserTool = new BrowserLocalTool({
      logger: config.logger,
      ...config.browserConfig,
    });
  }

  /**
   * Check if a tool should be handled locally
   */
  isLocalTool(toolName: string): boolean {
    return toolName === 'exec' || toolName === 'shell' || this.browserTool.isBrowserTool(toolName);
  }

  /**
   * Execute a local tool
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Route to appropriate handler
      if (call.tool === 'exec' || call.tool === 'shell') {
        return await this.executeShell(call);
      }

      if (this.browserTool.isBrowserTool(call.tool)) {
        return await this.browserTool.execute(call);
      }

      // Unknown local tool
      return {
        success: false,
        content: [],
        error: {
          code: 'UNKNOWN_LOCAL_TOOL',
          message: `Unknown local tool: ${call.tool}`,
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : error },
        'Local tool execution error'
      );
      return {
        success: false,
        content: [],
        error: {
          code: 'LOCAL_TOOL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Get tool group for a command (for policy checking)
   */
  getToolGroup(call: ToolCall): string | undefined {
    if (call.tool === 'exec' || call.tool === 'shell') {
      const command = call.parameters?.command as string;
      if (command) {
        return this.shellTool.getToolGroup(command);
      }
    }
    if (this.browserTool.isBrowserTool(call.tool)) {
      return 'browser';
    }
    return undefined;
  }

  /**
   * Shut down all local tools (call on gateway shutdown)
   */
  async close(): Promise<void> {
    await this.browserTool.close();
  }

  /**
   * Execute shell/exec tool
   */
  private async executeShell(call: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate parameters
    const command = call.parameters?.command as string;
    if (!command) {
      return {
        success: false,
        content: [],
        error: {
          code: 'MISSING_COMMAND',
          message: 'Parameter "command" is required',
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }

    // Check if command is allowed
    if (!this.shellTool.isCommandAllowed(command)) {
      const allowed = this.shellTool.getAllowedBinaries();
      return {
        success: false,
        content: [],
        error: {
          code: 'COMMAND_NOT_ALLOWED',
          message: `Command not allowed. Allowed binaries: ${allowed.join(', ')}`,
          details: { allowedBinaries: allowed },
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }

    try {
      // Execute command
      const result = await this.shellTool.execute({
        command,
        cwd: call.parameters?.cwd as string | undefined,
        env: call.parameters?.env as Record<string, string> | undefined,
        timeout: call.parameters?.timeout as number | undefined,
      });

      // Build tool result content
      const content: ContentBlock[] = [];

      // Add stdout if present
      if (result.stdout) {
        content.push({
          type: 'text',
          text: result.stdout,
        });
      }

      // Add stderr as separate content block if present
      if (result.stderr) {
        content.push({
          type: 'text',
          text: `[stderr]\n${result.stderr}`,
        });
      }

      // Build warnings
      const warnings: string[] = [];
      if (result.timedOut) {
        warnings.push('Command execution timed out');
      }
      if (result.truncated) {
        warnings.push('Output was truncated due to size limit');
      }

      // Determine success
      const success = result.exitCode === 0 && !result.timedOut;

      return {
        success,
        content,
        error: success
          ? undefined
          : {
              code: result.timedOut ? 'TIMEOUT' : 'NONZERO_EXIT',
              message: result.timedOut
                ? 'Command execution timed out'
                : `Command exited with code ${result.exitCode}`,
              details: {
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: result.timedOut,
                truncated: result.truncated,
                stdoutLength: result.stdout.length,
                stderrLength: result.stderr.length,
              },
            },
        metadata: {
          duration: result.duration,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        content: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }
}
