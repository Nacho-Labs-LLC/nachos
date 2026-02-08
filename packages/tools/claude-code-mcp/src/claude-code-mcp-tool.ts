/**
 * Claude Code MCP Tool
 */

import { ToolService } from '@nachos/tool-base';
import {
  SecurityTier,
  type ToolConfig,
  type ToolParameters,
  type ToolResult,
  type ToolValidationResult,
  type ToolHealthStatus,
  type ParameterSchema,
} from '@nachos/types';
import { ClaudeCodeMcpClient, type ClaudeCodeToolResult } from './mcp-client.js';
import { validatePrompt, validateTools } from './validators.js';
import type { ClaudeCodeOptions, ClaudeCodeParameters } from './types.js';

const DEFAULT_COMMAND = 'npx';
const DEFAULT_ARGS = ['-y', '@steipete/claude-code-mcp@latest'];

export class ClaudeCodeMcpTool extends ToolService {
  readonly toolId = 'claude_code_mcp';
  readonly name = 'Claude Code MCP';
  readonly description = 'Bridge to the Claude Code MCP server for agentic CLI tasks';
  readonly securityTier = SecurityTier.RESTRICTED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The prompt to send to Claude Code',
        minLength: 1,
        maxLength: 4000,
      },
      tools: {
        type: 'array',
        description: 'Specific Claude Code tools to enable',
        items: { type: 'string' },
      },
      options: {
        type: 'object',
        description: 'Additional options forwarded to Claude Code MCP',
        properties: {
          tools: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
    required: ['prompt'],
  };

  private client!: ClaudeCodeMcpClient;
  private clientAvailable = false;
  private maxPromptLength = 4000;

  async initialize(config: ToolConfig): Promise<void> {
    this.maxPromptLength = this.readConfigNumber(
      config.config.max_prompt_length,
      config.config.maxPromptLength,
      4000
    );

    const command = process.env.MCP_CLAUDE_CODE_COMMAND ?? DEFAULT_COMMAND;
    const args = this.parseArgs(process.env.MCP_CLAUDE_CODE_ARGS, DEFAULT_ARGS);

    this.client = new ClaudeCodeMcpClient({
      command,
      args,
      env: this.buildMcpEnv(),
      logger: this.logger,
    });

    this.clientAvailable = await this.tryConnect();
  }

  validate(params: ToolParameters): ToolValidationResult {
    const p = params as ClaudeCodeParameters;
    const errors: string[] = [];

    const promptValidation = validatePrompt(p.prompt, this.maxPromptLength);
    if (!promptValidation.valid && promptValidation.errors) {
      errors.push(...promptValidation.errors);
    }

    const toolsValidation = validateTools(p.tools);
    if (!toolsValidation.valid && toolsValidation.errors) {
      errors.push(...toolsValidation.errors);
    }

    if (p.options?.tools) {
      const optionsToolsValidation = validateTools(p.options.tools);
      if (!optionsToolsValidation.valid && optionsToolsValidation.errors) {
        errors.push(...optionsToolsValidation.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const p = params as ClaudeCodeParameters;

    if (!this.clientAvailable) {
      this.clientAvailable = await this.tryConnect();
    }

    if (!this.clientAvailable) {
      return this.formatErrorResponse(
        'MCP_NOT_AVAILABLE',
        'Claude Code MCP server is not available. Ensure it is installed and reachable.'
      );
    }

    const options: ClaudeCodeOptions | undefined = this.mergeOptions(p.tools, p.options);

    const toolArgs: Record<string, unknown> = {
      prompt: p.prompt,
    };

    if (options) {
      toolArgs.options = options;
    }

    try {
      const result = await this.client.callClaudeCode(toolArgs);
      const text = this.extractText(result);

      const isError = 'isError' in result && result.isError === true;
      if (isError) {
        return this.formatErrorResponse('MCP_TOOL_ERROR', text || 'MCP tool error', result);
      }

      const warnings: string[] = [];
      if (!text) {
        warnings.push('MCP tool returned no text content');
      }

      return this.formatTextResponse(text, {
        duration: 0,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (error) {
      return this.formatErrorResponse(
        'EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        error
      );
    }
  }

  override async healthCheck(): Promise<ToolHealthStatus> {
    try {
      if (!this.clientAvailable) {
        this.clientAvailable = await this.tryConnect();
      }

      if (!this.clientAvailable) {
        return { healthy: false, error: 'Claude Code MCP server not available' };
      }

      const tools = await this.client.listTools();
      if (!tools.includes('claude_code')) {
        return { healthy: false, error: 'claude_code tool not exposed by MCP server' };
      }

      return {
        healthy: true,
        details: {
          toolCount: tools.length,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  override async stop(): Promise<void> {
    await this.client.close();
    await super.stop();
  }

  private async tryConnect(): Promise<boolean> {
    try {
      await this.client.connect();
      const tools = await this.client.listTools();
      if (!tools.includes('claude_code')) {
        this.logger.warn('MCP server connected but claude_code tool not found');
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error('Failed to connect to MCP server:', error);
      return false;
    }
  }

  private extractText(result: ClaudeCodeToolResult): string {
    const parts: string[] = [];

    if ('content' in result && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          parts.push(item.text);
        }
      }

      return parts.join('\n');
    }

    if ('toolResult' in result) {
      if (typeof result.toolResult === 'string') {
        return result.toolResult;
      }

      if (result.toolResult === null || result.toolResult === undefined) {
        return '';
      }

      try {
        return JSON.stringify(result.toolResult);
      } catch {
        return String(result.toolResult);
      }
    }

    return '';
  }

  private parseArgs(rawArgs: string | undefined, fallback: string[]): string[] {
    if (!rawArgs) {
      return [...fallback];
    }

    try {
      const parsed = JSON.parse(rawArgs);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      // Fall back to whitespace split
    }

    return rawArgs.split(/\s+/).filter(Boolean);
  }

  private buildMcpEnv(): Record<string, string> {
    const env: Record<string, string> = {
      MAX_PROMPT_LENGTH: String(this.maxPromptLength),
    };

    if (process.env.CLAUDE_CLI_NAME) {
      env.CLAUDE_CLI_NAME = process.env.CLAUDE_CLI_NAME;
    }

    if (process.env.MCP_CLAUDE_DEBUG) {
      env.MCP_CLAUDE_DEBUG = process.env.MCP_CLAUDE_DEBUG;
    }

    return env;
  }

  private mergeOptions(
    tools: string[] | undefined,
    options: ClaudeCodeOptions | undefined
  ): ClaudeCodeOptions | undefined {
    if (!tools && !options) {
      return undefined;
    }

    const merged: ClaudeCodeOptions = { ...(options ?? {}) };
    if (tools && tools.length > 0) {
      merged.tools = [...tools];
    }

    return merged;
  }

  private readConfigNumber(primary: unknown, secondary: unknown, fallback: number): number {
    if (typeof primary === 'number' && Number.isFinite(primary)) {
      return primary;
    }

    if (typeof secondary === 'number' && Number.isFinite(secondary)) {
      return secondary;
    }

    return fallback;
  }
}
