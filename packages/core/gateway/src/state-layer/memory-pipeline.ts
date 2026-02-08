/**
 * Proactive memory pipeline using context-manager extraction.
 */

import { randomUUID } from 'node:crypto';
import {
  DLPExtractionAdapter,
  messageAdapter,
  type ExtractedItem,
  type ProactiveHistoryConfig,
} from '@nachos/context-manager';
import type { Message, Session, SessionStateRecord } from '@nachos/types';
import type { MemoryEntry, MemoryFact } from '@nachos/types';
import type { StateLayer, StateOperationContext } from './state-layer.js';

export interface MemoryPipelineConfig {
  proactiveHistory: ProactiveHistoryConfig;
  agentIdResolver: (session: Session) => string;
}

export type MemoryPipelineTrigger = 'compaction' | 'threshold' | 'periodic' | 'memory_flush';

export class MemoryPipeline {
  private extractor: DLPExtractionAdapter;
  private config: MemoryPipelineConfig;

  constructor(
    private stateLayer: StateLayer,
    config: MemoryPipelineConfig
  ) {
    this.config = config;
    this.extractor = new DLPExtractionAdapter(config.proactiveHistory);
  }

  getPeriodicIntervalMs(): number | null {
    return parseDurationMs(this.config.proactiveHistory.triggers?.periodic);
  }

  async handleExtraction(params: {
    session: Session;
    messages: Message[];
    context: StateOperationContext;
    trigger: MemoryPipelineTrigger;
  }): Promise<{
    extracted: Record<string, ExtractedItem[]>;
    entries: MemoryEntry[];
    facts: MemoryFact[];
  }> {
    const contextMessages = params.messages.map((msg) => messageAdapter.toContextMessage(msg));
    const extracted = await this.extractor.extract(contextMessages);

    const agentId = this.config.agentIdResolver(params.session);
    const { entries, facts } = this.mapExtractedToMemory(extracted, agentId, params.session.id);

    for (const entry of entries) {
      await this.stateLayer.appendMemoryEntry(entry, params.context);
    }

    if (facts.length > 0) {
      await this.stateLayer.appendMemoryFacts(facts, params.context);
    }

    await this.updateSessionState(params.session, params.context, params.trigger);

    return { extracted, entries, facts };
  }

  async storeExtracted(params: {
    session: Session;
    extracted: Record<string, ExtractedItem[]>;
    context: StateOperationContext;
    trigger: MemoryPipelineTrigger;
  }): Promise<{
    extracted: Record<string, ExtractedItem[]>;
    entries: MemoryEntry[];
    facts: MemoryFact[];
  }> {
    const agentId = this.config.agentIdResolver(params.session);
    const { entries, facts } = this.mapExtractedToMemory(
      params.extracted,
      agentId,
      params.session.id
    );

    for (const entry of entries) {
      await this.stateLayer.appendMemoryEntry(entry, params.context);
    }

    if (facts.length > 0) {
      await this.stateLayer.appendMemoryFacts(facts, params.context);
    }

    await this.updateSessionState(params.session, params.context, params.trigger);

    return { extracted: params.extracted, entries, facts };
  }

  async shouldRunPeriodic(session: Session, context: StateOperationContext): Promise<boolean> {
    if (!this.config.proactiveHistory.triggers?.periodic) return false;
    const periodicMs = parseDurationMs(this.config.proactiveHistory.triggers.periodic);
    if (!periodicMs) return false;

    const state = await this.stateLayer.getSessionState(session.id, context);
    const lastExtraction = getContextTimestamp(state, 'lastExtraction');
    if (!lastExtraction) return true;
    return Date.now() - lastExtraction >= periodicMs;
  }

  private async updateSessionState(
    session: Session,
    context: StateOperationContext,
    trigger: MemoryPipelineTrigger
  ): Promise<void> {
    const current = await this.stateLayer.getSessionState(session.id, context);
    const updatedState = {
      ...(current?.state ?? {}),
      contextManagement: {
        ...(current?.state?.contextManagement as Record<string, unknown> | undefined),
        lastExtraction: Date.now(),
        lastExtractionTrigger: trigger,
      },
    };

    const record: SessionStateRecord = {
      sessionId: session.id,
      agentId: this.config.agentIdResolver(session),
      state: updatedState,
      updatedAt: new Date().toISOString(),
    };

    await this.stateLayer.setSessionState(record, context);
  }

  private mapExtractedToMemory(
    extracted: Record<string, ExtractedItem[]>,
    agentId: string,
    sessionId: string
  ): { entries: MemoryEntry[]; facts: MemoryFact[] } {
    const entries: MemoryEntry[] = [];
    const facts: MemoryFact[] = [];

    const pushEntry = (item: ExtractedItem, kind: MemoryEntry['kind']) => {
      entries.push({
        id: randomUUID(),
        agentId,
        kind,
        content: item.content,
        tags: [item.type],
        confidence: item.metadata?.confidence as number | undefined,
        provenance: {
          source: 'proactive_history',
          sessionId,
          messageIds: item.sourceMessageId ? [item.sourceMessageId] : undefined,
        },
        createdAt: new Date(item.timestamp).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    };

    const allItems = Object.values(extracted).flat();
    for (const item of allItems) {
      switch (item.type) {
        case 'decision':
          pushEntry(item, 'decision');
          break;
        case 'task':
          pushEntry(item, 'task');
          break;
        case 'fact':
          pushEntry(item, 'fact');
          facts.push(this.buildFact(item, agentId));
          break;
        case 'error':
          pushEntry(item, 'issue');
          break;
        case 'code':
          pushEntry(item, 'fact');
          break;
        case 'context':
        default:
          pushEntry(item, 'summary');
          break;
      }
    }

    return { entries, facts };
  }

  private buildFact(item: ExtractedItem, agentId: string): MemoryFact {
    const parsed = parseFactContent(item.content);
    return {
      id: randomUUID(),
      agentId,
      subject: parsed.subject,
      predicate: parsed.predicate,
      object: parsed.object,
      confidence: item.metadata?.confidence as number | undefined,
      createdAt: new Date(item.timestamp).toISOString(),
    };
  }
}

function parseDurationMs(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unit = (match[2] ?? '').toLowerCase();
  if (Number.isNaN(amount)) return null;

  switch (unit) {
    case 'ms':
      return amount;
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function parseFactContent(content: string): { subject: string; predicate: string; object: string } {
  const separators = ['->', ':', '='];
  for (const separator of separators) {
    const index = content.indexOf(separator);
    if (index > 0) {
      const subject = content.slice(0, index).trim();
      const object = content.slice(index + separator.length).trim();
      return {
        subject: subject || 'unknown',
        predicate: separator === '->' ? 'maps_to' : 'is',
        object: object || 'unknown',
      };
    }
  }

  return {
    subject: 'note',
    predicate: 'states',
    object: content.trim(),
  };
}

function getContextTimestamp(state: SessionStateRecord | null, key: string): number | null {
  if (!state?.state) return null;
  const contextManagement = state.state.contextManagement as Record<string, unknown> | undefined;
  if (!contextManagement) return null;
  const value = contextManagement[key];
  return typeof value === 'number' ? value : null;
}
