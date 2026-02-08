/**
 * Prompt assembler with safe reporting (hashes, sizes).
 */

import { createHash } from 'node:crypto';
import { TokenEstimator } from '@nachos/context-manager';
import type {
  IdentityProfile,
  MemoryEntry,
  MemoryFact,
  PromptAssemblyResult,
  PromptReport,
  PromptSectionReport,
  SessionStateRecord,
} from '@nachos/types';
import type { PromptAssemblyConfig } from '../types.js';

export interface PromptAssemblyParams {
  basePrompt: string;
  identity?: IdentityProfile | null;
  memoryEntries?: MemoryEntry[];
  memoryFacts?: MemoryFact[];
  sessionState?: SessionStateRecord | null;
}

export class PromptAssembler {
  private estimator = new TokenEstimator();
  private config: PromptAssemblyConfig;

  constructor(config?: PromptAssemblyConfig) {
    this.config = {
      hashAlgorithm: 'sha256',
      includeTokenEstimates: true,
      maxMemoryEntries: 50,
      maxMemoryFacts: 50,
      includeSessionState: false,
      ...config,
    };
  }

  assemble(params: PromptAssemblyParams): PromptAssemblyResult {
    const sections: Array<{ name: string; content: string; source?: string }> = [];

    if (params.basePrompt) {
      sections.push({
        name: 'base',
        content: params.basePrompt.trim(),
        source: 'assistant.system_prompt',
      });
    }

    if (params.identity) {
      sections.push({
        name: 'identity',
        content: this.formatIdentity(params.identity),
        source: params.identity.source ?? 'identity-store',
      });
    }

    if (params.memoryEntries && params.memoryEntries.length > 0) {
      sections.push({
        name: 'memory',
        content: this.formatMemoryEntries(params.memoryEntries),
        source: 'memory-store',
      });
    }

    if (params.memoryFacts && params.memoryFacts.length > 0) {
      sections.push({
        name: 'memory_facts',
        content: this.formatMemoryFacts(params.memoryFacts),
        source: 'memory-store',
      });
    }

    if (this.config.includeSessionState && params.sessionState) {
      sections.push({
        name: 'session_state',
        content: this.formatSessionState(params.sessionState),
        source: 'session-state-store',
      });
    }

    const prompt = sections
      .map((section) => section.content)
      .join('\n\n')
      .trim();
    const report = this.buildReport(sections);

    return { prompt, report };
  }

  private formatIdentity(identity: IdentityProfile): string {
    const lines = [
      'Identity Profile:',
      `Soul: ${identity.soul}`,
      `Identity: ${identity.identity}`,
      `User Profile: ${identity.userProfile}`,
    ];

    if (identity.toolsNotes) {
      lines.push(`Tools Notes: ${identity.toolsNotes}`);
    }

    return lines.join('\n');
  }

  private formatMemoryEntries(entries: MemoryEntry[]): string {
    const limited = entries.slice(0, this.config.maxMemoryEntries);
    const lines = ['Memory Entries:'];
    for (const entry of limited) {
      const tags = entry.tags && entry.tags.length > 0 ? ` (${entry.tags.join(', ')})` : '';
      lines.push(`- [${entry.kind}] ${entry.content}${tags}`);
    }
    return lines.join('\n');
  }

  private formatMemoryFacts(facts: MemoryFact[]): string {
    const limited = facts.slice(0, this.config.maxMemoryFacts);
    const lines = ['Memory Facts:'];
    for (const fact of limited) {
      lines.push(`- ${fact.subject} ${fact.predicate} ${fact.object}`);
    }
    return lines.join('\n');
  }

  private formatSessionState(record: SessionStateRecord): string {
    const state = JSON.stringify(record.state, null, 2);
    return `Session State:\n${state}`;
  }

  private buildReport(
    sections: Array<{ name: string; content: string; source?: string }>
  ): PromptReport {
    const sectionReports: PromptSectionReport[] = sections.map((section) => {
      const sizeChars = section.content.length;
      const sizeTokens = this.config.includeTokenEstimates
        ? this.estimator.estimate(section.content)
        : undefined;

      return {
        name: section.name,
        sizeChars,
        sizeTokens,
        hash: this.hash(section.content),
        source: section.source,
      };
    });

    const totalChars = sectionReports.reduce((sum, s) => sum + s.sizeChars, 0);
    const totalTokens = this.config.includeTokenEstimates
      ? sectionReports.reduce((sum, s) => sum + (s.sizeTokens ?? 0), 0)
      : undefined;

    return {
      totalChars,
      totalTokens,
      sections: sectionReports,
      generatedAt: new Date().toISOString(),
    };
  }

  private hash(content: string): string {
    const algorithm = this.config.hashAlgorithm ?? 'sha256';
    return createHash(algorithm).update(content).digest('hex');
  }
}
