/**
 * Prompt assembler with safe reporting (hashes, sizes).
 */

import { createHash } from 'node:crypto';
import { TokenEstimator } from '@nachos/context-manager';
import type {
  IdentityProfile,
  BootstrapProfile,
  MemoryEntry,
  MemoryFact,
  PromptAssemblyResult,
  PromptReport,
  PromptSectionReport,
  SessionStateRecord,
  UserProfile,
} from '@nachos/types';
import type { PromptAssemblyConfig } from '../types.js';

export interface PromptAssemblyParams {
  basePrompt: string;
  bootstrap?: BootstrapProfile | null;
  identity?: IdentityProfile | null;
  userProfile?: UserProfile | null;
  memoryEntries?: MemoryEntry[];
  memoryFacts?: MemoryFact[];
  sessionState?: SessionStateRecord | null;
  skills?: string | null; // Formatted skills documentation
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

    if (params.bootstrap) {
      const bootstrapContent = this.formatBootstrap(params.bootstrap);
      if (bootstrapContent) {
        sections.push({
          name: 'bootstrap',
          content: bootstrapContent,
          source: params.bootstrap.source ?? 'bootstrap-store',
        });
      }
    }

    if (params.identity) {
      const identityContent = this.formatIdentity(params.identity);
      if (identityContent) {
        sections.push({
          name: 'identity',
          content: identityContent,
          source: params.identity.source ?? 'identity-store',
        });
      }
    }

    if (params.userProfile) {
      sections.push({
        name: 'user_profile',
        content: this.formatUserProfile(params.userProfile),
        source: params.userProfile.source ?? 'user-profile-store',
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

    if (params.skills) {
      sections.push({
        name: 'skills',
        content: params.skills,
        source: 'skill-loader',
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
    const soul = identity.soul?.trim();
    const name = identity.identity?.trim();
    const userProfile = identity.userProfile?.trim();
    const toolsNotes = identity.toolsNotes?.trim();

    if (!soul && !name && !userProfile && !toolsNotes) {
      return '';
    }

    const lines = ['Identity Profile:'];
    if (soul) {
      lines.push(`Soul: ${soul}`);
    }
    if (name) {
      lines.push(`Identity: ${name}`);
    }
    if (userProfile) {
      lines.push(`User Profile: ${userProfile}`);
    }
    if (toolsNotes) {
      lines.push(`Tools Notes: ${toolsNotes}`);
    }

    return lines.join('\n');
  }

  private formatBootstrap(profile: BootstrapProfile): string {
    const content = profile.content ?? {};
    const orderedKeys = ['agents', 'soul', 'tools', 'identity', 'user', 'bootstrap'];
    const remaining = Object.keys(content)
      .filter((key) => !orderedKeys.includes(key))
      .sort((a, b) => a.localeCompare(b));
    const keys = [...orderedKeys, ...remaining];

    const blocks: string[] = [];
    for (const key of keys) {
      const value = content[key];
      if (!value || value.trim().length === 0) {
        continue;
      }
      blocks.push(`[${key.toUpperCase()}]\n${value.trim()}`);
    }

    if (blocks.length === 0) {
      return '';
    }

    return ['Bootstrap Blocks:', ...blocks].join('\n\n');
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

  private formatUserProfile(profile: UserProfile): string {
    return ['User Profile:', profile.profile.trim()].join('\n');
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
