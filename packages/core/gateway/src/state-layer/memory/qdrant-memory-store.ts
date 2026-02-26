/**
 * Qdrant MemoryStore implementation for semantic search.
 * 
 * Provides vector-based semantic search with metadata filtering,
 * offering an alternative to local filesystem + Transformers.js embeddings.
 */

import type {
  MemoryEntry,
  MemoryFact,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
} from '@nachos/types';
import { createLogger } from '@nachos/types';

const logger = createLogger('qdrant-memory-store');

// Copilot fix #11: Define typed payloads to replace `as any` casts
interface QdrantEntryPayload {
  agent_id: string;
  kind: 'decision' | 'observation' | 'conversation' | 'tool_result';
  content: string;
  tags?: string[];
  confidence?: number;
  provenance?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  expires_at?: string;
}

interface QdrantFactPayload {
  agent_id: string;
  kind: 'fact';
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  source_entry_id?: string;
  created_at: string;
  content: string; // Required by base payload structure
}

type QdrantPayload = QdrantEntryPayload | QdrantFactPayload;

function isFactPayload(payload: QdrantPayload): payload is QdrantFactPayload {
  return payload.kind === 'fact';
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: QdrantPayload;
}

interface QdrantSearchResult {
  id: string;
  score: number;
  payload: QdrantPayload;
}

interface QdrantConfig {
  url: string;
  collection: string;
  apiKey?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
}

/**
 * Qdrant-based memory store with semantic search capabilities
 */
export class QdrantMemoryStore implements MemoryStore {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private url: string;
  private collection: string;
  private apiKey?: string;
  private embeddingModel: string;
  private embeddingDimensions: number;

  constructor(config: QdrantConfig) {
    this.url = config.url.replace(/\/$/, ''); // Remove trailing slash
    this.collection = config.collection;
    this.apiKey = config.apiKey;
    this.embeddingModel = config.embeddingModel ?? 'text-embedding-ada-002';
    this.embeddingDimensions = config.embeddingDimensions ?? 1536;
  }

  /**
   * Ensure collection exists with proper schema
   */
  private async ensureCollection(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.initCollection()
        .then(() => {
          this.initialized = true;
          this.initPromise = null;
        })
        .catch((err) => {
          this.initPromise = null;
          throw err;
        });
    }
    return this.initPromise;
  }

  /**
   * Initialize Qdrant collection
   */
  private async initCollection(): Promise<void> {
    try {
      // Check if collection exists
      const checkResponse = await this.request(`/collections/${this.collection}`, 'GET');
      
      if (checkResponse.status === 404) {
        // Create collection
        await this.request('/collections', 'PUT', {
          name: this.collection,
          vectors: {
            size: this.embeddingDimensions,
            distance: 'Cosine',
          },
        });

        // Create payload indexes for filtering
        await this.request(`/collections/${this.collection}/index`, 'PUT', {
          field_name: 'agent_id',
          field_schema: 'keyword',
        });

        await this.request(`/collections/${this.collection}/index`, 'PUT', {
          field_name: 'kind',
          field_schema: 'keyword',
        });

        logger.info({ collection: this.collection }, 'Created Qdrant collection');
      }
    } catch (error) {
      logger.error({ error, collection: this.collection }, 'Failed to initialize Qdrant collection');
      throw error;
    }
  }

  /**
   * Make HTTP request to Qdrant API
   * 
   * Copilot fix #10: Throw on non-2xx responses instead of returning success with status
   */
  private async request(
    path: string,
    method: string,
    body?: unknown
  ): Promise<{ status: number; data?: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }

    const response = await fetch(`${this.url}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Throw on non-2xx responses
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Qdrant API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    return {
      status: response.status,
      data,
    };
  }

  /**
   * Generate embedding for text (placeholder - requires external embedding service)
   */
  private async embed(text: string): Promise<number[]> {
    // TODO: Integrate with actual embedding service (OpenAI, Cohere, local model, etc.)
    // For now, return zero vector as placeholder
    logger.warn('Embedding generation not implemented, returning zero vector');
    return new Array(this.embeddingDimensions).fill(0);
  }

  /**
   * Append a memory entry
   */
  async appendEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    await this.ensureCollection();

    const vector = await this.embed(entry.content);

    await this.request(`/collections/${this.collection}/points`, 'PUT', {
      points: [
        {
          id: entry.id,
          vector,
          payload: {
            agent_id: entry.agentId,
            kind: entry.kind,
            content: entry.content,
            tags: entry.tags,
            confidence: entry.confidence,
            provenance: entry.provenance,
            created_at: entry.createdAt,
            updated_at: entry.updatedAt,
            expires_at: entry.expiresAt,
          },
        },
      ],
    });

    return entry;
  }

  /**
   * Append memory facts (stored as separate entries with kind='fact')
   */
  async appendFacts(facts: MemoryFact[]): Promise<MemoryFact[]> {
    await this.ensureCollection();

    if (facts.length === 0) return facts;

    // Convert facts to searchable text and create points
    const points = await Promise.all(
      facts.map(async (fact) => {
        const text = `${fact.subject} ${fact.predicate} ${fact.object}`;
        const vector = await this.embed(text);

        return {
          id: fact.id,
          vector,
          payload: {
            agent_id: fact.agentId,
            kind: 'fact',
            content: text,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            confidence: fact.confidence,
            source_entry_id: fact.sourceEntryId,
            created_at: fact.createdAt,
          },
        };
      })
    );

    await this.request(`/collections/${this.collection}/points`, 'PUT', {
      points,
    });

    return facts;
  }

  /**
   * Query memory with semantic search
   */
  async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    await this.ensureCollection();

    // Build filter conditions
    const filter: Record<string, unknown> = {
      must: [
        {
          key: 'agent_id',
          match: { value: query.agentId },
        },
      ],
    };

    if (query.kinds && query.kinds.length > 0) {
      (filter.must as Array<unknown>).push({
        key: 'kind',
        match: { any: query.kinds },
      });
    }

    // Perform semantic search if text query provided
    let entries: MemoryEntry[] = [];
    let facts: MemoryFact[] | undefined = undefined;

    if (query.text) {
      const queryVector = await this.embed(query.text);
      const limit = query.limit ?? 100;

      const response = await this.request(`/collections/${this.collection}/points/search`, 'POST', {
        vector: queryVector,
        filter,
        limit,
        with_payload: true,
        offset: query.offset ?? 0,
      });

      if (response.data && typeof response.data === 'object' && 'result' in response.data) {
        const results = response.data.result as QdrantSearchResult[];

        // Separate entries and facts
        const entryResults = results.filter((r) => r.payload.kind !== 'fact');
        const factResults = results.filter((r) => r.payload.kind === 'fact');

        entries = entryResults.map((r) => ({
          id: r.id,
          agentId: r.payload.agent_id,
          kind: r.payload.kind as MemoryEntry['kind'],
          content: r.payload.content,
          tags: r.payload.tags,
          confidence: r.payload.confidence,
          provenance: r.payload.provenance as MemoryEntry['provenance'],
          createdAt: r.payload.created_at,
          updatedAt: r.payload.updated_at,
          expiresAt: r.payload.expires_at,
        }));

        if (factResults.length > 0) {
          // Copilot fix #11: Use type guard instead of `as any`
          facts = factResults.map((r) => {
            if (!isFactPayload(r.payload)) {
              throw new Error(`Expected fact payload but got ${r.payload.kind}`);
            }
            return {
              id: r.id,
              agentId: r.payload.agent_id,
              subject: r.payload.subject,
              predicate: r.payload.predicate,
              object: r.payload.object,
              confidence: r.payload.confidence,
              sourceEntryId: r.payload.source_entry_id,
              createdAt: r.payload.created_at,
            };
          });
        }
      }
    } else {
      // Fallback to scroll/list if no semantic search
      const limit = query.limit ?? 100;
      const response = await this.request(`/collections/${this.collection}/points/scroll`, 'POST', {
        filter,
        limit,
        offset: query.offset ?? 0,
        with_payload: true,
      });

      if (response.data && typeof response.data === 'object' && 'result' in response.data) {
        const data = response.data as { result: { points: QdrantPoint[] } };
        const points = data.result.points;

        const entryPoints = points.filter((p) => p.payload.kind !== 'fact');
        const factPoints = points.filter((p) => p.payload.kind === 'fact');

        entries = entryPoints.map((p) => ({
          id: p.id,
          agentId: p.payload.agent_id,
          kind: p.payload.kind as MemoryEntry['kind'],
          content: p.payload.content,
          tags: p.payload.tags,
          confidence: p.payload.confidence,
          provenance: p.payload.provenance as MemoryEntry['provenance'],
          createdAt: p.payload.created_at,
          updatedAt: p.payload.updated_at,
          expiresAt: p.payload.expires_at,
        }));

        if (factPoints.length > 0) {
          facts = factPoints.map((p) => ({
            id: p.id,
            agentId: p.payload.agent_id,
            subject: (p.payload as any).subject,
            predicate: (p.payload as any).predicate,
            object: (p.payload as any).object,
            confidence: p.payload.confidence,
            sourceEntryId: (p.payload as any).source_entry_id,
            createdAt: p.payload.created_at,
          }));
        }
      }
    }

    return { entries, facts };
  }

  /**
   * Delete a memory entry
   */
  async deleteEntry(id: string, agentId: string): Promise<void> {
    await this.ensureCollection();

    await this.request(`/collections/${this.collection}/points/delete`, 'POST', {
      points: [id],
      filter: {
        must: [
          {
            key: 'agent_id',
            match: { value: agentId },
          },
        ],
      },
    });
  }

  /**
   * Close connections (no-op for HTTP-based Qdrant client)
   */
  async close(): Promise<void> {
    // HTTP client doesn't need cleanup
    logger.info('Qdrant memory store closed');
  }
}
