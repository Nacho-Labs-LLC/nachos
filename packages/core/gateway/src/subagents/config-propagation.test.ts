/**
 * Tests for subagent config propagation
 *
 * Verifies that provider config (model, sessionConfig) correctly flows
 * from SubagentRunRequest → session creation → LLM request → adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentOrchestratorDeps } from './subagent-orchestrator.js';
import type { SubagentRunRequest } from './types.js';
import type { LLMRequestType, Message, Session } from '@nachos/types';
import type { SubagentManager } from './subagent-manager.js';
import type { SessionsStore } from '@nachos/state';
import type { Router } from '../router.js';

/**
 * Creates mock deps that capture session creation params and LLM request args
 * so we can assert config propagation end-to-end.
 */
function createTrackedDeps() {
  const createdSessions: Array<{
    config: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }> = [];
  const llmRequests: LLMRequestType[] = [];
  const messages = new Map<string, Message[]>();

  const deps: SubagentOrchestratorDeps = {
    subagentManager: {
      run: vi.fn(async (task) => {
        llmRequests.push(task.request);
        return {
          success: true,
          response: {
            success: true,
            message: { role: 'assistant', content: 'Done.' },
          },
          durationMs: 50,
          sandboxed: false,
        };
      }),
    } as unknown as SubagentManager,

    sessionsStore: {
      getOrCreateSessionAtomic: vi.fn((params) => {
        createdSessions.push({ config: params.config, metadata: params.metadata });
        const session = {
          id: params.conversationId,
          channel: params.channel,
          conversationId: params.conversationId,
          userId: params.userId,
          config: params.config,
          metadata: params.metadata,
        };
        messages.set(session.id, []);
        return { session: session as unknown as Session, created: true };
      }),
      addMessage: vi.fn((data) => {
        const sessionMessages = messages.get(data.sessionId) ?? [];
        sessionMessages.push(data);
        messages.set(data.sessionId, sessionMessages);
      }),
      getMessages: vi.fn((sessionId) => messages.get(sessionId) ?? []),
    } as unknown as SessionsStore,

    router: {
      sendToChannel: vi.fn(async () => {}),
    } as unknown as Router,

    buildLLMRequest: vi.fn(async (sessionId) => {
      const sessionMessages = messages.get(sessionId) ?? [];
      return {
        sessionId,
        messages: sessionMessages,
        options: {},
      } as LLMRequestType;
    }),

    defaultSystemPrompt: 'You are a helpful assistant.',
    config: {
      maxConcurrent: 4,
      announce: { enabled: false },
    },
  };

  return { deps, createdSessions, llmRequests };
}

const baseRequester = {
  sessionId: 'test-session',
  channel: 'test',
  conversationId: 'conv-1',
  userId: 'user-1',
};

/** Wait for orchestrator to drain and execute the queued run. */
async function waitForExecution(ms = 150): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Subagent config propagation', () => {
  describe('sessionConfig → session creation', () => {
    it('should store sessionConfig in the created session', async () => {
      const { deps, createdSessions } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      const request: SubagentRunRequest = {
        task: 'Summarize this file',
        requester: baseRequester,
        sessionConfig: {
          model: 'gpt-4o',
          maxTokens: 4096,
        },
      };

      await orchestrator.enqueue(request);

      expect(createdSessions).toHaveLength(1);
      expect(createdSessions[0].config).toEqual({
        model: 'gpt-4o',
        maxTokens: 4096,
      });
    });

    it('should use empty config when sessionConfig is omitted', async () => {
      const { deps, createdSessions } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Quick question',
        requester: baseRequester,
      });

      expect(createdSessions).toHaveLength(1);
      // No model selection triggered (no explicit model, no hint, no autoSelect, no defaultModel)
      expect(createdSessions[0].config).toEqual({ model: undefined });
    });
  });

  describe('request.model overrides sessionConfig.model', () => {
    it('should prefer explicit model over sessionConfig model', async () => {
      const { deps, createdSessions } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Analyze code',
        requester: baseRequester,
        model: 'claude-opus-4-6',
        sessionConfig: { model: 'gpt-4o' },
      });

      // Session should have the explicit model, not the sessionConfig one
      expect(createdSessions[0].config.model).toBe('claude-opus-4-6');
    });
  });

  describe('model override in executeRun', () => {
    it('should override llmRequest.options.model with selected model', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Research task',
        requester: baseRequester,
        model: 'sonnet',
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      // The model should be resolved from alias and set on the LLM request
      expect(llmRequests[0].options?.model).toBe('anthropic.claude-sonnet-4-6');
    });

    it('should not override model when none was selected', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Simple task',
        requester: baseRequester,
        // No model, no hint, no config with autoSelect/defaultModel
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      // buildLLMRequest returns options: {}, and no override should be applied
      expect(llmRequests[0].options?.model).toBeUndefined();
    });

    it('should resolve model aliases before passing to adapter', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Do something fast',
        requester: baseRequester,
        model: 'haiku',
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it('should pass through full model IDs unchanged', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Use a specific OpenAI model',
        requester: baseRequester,
        model: 'gpt-4o-2024-05-13',
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('gpt-4o-2024-05-13');
    });
  });

  describe('modelHint selection', () => {
    it('should select fast model for "fast" hint', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      deps.config = {
        maxConcurrent: 4,
        announce: { enabled: false },
        models: {},
      };
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Quick lookup',
        requester: baseRequester,
        modelHint: 'fast',
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it('should select thorough model for "thorough" hint', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      deps.config = {
        maxConcurrent: 4,
        announce: { enabled: false },
        models: {},
      };
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Deep analysis',
        requester: baseRequester,
        modelHint: 'thorough',
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('anthropic.claude-opus-4-6-v1');
    });
  });

  describe('auto-select with config.models', () => {
    it('should auto-select opus for complex tasks when autoSelect enabled', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      deps.config = {
        maxConcurrent: 4,
        announce: { enabled: false },
        models: { autoSelect: true },
      };
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Analyze and investigate the codebase for vulnerabilities, then refactor the security module',
        requester: baseRequester,
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('anthropic.claude-opus-4-6-v1');
    });

    it('should auto-select haiku for short simple tasks when autoSelect enabled', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      deps.config = {
        maxConcurrent: 4,
        announce: { enabled: false },
        models: { autoSelect: true },
      };
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Say hello',
        requester: baseRequester,
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it('should use defaultModel when autoSelect is off', async () => {
      const { deps, llmRequests } = createTrackedDeps();
      deps.config = {
        maxConcurrent: 4,
        announce: { enabled: false },
        models: { defaultModel: 'gpt-4o' },
      };
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Do something',
        requester: baseRequester,
      });

      await waitForExecution();

      expect(llmRequests).toHaveLength(1);
      expect(llmRequests[0].options?.model).toBe('gpt-4o');
    });
  });

  describe('metadata propagation', () => {
    it('should include subagent metadata in session', async () => {
      const { deps, createdSessions } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      await orchestrator.enqueue({
        task: 'Research task',
        label: 'my-research',
        profile: 'researcher',
        agentId: 'agent-42',
        requester: baseRequester,
      });

      expect(createdSessions).toHaveLength(1);
      const metadata = createdSessions[0].metadata as {
        subagent: { label: string; profile: string; agentId: string };
      };
      expect(metadata.subagent.label).toBe('my-research');
      expect(metadata.subagent.profile).toBe('researcher');
      expect(metadata.subagent.agentId).toBe('agent-42');
    });
  });

  describe('run record tracks selected model', () => {
    it('should store resolved model in run record', async () => {
      const { deps } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      const run = await orchestrator.enqueue({
        task: 'Do stuff',
        requester: baseRequester,
        model: 'opus',
      });

      expect(run.model).toBe('anthropic.claude-opus-4-6-v1');
    });

    it('should have undefined model in run record when no selection triggered', async () => {
      const { deps } = createTrackedDeps();
      const orchestrator = new SubagentOrchestrator(deps);

      const run = await orchestrator.enqueue({
        task: 'Simple task',
        requester: baseRequester,
      });

      expect(run.model).toBeUndefined();
    });
  });
});
