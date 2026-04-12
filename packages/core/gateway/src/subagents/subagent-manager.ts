/**
 * Subagent execution manager with sandbox support.
 */

import type { LLMRequestType, LLMResponseType } from '@nachos/types';
import type { SubagentManagerConfig, SubagentResult, SubagentTask } from './types.js';
import { DockerSubagentSandbox } from './docker-sandbox.js';

export type LLMRequestSender = (request: LLMRequestType) => Promise<LLMResponseType>;

export class SubagentManager {
  private dockerSandbox?: DockerSubagentSandbox;
  private mode: SubagentManagerConfig['mode'];

  constructor(
    config: SubagentManagerConfig,
    private sendRequest: LLMRequestSender
  ) {
    this.mode = config.mode;
    if (config.docker) {
      this.dockerSandbox = new DockerSubagentSandbox(config.docker);
    }
  }

  async run(task: SubagentTask): Promise<SubagentResult> {
    const start = Date.now();
    const mode = task.sandboxMode ?? this.mode;

    if (mode === 'full') {
      if (!this.dockerSandbox) {
        return {
          success: false,
          error: {
            code: 'SUBAGENT_SANDBOX_UNAVAILABLE',
            message: 'Docker sandbox is not configured',
          },
          durationMs: Date.now() - start,
          sandboxed: true,
        };
      }
      return this.dockerSandbox.run(task);
    }

    try {
      const response = await this.sendRequest(task.request);
      return {
        success: response.success,
        response,
        durationMs: Date.now() - start,
        sandboxed: false,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SUBAGENT_HOST_ERROR',
          message: error instanceof Error ? error.message : 'Unknown subagent error',
          details: error,
        },
        durationMs: Date.now() - start,
        sandboxed: false,
      };
    }
  }
}
