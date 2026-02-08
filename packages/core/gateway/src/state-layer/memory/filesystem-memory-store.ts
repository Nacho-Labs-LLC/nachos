/**
 * Filesystem MemoryStore implementation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MemoryEntry,
  MemoryFact,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
} from '@nachos/types';

export class FilesystemMemoryStore implements MemoryStore {
  constructor(private baseDir: string) {}

  async appendEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    await this.ensureDir(entry.agentId);
    await fs.appendFile(this.entriesPath(entry.agentId), `${JSON.stringify(entry)}\n`, 'utf-8');
    return entry;
  }

  async appendFacts(facts: MemoryFact[]): Promise<MemoryFact[]> {
    const [first] = facts;
    if (!first) return facts;
    await this.ensureDir(first.agentId);
    const lines = facts.map((fact) => JSON.stringify(fact)).join('\n') + '\n';
    await fs.appendFile(this.factsPath(first.agentId), lines, 'utf-8');
    return facts;
  }

  async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    const entries = await this.readEntries(query.agentId);
    let filtered = entries;

    if (query.kinds && query.kinds.length > 0) {
      filtered = filtered.filter((entry) => query.kinds?.includes(entry.kind));
    }

    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter((entry) =>
        entry.tags ? query.tags?.some((tag) => entry.tags?.includes(tag)) : false
      );
    }

    if (query.text) {
      const text = query.text.toLowerCase();
      filtered = filtered.filter((entry) => entry.content.toLowerCase().includes(text));
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? filtered.length;
    const entriesPage = filtered.slice(offset, offset + limit);

    const includeFacts = !query.kinds || query.kinds.includes('fact');
    const facts = includeFacts ? await this.readFacts(query.agentId, query.text) : undefined;

    return {
      entries: entriesPage,
      facts,
    };
  }

  async deleteEntry(id: string): Promise<void> {
    const agentId = await this.findAgentForEntry(id);
    if (!agentId) return;

    const entries = await this.readEntries(agentId);
    const remaining = entries.filter((entry) => entry.id !== id);
    await fs.writeFile(this.entriesPath(agentId), this.serializeJsonl(remaining), 'utf-8');
  }

  private async ensureDir(agentId: string): Promise<void> {
    await fs.mkdir(path.join(this.baseDir, agentId), { recursive: true });
  }

  private entriesPath(agentId: string): string {
    return path.join(this.baseDir, agentId, 'entries.jsonl');
  }

  private factsPath(agentId: string): string {
    return path.join(this.baseDir, agentId, 'facts.jsonl');
  }

  private async readEntries(agentId: string): Promise<MemoryEntry[]> {
    return this.readJsonl<MemoryEntry>(this.entriesPath(agentId));
  }

  private async readFacts(agentId: string, text?: string): Promise<MemoryFact[]> {
    const facts = await this.readJsonl<MemoryFact>(this.factsPath(agentId));
    if (!text) return facts;
    const lower = text.toLowerCase();
    return facts.filter((fact) =>
      `${fact.subject} ${fact.predicate} ${fact.object}`.toLowerCase().includes(lower)
    );
  }

  private async readJsonl<T>(filePath: string): Promise<T[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as T);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private serializeJsonl<T>(items: T[]): string {
    if (items.length === 0) return '';
    return items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  }

  private async findAgentForEntry(entryId: string): Promise<string | null> {
    try {
      const agents = await fs.readdir(this.baseDir, { withFileTypes: true });
      for (const agent of agents) {
        if (!agent.isDirectory()) continue;
        const entries = await this.readEntries(agent.name);
        if (entries.some((entry) => entry.id === entryId)) {
          return agent.name;
        }
      }
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
