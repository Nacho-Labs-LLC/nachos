/**
 * Subagent orchestration with in-memory queue and announce pipeline.
 */

import { randomUUID } from 'node:crypto';
import type { LLMRequestType } from '@nachos/types';
import type { Router } from '../router.js';
import type { SessionManager } from '../session.js';
import type { SubagentManager } from './subagent-manager.js';
import type {
  SubagentAnnounceConfig,
  SubagentOrchestratorConfig,
  SubagentRunRecord,
  SubagentRunRequest,
  SubagentResult,
} from './types.js';
import {
  buildAnnounceFallback,
  buildAnnouncePrompt,
  extractResponseText,
  extractMessageText,
} from './announce.js';

interface SubagentRunEntry {
  record: SubagentRunRecord;
  request: SubagentRunRequest;
  result?: SubagentResult;
  queuedAtMs: number;
}

export interface SubagentOrchestratorDeps {
  subagentManager: SubagentManager;
  sessionManager: SessionManager;
  router: Router;
  buildLLMRequest: (
    sessionId: string,
    extraMessages?: LLMRequestType['messages'],
    stream?: boolean
  ) => Promise<LLMRequestType & { systemPromptTokens?: number }>;
  defaultSystemPrompt?: string;
  config?: SubagentOrchestratorConfig;
}

export class SubagentOrchestrator {
  private runs = new Map<string, SubagentRunEntry>();
  private queue: string[] = [];
  private runningCount = 0;
  private maxConcurrent: number;
  private announceConfig: SubagentAnnounceConfig;
  private stopped = false;

  constructor(private deps: SubagentOrchestratorDeps) {
    this.maxConcurrent = Math.max(1, Math.floor(deps.config?.maxConcurrent ?? 1));
    this.announceConfig = {
      enabled: deps.config?.announce?.enabled ?? true,
      prompt: deps.config?.announce?.prompt,
    };
  }

  async enqueue(request: SubagentRunRequest): Promise<SubagentRunRecord> {
    if (this.stopped) {
      throw new Error('Subagent orchestrator is stopped');
    }

    const task = request.task.trim();
    if (!task) {
      throw new Error('Subagent task is required');
    }

    const runId = randomUUID();
    const now = new Date().toISOString();
    const childSessionId = this.createSubagentSession(runId, { ...request, task });

    const record: SubagentRunRecord = {
      runId,
      status: 'queued',
      createdAt: now,
      task,
      label: request.label,
      profile: request.profile,
      agentId: request.agentId,
      requester: request.requester,
      childSessionId,
    };

    this.runs.set(runId, {
      record,
      request,
      queuedAtMs: Date.now(),
    });
    this.queue.push(runId);
    this.drainQueue();

    return record;
  }

  listRuns(): SubagentRunRecord[] {
    return Array.from(this.runs.values()).map((entry) => entry.record);
  }

  getRun(runId: string): SubagentRunRecord | null {
    return this.runs.get(runId)?.record ?? null;
  }

  getRunResult(runId: string): SubagentResult | undefined {
    return this.runs.get(runId)?.result;
  }

  stopRun(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry) {
      return false;
    }

    if (entry.record.status !== 'queued') {
      return false;
    }

    entry.record.status = 'cancelled';
    entry.record.completedAt = new Date().toISOString();

    this.queue = this.queue.filter((queuedId) => queuedId !== runId);
    return true;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.queue = [];
  }

  private drainQueue(): void {
    while (!this.stopped && this.runningCount < this.maxConcurrent && this.queue.length > 0) {
      const runId = this.queue.shift();
      if (!runId) {
        break;
      }
      const entry = this.runs.get(runId);
      if (!entry || entry.record.status !== 'queued') {
        continue;
      }

      void this.executeRun(entry);
    }
  }

  private async executeRun(entry: SubagentRunEntry): Promise<void> {
    entry.record.status = 'running';
    entry.record.startedAt = new Date().toISOString();
    this.runningCount += 1;

    try {
      const request = entry.request;
      const childSessionId = entry.record.childSessionId;
      const llmRequest = await this.deps.buildLLMRequest(childSessionId, [], false);
      const result = await this.deps.subagentManager.run({
        id: entry.record.runId,
        request: llmRequest,
        timeoutMs: request.timeoutMs,
        sandboxMode: request.sandboxMode,
      });

      entry.result = result;
      entry.record.durationMs = result.durationMs;
      entry.record.sandboxed = result.sandboxed;

      if (result.success) {
        entry.record.status = 'completed';
        const responseText = extractResponseText(result.response);
        if (responseText) {
          this.deps.sessionManager.addMessage(childSessionId, {
            role: 'assistant',
            content: responseText,
            toolCalls: result.response?.toolCalls,
          });
        }
      } else {
        entry.record.status = 'failed';
        entry.record.error = {
          code: result.error?.code ?? 'SUBAGENT_FAILED',
          message: result.error?.message ?? 'Subagent execution failed',
        };
      }

      entry.record.completedAt = new Date().toISOString();

      await this.announce(entry);
    } catch (error) {
      entry.record.status = 'failed';
      entry.record.error = {
        code: 'SUBAGENT_ORCHESTRATOR_ERROR',
        message: error instanceof Error ? error.message : 'Subagent orchestration failed',
      };
      entry.record.completedAt = new Date().toISOString();
    } finally {
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.drainQueue();
    }
  }

  private createSubagentSession(runId: string, request: SubagentRunRequest): string {
    const baseConfig = request.sessionConfig ?? {};
    const config = {
      ...baseConfig,
      model: request.model ?? baseConfig.model,
    };

    const session = this.deps.sessionManager.getOrCreateSession({
      channel: 'subagent',
      conversationId: runId,
      userId: request.requester.userId ?? request.requester.sessionId,
      systemPrompt: this.deps.defaultSystemPrompt,
      config,
      metadata: {
        subagent: {
          runId,
          label: request.label,
          profile: request.profile,
          agentId: request.agentId,
          requester: request.requester,
        },
      },
    });

    this.deps.sessionManager.addMessage(session.id, {
      role: 'user',
      content: request.task,
    });

    return session.id;
  }

  private async announce(entry: SubagentRunEntry): Promise<void> {
    if (this.announceConfig.enabled === false) {
      return;
    }

    const record = entry.record;
    const result = entry.result;
    const childSessionId = record.childSessionId;
    const responseText = extractResponseText(result?.response);
    const prompt = buildAnnouncePrompt({
      template: this.announceConfig.prompt,
      run: record,
      result,
      responseText,
    });

    this.deps.sessionManager.addMessage(childSessionId, {
      role: 'user',
      content: prompt,
    });

    const announceRequest = await this.deps.buildLLMRequest(childSessionId, [], false);
    const announceResult = await this.deps.subagentManager.run({
      id: `${record.runId}-announce`,
      request: announceRequest,
      sandboxMode: entry.request.sandboxMode,
    });

    const announceText =
      extractMessageText(announceResult.response?.message) ??
      buildAnnounceFallback(record, responseText);

    this.deps.sessionManager.addMessage(childSessionId, {
      role: 'assistant',
      content: announceText,
    });

    await this.deps.router.sendToChannel({
      channel: record.requester.channel,
      conversationId: record.requester.conversationId,
      replyToMessageId: record.requester.replyToMessageId,
      sessionId: record.requester.sessionId,
      content: {
        text: announceText,
        format: 'markdown',
      },
    });
  }
}
