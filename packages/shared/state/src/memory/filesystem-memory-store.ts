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
import { SemanticSearch } from '@nachos/embeddings';

export interface FilesystemMemoryStoreConfig {
  baseDir: string;
  enableSemantic?: boolean;
  semanticModel?: string;
  semanticCacheDir?: string;
}

export class FilesystemMemoryStore implements MemoryStore {
  private semanticSearch?: SemanticSearch<MemoryEntry>;
  private semanticEnabled: boolean;
  private initPromise?: Promise<void>;

  constructor(config: string | FilesystemMemoryStoreConfig) {
    if (typeof config === 'string') {
      this.baseDir = config;
      this.semanticEnabled = false;
    } else {
      this.baseDir = config.baseDir;
      this.semanticEnabled = config.enableSemantic ?? false;

      if (this.semanticEnabled) {
        this.semanticSearch = new SemanticSearch<MemoryEntry>({
          model: config.semanticModel,
          cacheDir: config.semanticCacheDir,
          minSimilarity: 0.7,
        });
      }
    }
  }

  private baseDir: string;

  /**
   * Initialize semantic search if enabled
   * Must be called before using semantic search features
   */
  async init(): Promise<void> {
    if (!this.initPromise && this.semanticEnabled && this.semanticSearch) {
      this.initPromise = (async () => {
        await this.semanticSearch!.init();

        // Index existing entries
        // Note: This could be slow for large datasets, consider lazy indexing
        const agentDirs = await this.listAgentDirs();
        for (const agentId of agentDirs) {
          const entries = await this.readEntries(agentId);
          for (const entry of entries) {
            await this.semanticSearch!.addDocument({
              id: entry.id,
              text: entry.content,
              metadata: entry,
            });
          }
        }
      })();
    }
    return this.initPromise;
  }

  async appendEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    await this.ensureDir(entry.agentId);
    await fs.appendFile(this.entriesPath(entry.agentId), `${JSON.stringify(entry)}\n`, 'utf-8');

    // Add to semantic index if enabled
    if (this.semanticEnabled && this.semanticSearch?.isInitialized()) {
      await this.semanticSearch.addDocument({
        id: entry.id,
        text: entry.content,
        metadata: entry,
      });
    }

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
    // Use semantic search if enabled and requested
    if (query.semantic && query.text && this.semanticEnabled && this.semanticSearch?.isInitialized()) {
      return this.querySemantic(query);
    }

    // Standard text-based search
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

  private async querySemantic(query: MemoryQuery): Promise<MemoryQueryResult> {
    if (!this.semanticSearch || !query.text) {
      return { entries: [], facts: [] };
    }

    const results = await this.semanticSearch.search(query.text, {
      limit: query.limit ?? 10,
      minSimilarity: query.minSimilarity ?? 0.7,
      filter: (metadata) => {
        if (!metadata) return false;

        // Filter by agentId
        if (metadata.agentId !== query.agentId) return false;

        // Filter by kinds
        if (query.kinds && !query.kinds.includes(metadata.kind)) return false;

        // Filter by tags
        if (query.tags && metadata.tags) {
          if (!query.tags.some((tag) => metadata.tags?.includes(tag))) {
            return false;
          }
        }

        return true;
      },
    });

    // Add similarity scores as confidence
    const entries = results.map((result) => ({
      ...result.metadata!,
      confidence: result.similarity,
    }));

    // Note: semantic search doesn't search facts (yet)
    return {
      entries,
      facts: [],
    };
  }

  async deleteEntry(id: string, agentId: string): Promise<void> {
    const entries = await this.readEntries(agentId);
    const remaining = entries.filter((entry) => entry.id !== id);
    await fs.writeFile(this.entriesPath(agentId), this.serializeJsonl(remaining), 'utf-8');

    // Remove from semantic index if enabled
    if (this.semanticEnabled && this.semanticSearch?.isInitialized()) {
      this.semanticSearch.remove(id);
    }
  }

  private async ensureDir(agentId: string): Promise<void> {
    await fs.mkdir(path.join(this.baseDir, agentId), { recursive: true });
  }

  private async listAgentDirs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
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
}
