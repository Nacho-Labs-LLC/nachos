import { TOPICS } from '@nachos/bus';
import type {
  ContextCheckResult,
  ContextManager,
  EnhancedCompactionResult,
} from '@nachos/context-manager';
import { messageAdapter } from '@nachos/context-manager';
import type { Message, MessageEnvelope } from '@nachos/types';
import { createLogger } from '@nachos/types';
import type { MemoryPipeline, SessionsStore, StateOperationContext } from '@nachos/state';
import { v4 as uuid } from 'uuid';

const logger = createLogger('context-compaction-manager');

function createEnvelope(
  source: string,
  type: string,
  payload: unknown,
  correlationId?: string
): MessageEnvelope {
  return {
    id: uuid(),
    timestamp: new Date().toISOString(),
    source,
    type,
    correlationId,
    payload,
  };
}

export interface ContextCompactionManagerDeps {
  contextManager?: ContextManager;
  sessionsStore?: SessionsStore;
  bus: {
    publish(topic: string, data: unknown): Promise<void>;
  };
  componentName: string;
  securityMode: 'strict' | 'standard' | 'permissive';
  memoryPipeline?: MemoryPipeline;
}

export class ContextCompactionManager {
  private readonly contextManager?: ContextManager;
  private readonly sessionsStore?: SessionsStore;
  private readonly bus: {
    publish(topic: string, data: unknown): Promise<void>;
  };
  private readonly componentName: string;
  private readonly securityMode: 'strict' | 'standard' | 'permissive';
  private readonly memoryPipeline?: MemoryPipeline;

  constructor(deps: ContextCompactionManagerDeps) {
    this.contextManager = deps.contextManager;
    this.sessionsStore = deps.sessionsStore;
    this.bus = deps.bus;
    this.componentName = deps.componentName;
    this.securityMode = deps.securityMode;
    this.memoryPipeline = deps.memoryPipeline;
  }

  async checkAndCompactContext(params: {
    sessionId: string;
    contextWindow?: number;
    systemPromptTokens?: number;
  }): Promise<void> {
    // Skip if context manager or sessions store not configured
    if (!this.contextManager || !this.sessionsStore) {
      return;
    }

    const { sessionId, contextWindow = 200000, systemPromptTokens = 0 } = params;

    const managerConfig = this.contextManager.getConfig();

    // Get session with messages
    const sessionWithMessages = await this.sessionsStore.getSessionWithMessages(sessionId);
    if (!sessionWithMessages) {
      logger.warn({ sessionId }, 'Cannot check context: session not found');
      return;
    }

    const metadata = sessionWithMessages.metadata as {
      contextManagement?: { enabled?: boolean; compactionHistory?: Array<Record<string, unknown>> };
    } | null;
    if (metadata?.contextManagement?.enabled === false) {
      return;
    }

    const stateContext: StateOperationContext = {
      sessionId,
      userId: sessionWithMessages.userId,
      securityMode: this.securityMode,
      channel: sessionWithMessages.channel,
    };

    // Convert NACHOS messages to ContextMessages
    const contextMessages = sessionWithMessages.messages.map((msg) =>
      messageAdapter.toContextMessage(msg)
    );

    // Check if compaction is needed
    const check: ContextCheckResult = await this.contextManager.checkBeforeTurn({
      sessionId,
      messages: contextMessages,
      systemPromptTokens,
      contextWindow,
      reserveTokens: 20000, // Reserve 20k tokens for response
    });

    // Publish budget update event
    const budgetEvent = {
      sessionId,
      timestamp: new Date().toISOString(),
      budget: check.budget,
      needsCompaction: check.needsCompaction,
    };
    await this.bus.publish(
      TOPICS.context.budgetUpdate,
      createEnvelope(this.componentName, 'context.budget_update', budgetEvent)
    );

    // Publish zone change if zone is concerning
    if (
      check.budget.zone === 'yellow' ||
      check.budget.zone === 'orange' ||
      check.budget.zone === 'red' ||
      check.budget.zone === 'critical'
    ) {
      const zoneEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        zone: check.budget.zone,
        utilizationRatio: check.budget.utilizationRatio,
        currentUsage: check.budget.currentUsage,
        historyBudget: check.budget.historyBudget,
      };
      await this.bus.publish(
        TOPICS.context.zoneChange,
        createEnvelope(this.componentName, 'context.zone_change', zoneEvent)
      );
    }

    // If compaction not needed, we're done
    if (!check.needsCompaction || !check.action) {
      return;
    }

    logger.info({ sessionId, reason: check.action.reason }, 'Context compaction needed');

    // Execute compaction
    const compactionResult: EnhancedCompactionResult = await this.contextManager.compact({
      sessionId,
      messages: contextMessages,
      action: check.action,
      contextWindow,
    });

    // Convert compacted messages back to NACHOS format
    if (!compactionResult.messagesKept) {
      logger.warn('Compaction completed without messagesKept. Skipping message replacement.');
      return;
    }

    if (
      !compactionResult.budget ||
      !compactionResult.messagesDropped ||
      !compactionResult.slidingResult
    ) {
      logger.warn('Compaction result missing details. Skipping metadata update.');
      return;
    }

    const compactedNachosMessages: Message[] = compactionResult.messagesKept.map((msg) =>
      messageAdapter.toNachosMessage(msg, sessionId)
    );

    // Replace messages in SessionsStore (atomic operation)
    const messageCount = await this.sessionsStore.getMessageCount(sessionId);
    logger.info(
      { before: messageCount, after: compactedNachosMessages.length },
      'Replacing messages with compacted messages'
    );

    // Atomically replace messages in storage
    await this.sessionsStore.replaceMessages(sessionId, compactedNachosMessages);

    // Update session metadata with context state
    await this.sessionsStore.updateSession(sessionId, {
      metadata: {
        contextManagement: {
          lastCompaction: new Date().toISOString(),
          budget: check.budget,
          compactionHistory: [
            ...(metadata?.contextManagement?.compactionHistory ?? []),
            {
              timestamp: new Date().toISOString(),
              trigger: check.action.type,
              zone: check.action.zone,
              tokensBefore: check.budget.currentUsage,
              tokensAfter: compactionResult.budget.currentUsage,
              messagesDropped: compactionResult.messagesDropped.length,
            },
          ],
        },
      },
    });

    // Publish compaction event
    const compactionEvent = {
      sessionId,
      timestamp: new Date().toISOString(),
      trigger: check.action.type,
      zone: check.action.zone,
      result: {
        tokensBefore: check.budget.currentUsage,
        tokensAfter: compactionResult.budget.currentUsage,
        messagesDropped: compactionResult.messagesDropped.length,
        messagesKept: compactionResult.messagesKept.length,
        tokensRemoved: compactionResult.slidingResult.tokensRemoved,
        summaryGenerated: compactionResult.summary !== undefined,
      },
    };
    await this.bus.publish(
      TOPICS.context.compaction,
      createEnvelope(this.componentName, 'context.compaction', compactionEvent)
    );

    // Publish extraction event if history was extracted
    if (compactionResult.extracted) {
      if (this.memoryPipeline && managerConfig.proactive_history?.enabled) {
        try {
          await this.memoryPipeline.storeExtracted({
            session: sessionWithMessages,
            extracted: compactionResult.extracted,
            context: stateContext,
            trigger: 'compaction',
          });
        } catch (error) {
          logger.warn({ err: error }, 'Failed to store compaction extraction');
        }
      }

      const extractionEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        trigger: 'compaction',
        extracted: {
          decisions: compactionResult.extracted.decisions.length,
          facts: compactionResult.extracted.facts.length,
          tasks: compactionResult.extracted.tasks.length,
          issues: compactionResult.extracted.issues.length,
          files: compactionResult.extracted.files.length,
        },
      };
      await this.bus.publish(
        TOPICS.context.extraction,
        createEnvelope(this.componentName, 'context.extraction', extractionEvent)
      );
    }

    logger.info(
      {
        tokensBefore: check.budget.currentUsage,
        tokensAfter: compactionResult.budget.currentUsage,
      },
      'Context compaction completed'
    );
  }
}
