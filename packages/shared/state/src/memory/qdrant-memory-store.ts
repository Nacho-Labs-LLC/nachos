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
import { createLogger, createInternalError, createValidationError } from '@nachos/types';

const logger = createLogger('qdrant-memory-store');

// Lazy import to avoid crashing on platforms without glibc (e.g., Alpine)
type EmbedderType = import('@nacho-labs/nachos-embeddings').Embedder;

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
  content: string;
}

type QdrantPayload = QdrantEntryPayload | QdrantFactPayload;

function isFactPayload(payload: QdrantPayload): payload is QdrantFactPayload {
  return payload.kind === 'fact';
}

function isEntryPayload(payload: QdrantPayload): payload is QdrantEntryPayload {
  return payload.kind !== 'fact';
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

export interface QdrantConfig {
  url: string;
  collection: string;
  apiKey?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingCacheDir?: string;
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
  private embeddingDimensions: number;
  private embedder: EmbedderType | null = null;
  private embedderFailed = false;
  private embeddingModel?: string;
  private embeddingCacheDir?: string;

  constructor(config: QdrantConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.collection = config.collection;
    this.apiKey = config.apiKey;
    this.embeddingDimensions = config.embeddingDimensions ?? 384;
    this.embeddingModel = config.embeddingModel;
    this.embeddingCacheDir = config.embeddingCacheDir;
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
   * Lazily initialize the embedder from @nacho-labs/nachos-embeddings.
   * Falls back to zero vectors if the library is unavailable (e.g., Alpine/glibc).
   */
  private async initEmbedder(): Promise<void> {
    if (this.embedder || this.embedderFailed) return;

    try {
      const { Embedder } = await import('@nacho-labs/nachos-embeddings');
      this.embedder = new Embedder({
        model: this.embeddingModel,
        cacheDir: this.embeddingCacheDir,
      });
      await this.embedder.init();

      const detectedDimension = await this.embedder.getDimension();
      if (detectedDimension) {
        this.embeddingDimensions = detectedDimension;
      }

      logger.info(
        { dimensions: this.embeddingDimensions },
        'Embedder initialized for Qdrant store'
      );
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Embedder initialization failed, falling back to zero vectors'
      );
      this.embedderFailed = true;
    }
  }

  /**
   * Initialize Qdrant collection
   */
  private async initCollection(): Promise<void> {
    // Initialize embedder first to auto-detect correct dimensions
    await this.initEmbedder();

    try {
      const checkResponse = await this.request(`/collections/${this.collection}`, 'GET');

      if (checkResponse.status === 404) {
        await this.request('/collections', 'PUT', {
          name: this.collection,
          vectors: {
            size: this.embeddingDimensions,
            distance: 'Cosine',
          },
        });

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
      logger.error(
        { error, collection: this.collection },
        'Failed to initialize Qdrant collection'
      );
      throw error;
    }
  }

  /**
   * Make HTTP request to Qdrant API
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

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw createInternalError(
        `Qdrant API error: ${response.status} ${response.statusText} - ${errorText}`,
        { component: 'qdrant-memory-store' }
      );
    }

    const data = await response.json();

    return {
      status: response.status,
      data,
    };
  }

  /**
   * Generate embedding for text using nachos-embeddings.
   * Falls back to zero vectors if embedder is unavailable.
   */
  private async embed(text: string): Promise<number[]> {
    if (this.embedder?.isInitialized()) {
      return this.embedder.embed(text);
    }
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
   * Append memory facts
   */
  async appendFacts(facts: MemoryFact[]): Promise<MemoryFact[]> {
    await this.ensureCollection();

    if (facts.length === 0) return facts;

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

        const entryResults = results.filter((r) => r.payload.kind !== 'fact');
        const factResults = results.filter((r) => r.payload.kind === 'fact');

        entries = entryResults.map((r) => {
          if (!isEntryPayload(r.payload)) {
            throw createValidationError(`Expected entry payload but got ${r.payload.kind}`, {
              component: 'qdrant-memory-store',
            });
          }
          return {
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
          };
        });

        if (factResults.length > 0) {
          facts = factResults.map((r) => {
            if (!isFactPayload(r.payload)) {
              throw createValidationError(`Expected fact payload but got ${r.payload.kind}`, {
                component: 'qdrant-memory-store',
              });
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

        entries = entryPoints.map((p) => {
          if (!isEntryPayload(p.payload)) {
            throw createValidationError(`Expected entry payload but got ${p.payload.kind}`, {
              component: 'qdrant-memory-store',
            });
          }
          return {
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
          };
        });

        if (factPoints.length > 0) {
          facts = factPoints.map((p) => {
            if (!isFactPayload(p.payload)) {
              throw createValidationError(`Expected fact payload but got ${p.payload.kind}`, {
                component: 'qdrant-memory-store',
              });
            }
            return {
              id: p.id,
              agentId: p.payload.agent_id,
              subject: p.payload.subject,
              predicate: p.payload.predicate,
              object: p.payload.object,
              confidence: p.payload.confidence,
              sourceEntryId: p.payload.source_entry_id,
              createdAt: p.payload.created_at,
            };
          });
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
   * Query facts by agentId and optional subject filter.
   * Used for deduplication before inserting new extracted facts.
   */
  async queryFacts(agentId: string, subject?: string): Promise<MemoryFact[]> {
    await this.ensureCollection();

    const mustClauses: unknown[] = [
      { key: 'agent_id', match: { value: agentId } },
      { key: 'kind', match: { value: 'fact' } },
    ];

    if (subject) {
      mustClauses.push({ key: 'subject', match: { value: subject.toLowerCase() } });
    }

    const response = await this.request(`/collections/${this.collection}/points/scroll`, 'POST', {
      filter: { must: mustClauses },
      limit: 1000,
      with_payload: true,
    });

    if (!response.data || typeof response.data !== 'object' || !('result' in response.data)) {
      return [];
    }

    const data = response.data as { result: { points: QdrantPoint[] } };
    const points = data.result.points;

    return points
      .filter((p) => isFactPayload(p.payload))
      .map((p) => {
        const payload = p.payload as QdrantFactPayload;
        return {
          id: p.id,
          agentId: payload.agent_id,
          subject: payload.subject,
          predicate: payload.predicate,
          object: payload.object,
          confidence: payload.confidence,
          sourceEntryId: payload.source_entry_id,
          createdAt: payload.created_at,
        };
      });
  }

  /**
   * Update an existing fact (used for dedup — bumps confidence and merges properties).
   * Qdrant does not support partial payload updates that preserve other fields,
   * so we retrieve the current point, merge, then upsert.
   */
  async updateFact(fact: MemoryFact): Promise<MemoryFact | null> {
    await this.ensureCollection();

    // Fetch the existing point by ID
    const getResponse = await this.request(
      `/collections/${this.collection}/points/${fact.id}`,
      'GET'
    );

    if (!getResponse.data || typeof getResponse.data !== 'object' || !('result' in getResponse.data)) {
      return null;
    }

    const data = getResponse.data as { result: QdrantPoint | null };
    if (!data.result) return null;

    const existing = data.result;
    const text = `${fact.subject} ${fact.predicate} ${fact.object}`;
    const vector = await this.embed(text);

    const updatedPayload: QdrantFactPayload = {
      agent_id: fact.agentId,
      kind: 'fact',
      content: text,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      confidence: fact.confidence,
      source_entry_id: fact.sourceEntryId,
      created_at: (existing.payload as QdrantFactPayload).created_at,
    };

    await this.request(`/collections/${this.collection}/points`, 'PUT', {
      points: [{ id: fact.id, vector, payload: updatedPayload }],
    });

    return fact;
  }

  /**
   * Close connections (no-op for HTTP-based Qdrant client)
   */
  async close(): Promise<void> {
    logger.info('Qdrant memory store closed');
  }
}
