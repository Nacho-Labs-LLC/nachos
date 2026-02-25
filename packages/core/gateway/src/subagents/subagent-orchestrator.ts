/**
 * Subagent orchestration with in-memory queue and announce pipeline.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LLMRequestType } from '@nachos/types';
import { createInvalidStateError, createValidationError } from '@nachos/types';
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
import { ensureSubagentWorkspaceDir } from './workspace-utils.js';
import { selectModel } from './model-selection.js';

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
  subscribe?: (topic: string, handler: (data: unknown) => Promise<void>) => Promise<void>;
  unsubscribe?: (topic: string) => Promise<void>;
  defaultSystemPrompt?: string;
  config?: SubagentOrchestratorConfig;
  workspaceRoot?: string;
}

export class SubagentOrchestrator {
  private runs = new Map<string, SubagentRunEntry>();
  private queue: string[] = [];
  private runningCount = 0;
  private maxConcurrent: number;
  private announceConfig: SubagentAnnounceConfig;
  private stopped = false;
  private workspaceRoot?: string;
  private workspaceDirs = new Map<string, string>();
  private workflows = new Map<string, import('./types.js').WorkflowRunRecord>();

  constructor(private deps: SubagentOrchestratorDeps) {
    this.maxConcurrent = Math.max(1, Math.floor(deps.config?.maxConcurrent ?? 1));
    this.announceConfig = {
      enabled: deps.config?.announce?.enabled ?? true,
      prompt: deps.config?.announce?.prompt,
    };
    this.workspaceRoot = deps.workspaceRoot ? path.resolve(deps.workspaceRoot) : undefined;
  }

  async enqueue(request: SubagentRunRequest): Promise<SubagentRunRecord> {
    if (this.stopped) {
      throw createInvalidStateError('Subagent orchestrator is stopped', { component: 'gateway' });
    }

    const task = request.task.trim();
    if (!task) {
      throw createValidationError('Subagent task is required', { component: 'gateway' });
    }

    // Only select model when explicitly requested or auto-select is enabled
    // This preserves session.config.model for subagents without overrides
    const modelsConfig = this.deps.config?.models;
    const hasExplicitOverride = Boolean(request.model || request.modelHint);
    const autoSelectEnabled = Boolean(modelsConfig?.autoSelect || modelsConfig?.defaultModel);

    let selectedModel: string | undefined;
    if (hasExplicitOverride || autoSelectEnabled) {
      selectedModel = selectModel(
        task,
        {
          model: request.model,
          modelHint: request.modelHint,
        },
        modelsConfig
      );
    }

    const runId = randomUUID();
    const now = new Date().toISOString();
    const workspaceDir = await this.ensureWorkspace(runId);
    const childSessionId = this.createSubagentSession(runId, { ...request, task }, workspaceDir);

    const record: SubagentRunRecord = {
      runId,
      status: 'queued',
      createdAt: now,
      task,
      label: request.label,
      profile: request.profile,
      agentId: request.agentId,
      model: selectedModel,
      requester: request.requester,
      childSessionId,
      stream: request.stream,
      streamChunks: request.stream ? [] : undefined,
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

  getRunWorkspaceDir(runId: string): string | null {
    return this.workspaceDirs.get(runId) ?? null;
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

  async steerRun(runId: string, message: string): Promise<boolean> {
    const entry = this.runs.get(runId);
    if (!entry) {
      return false;
    }

    // Can only steer running subagents (not queued, completed, or failed)
    if (entry.record.status !== 'running') {
      return false;
    }

    // Add user message to subagent's session
    this.deps.sessionManager.addMessage(entry.record.childSessionId, {
      role: 'user',
      content: message,
    });

    return true;
  }

  reportProgress(
    runId: string,
    status: string,
    percentage?: number,
    metadata?: Record<string, unknown>
  ): boolean {
    const entry = this.runs.get(runId);
    if (!entry) {
      return false;
    }

    // Can only report progress for running subagents
    if (entry.record.status !== 'running') {
      return false;
    }

    // Initialize progress array if not present
    if (!entry.record.progress) {
      entry.record.progress = [];
    }

    // Add progress update
    entry.record.progress.push({
      timestamp: new Date().toISOString(),
      status,
      percentage,
      metadata,
    });

    return true;
  }

  async enqueueWorkflow(
    workflow: import('./dependency-graph.js').WorkflowDefinition,
    requester: import('./types.js').SubagentRequesterInfo
  ): Promise<import('./types.js').WorkflowRunRecord> {
    if (this.stopped) {
      throw createInvalidStateError('Subagent orchestrator is stopped', { component: 'gateway' });
    }

    // Validate workflow
    const { validateWorkflow, computeExecutionPlan } = await import('./dependency-graph.js');
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      throw createValidationError(
        validation.error?.message ?? 'Invalid workflow',
        { component: 'gateway', details: validation.error }
      );
    }

    // Compute execution plan
    const plan = computeExecutionPlan(workflow);

    const workflowId = randomUUID();
    const now = new Date().toISOString();

    const workflowRecord: import('./types.js').WorkflowRunRecord = {
      workflowId,
      status: 'queued',
      createdAt: now,
      requester,
      stepResults: new Map(),
      currentBatch: 0,
      totalBatches: plan.batches.length,
    };

    this.workflows.set(workflowId, workflowRecord);

    // Start workflow execution
    void this.executeWorkflow(workflowId, plan, requester);

    return workflowRecord;
  }

  getWorkflow(workflowId: string): import('./types.js').WorkflowRunRecord | null {
    return this.workflows.get(workflowId) ?? null;
  }

  listWorkflows(): import('./types.js').WorkflowRunRecord[] {
    return Array.from(this.workflows.values());
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

      // Claim the slot synchronously before the async executeRun starts,
      // otherwise the while loop can over-schedule.
      entry.record.status = 'running';
      entry.record.startedAt = new Date().toISOString();
      this.runningCount += 1;

      void this.executeRun(entry);
    }
  }

  private async executeRun(entry: SubagentRunEntry): Promise<void> {
    let streamTopic: string | null = null;

    try {
      const request = entry.request;
      const childSessionId = entry.record.childSessionId;
      const enableStreaming = Boolean(request.stream);
      
      // Subscribe to stream topic if streaming is enabled
      if (enableStreaming && this.deps.subscribe) {
        streamTopic = `nachos.llm.stream.${childSessionId}`;
        await this.deps.subscribe(streamTopic, async (data: unknown) => {
          // Accumulate stream chunks
          const chunk = data as { type: string; content?: string };
          if (chunk.type === 'delta' && chunk.content) {
            if (!entry.record.streamChunks) {
              entry.record.streamChunks = [];
            }
            entry.record.streamChunks.push(chunk.content);
            
            // Optionally deliver chunks to requester in real-time
            // For now, we accumulate them and deliver at completion
          }
        });
      }
      
      const llmRequest = await this.deps.buildLLMRequest(childSessionId, [], enableStreaming);
      
      // Override model with selected model for this subagent
      if (entry.record.model) {
        llmRequest.options = llmRequest.options || {};
        llmRequest.options.model = entry.record.model;
      }
      
      const result = await this.deps.subagentManager.run({
        id: entry.record.runId,
        request: llmRequest,
        timeoutMs: request.timeoutMs,
        sandboxMode: request.sandboxMode,
        workspaceDir: this.workspaceDirs.get(entry.record.runId) ?? undefined,
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
      // Unsubscribe from stream topic
      if (streamTopic && this.deps.unsubscribe) {
        await this.deps.unsubscribe(streamTopic);
      }
      
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.drainQueue();
    }
  }

  private createSubagentSession(
    runId: string,
    request: SubagentRunRequest,
    workspaceDir?: string
  ): string {
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
          workspaceDir,
        },
      },
    });

    this.deps.sessionManager.addMessage(session.id, {
      role: 'user',
      content: request.task,
    });

    return session.id;
  }

  private async ensureWorkspace(runId: string): Promise<string | undefined> {
    if (!this.workspaceRoot) {
      return undefined;
    }
    const dir = await ensureSubagentWorkspaceDir(this.workspaceRoot, runId);
    this.workspaceDirs.set(runId, dir);
    return dir;
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
    
    // Use the same model for announce as the main subagent run
    if (entry.record.model) {
      announceRequest.options = announceRequest.options || {};
      announceRequest.options.model = entry.record.model;
    }
    
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

  private async executeWorkflow(
    workflowId: string,
    plan: import('./dependency-graph.js').ExecutionPlan,
    requester: import('./types.js').SubagentRequesterInfo
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return;
    }

    workflow.status = 'running';
    workflow.startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Execute batches sequentially
      for (let batchIndex = 0; batchIndex < plan.batches.length; batchIndex++) {
        workflow.currentBatch = batchIndex;
        const batch = plan.batches[batchIndex];
        if (!batch) {
          throw new Error(`Batch ${batchIndex} not found in execution plan`);
        }

        // Spawn all steps in the batch (parallel execution)
        const batchPromises = batch.map(async (stepId) => {
          const step = plan.steps.get(stepId);
          if (!step) {
            throw new Error(`Step ${stepId} not found in execution plan`);
          }

          // Build task with dependency results injected
          let enhancedTask = step.task;
          if (step.dependsOn && step.dependsOn.length > 0) {
            const depResults: string[] = [];
            for (const depId of step.dependsOn) {
              const depResult = workflow.stepResults.get(depId);
              if (depResult?.result) {
                depResults.push(`**Result from step "${depId}":**\n${depResult.result}`);
              }
            }
            if (depResults.length > 0) {
              enhancedTask = `${depResults.join('\n\n')}\n\n**Your task:**\n${step.task}`;
            }
          }

          // Enqueue the step as a regular subagent
          const run = await this.enqueue({
            task: enhancedTask,
            model: step.model,
            modelHint: step.modelHint,
            stream: step.stream,
            requester,
          });

          // Mark the run as part of this workflow
          const runEntry = this.runs.get(run.runId);
          if (runEntry) {
            runEntry.record.workflowId = workflowId;
            runEntry.record.stepId = stepId;
          }

          // Wait for completion
          let attempts = 0;
          while (attempts < 3000) {
            // 5 minutes max
            const runRecord = this.getRun(run.runId);
            if (runRecord?.status === 'completed' || runRecord?.status === 'failed') {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
          }

          const finalRun = this.getRun(run.runId);
          const result = this.getRunResult(run.runId);

          // Extract result text
          let resultText: string | undefined;
          if (result?.success && result.response?.message) {
            resultText =
              typeof result.response.message.content === 'string'
                ? result.response.message.content
                : undefined;
          }

          // Store step result
          const stepResult: import('./types.js').WorkflowStepResult = {
            stepId,
            runId: run.runId,
            status: finalRun?.status ?? 'failed',
            result: resultText,
            error: finalRun?.error,
            durationMs: finalRun?.durationMs,
          };

          workflow.stepResults.set(stepId, stepResult);

          // If step failed, propagate error
          if (finalRun?.status === 'failed') {
            throw new Error(`Step "${stepId}" failed: ${finalRun.error?.message ?? 'Unknown error'}`);
          }
        });

        // Wait for all steps in batch to complete
        await Promise.all(batchPromises);
      }

      // Workflow completed successfully
      workflow.status = 'completed';
      workflow.completedAt = new Date().toISOString();
      workflow.durationMs = Date.now() - startTime;
    } catch (error) {
      workflow.status = 'failed';
      workflow.error = {
        code: 'WORKFLOW_EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Workflow execution failed',
      };
      workflow.completedAt = new Date().toISOString();
      workflow.durationMs = Date.now() - startTime;
    }
  }
}
