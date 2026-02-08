/**
 * GitHub Copilot CLI Tool
 *
 * Provides safe access to GitHub Copilot CLI with strict guardrails:
 * - SecurityTier: RESTRICTED (3) - Requires user approval
 * - Prompt validation and explicit guardrails
 * - Output size limits and timeout enforcement
 * - Structured error handling
 * - Audit logging
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
import { CLIExecutor } from './cli-executor.js';
import { validatePrompt, validateMode, validateTimeout } from './validators.js';
import { mapCLIError } from './error-mapper.js';
import type { CopilotParameters } from './types.js';

export class CopilotTool extends ToolService {
  readonly toolId = 'copilot';
  readonly name = 'GitHub Copilot CLI';
  readonly description =
    'Interact with GitHub Copilot CLI for code explanations, suggestions, and reviews';
  readonly securityTier = SecurityTier.RESTRICTED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The question or prompt to send to GitHub Copilot',
        minLength: 1,
        maxLength: 4000,
      },
      mode: {
        type: 'string',
        description: 'Copilot CLI mode of operation',
        enum: ['explain', 'suggest', 'review', 'general'],
        default: 'general',
      },
      allowSensitive: {
        type: 'boolean',
        description:
          'Allow prompts that may contain sensitive data (reserved for future DLP gating)',
        default: false,
      },
      allowWrite: {
        type: 'boolean',
        description: 'Allow suggestions that may involve file writes (future use)',
        default: false,
      },
      allowExec: {
        type: 'boolean',
        description: 'Allow suggestions that may involve code execution (future use)',
        default: false,
      },
      allowNetwork: {
        type: 'boolean',
        description: 'Allow suggestions that may involve network operations (future use)',
        default: false,
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds (default: 30, max: 60)',
        default: 30,
        minimum: 5,
        maximum: 60,
      },
    },
    required: ['prompt'],
  };

  private cliExecutor!: CLIExecutor;
  private cliAvailable: boolean = false;
  private maxPromptLength: number = 4000;
  private maxOutputSize: number = 50000;
  private defaultTimeout: number = 30;
  private maxTimeout: number = 60;

  async initialize(config: ToolConfig): Promise<void> {
    // Get configuration
    this.maxPromptLength = this.readConfigNumber(
      config.config.max_prompt_length,
      config.config.maxPromptLength,
      4000
    );
    this.maxOutputSize = this.readConfigNumber(
      config.config.max_output_size,
      config.config.maxOutputSize,
      50000
    );
    this.defaultTimeout = this.readConfigNumber(
      config.config.default_timeout,
      config.config.defaultTimeout,
      30
    );
    this.maxTimeout = this.readConfigNumber(
      config.config.max_timeout,
      config.config.maxTimeout,
      60
    );

    // Initialize CLI executor
    this.cliExecutor = new CLIExecutor({
      maxOutputSize: this.maxOutputSize,
      logger: this.logger,
    });

    // Check CLI availability
    try {
      const available = await this.cliExecutor.checkAvailability();
      this.cliAvailable = available;

      if (available) {
        const version = await this.cliExecutor.getVersion();
        this.logger.info(`GitHub Copilot CLI available (version: ${version})`);
      } else {
        this.logger.warn('GitHub Copilot CLI not available - tool will return fallback responses');
      }
    } catch (error) {
      this.logger.error('Failed to check CLI availability:', error);
      this.cliAvailable = false;
    }
  }

  validate(params: ToolParameters): ToolValidationResult {
    const p = params as CopilotParameters;
    const errors: string[] = [];

    // Validate prompt
    const promptValidation = validatePrompt(p.prompt, this.maxPromptLength);
    if (!promptValidation.valid && promptValidation.errors) {
      errors.push(...promptValidation.errors);
    }

    // Validate mode
    if (p.mode) {
      const modeValidation = validateMode(p.mode);
      if (!modeValidation.valid && modeValidation.errors) {
        errors.push(...modeValidation.errors);
      }
    }

    // Validate timeout
    if (p.timeout !== undefined) {
      const timeoutValidation = validateTimeout(p.timeout, this.maxTimeout);
      if (!timeoutValidation.valid && timeoutValidation.errors) {
        errors.push(...timeoutValidation.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const p = params as CopilotParameters;

    // Check CLI availability
    if (!this.cliAvailable) {
      return this.formatErrorResponse(
        'CLI_NOT_AVAILABLE',
        'GitHub Copilot CLI is not installed or not available. ' +
          'Install it with: gh extension install github/gh-copilot'
      );
    }

    // Check authentication
    const authCheck = await this.cliExecutor.checkAuthentication();
    if (!authCheck.authenticated) {
      return this.formatErrorResponse(
        'CLI_NOT_AUTHENTICATED',
        authCheck.error ?? 'GitHub CLI not authenticated. Run: gh auth login'
      );
    }

    // Get parameters with defaults
    const mode = p.mode ?? 'general';
    const timeout = (p.timeout ?? this.defaultTimeout) * 1000; // Convert to ms

    try {
      // Execute Copilot CLI
      const result = await this.cliExecutor.execute({
        prompt: p.prompt,
        mode,
        timeout,
      });

      // Handle truncated output
      if (result.truncated) {
        return this.formatTextResponse(result.stdout || result.stderr, {
          duration: 0, // Set by base class
          warnings: [`Output was truncated to ${this.maxOutputSize} bytes`],
        });
      }

      if (result.timedOut) {
        return this.formatErrorResponse('TIMEOUT', 'GitHub Copilot CLI execution timed out');
      }

      // Success
      if (result.exitCode === 0) {
        return this.formatTextResponse(result.stdout);
      }

      // Error handling
      const errorInfo = mapCLIError(result.exitCode, result.stderr, result.signal);
      return this.formatErrorResponse(errorInfo.code, errorInfo.message, {
        exitCode: result.exitCode,
        stderr: result.stderr,
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
      if (!this.cliAvailable) {
        return {
          healthy: false,
          error: 'GitHub Copilot CLI not available',
        };
      }

      const authCheck = await this.cliExecutor.checkAuthentication();
      if (!authCheck.authenticated) {
        return {
          healthy: false,
          error: authCheck.error ?? 'Not authenticated',
        };
      }

      return {
        healthy: true,
        details: {
          cliAvailable: this.cliAvailable,
          authenticated: true,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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
