/**
 * In-memory vector store with semantic search
 */

export interface VectorStoreConfig {
  /**
   * Minimum similarity score (0-1) for search results
   * @default 0.7
   */
  minSimilarity?: number;

  /**
   * Maximum results to return
   * @default 10
   */
  defaultLimit?: number;

  /**
   * Enable caching of embeddings
   * @default true
   */
  cacheEmbeddings?: boolean;
}

export interface VectorEntry<T = unknown> {
  id: string;
  vector: number[];
  metadata?: T;
}

export interface SearchResult<T = unknown> {
  id: string;
  similarity: number;
  metadata?: T;
}

/**
 * In-memory vector store for semantic search
 * 
 * @example
 * ```typescript
 * const store = new VectorStore();
 * 
 * // Add vectors
 * await store.add('doc1', embedding1, { content: 'Hello world' });
 * await store.add('doc2', embedding2, { content: 'Goodbye world' });
 * 
 * // Semantic search
 * const results = await store.search(queryEmbedding, { limit: 5 });
 * console.log(results); // [{ id: 'doc1', similarity: 0.95, metadata: {...} }]
 * ```
 */
export class VectorStore<T = unknown> {
  private vectors = new Map<string, VectorEntry<T>>();
  private config: Required<VectorStoreConfig>;

  constructor(config: VectorStoreConfig = {}) {
    this.config = {
      minSimilarity: config.minSimilarity ?? 0.7,
      defaultLimit: config.defaultLimit ?? 10,
      cacheEmbeddings: config.cacheEmbeddings ?? true,
    };
  }

  /**
   * Add a vector to the store
   */
  add(id: string, vector: number[], metadata?: T): void {
    this.vectors.set(id, { id, vector, metadata });
  }

  /**
   * Add multiple vectors in batch
   */
  addBatch(entries: Array<{ id: string; vector: number[]; metadata?: T }>): void {
    for (const entry of entries) {
      this.add(entry.id, entry.vector, entry.metadata);
    }
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  search(
    queryVector: number[],
    options?: {
      limit?: number;
      minSimilarity?: number;
      filter?: (metadata?: T) => boolean;
    }
  ): SearchResult<T>[] {
    const results: SearchResult<T>[] = [];
    const minSim = options?.minSimilarity ?? this.config.minSimilarity;
    const limit = options?.limit ?? this.config.defaultLimit;

    for (const entry of this.vectors.values()) {
      // Apply filter if provided
      if (options?.filter && !options.filter(entry.metadata)) {
        continue;
      }

      const similarity = cosineSimilarity(queryVector, entry.vector);

      if (similarity >= minSim) {
        results.push({
          id: entry.id,
          similarity,
          metadata: entry.metadata,
        });
      }
    }

    // Sort by similarity (descending)
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /**
   * Get a vector by ID
   */
  get(id: string): VectorEntry<T> | undefined {
    return this.vectors.get(id);
  }

  /**
   * Remove a vector by ID
   */
  remove(id: string): boolean {
    return this.vectors.delete(id);
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors.clear();
  }

  /**
   * Get number of vectors in store
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Get all vector IDs
   */
  keys(): string[] {
    return Array.from(this.vectors.keys());
  }

  /**
   * Export all vectors (for persistence)
   */
  export(): VectorEntry<T>[] {
    return Array.from(this.vectors.values());
  }

  /**
   * Import vectors (from persistence)
   */
  import(entries: VectorEntry<T>[]): void {
    for (const entry of entries) {
      this.vectors.set(entry.id, entry);
    }
  }
}

/**
 * Calculate cosine similarity between two vectors
 * Returns a value between -1 and 1, where 1 means identical direction
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    magnitudeA += aVal * aVal;
    magnitudeB += bVal * bVal;
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Normalize a vector to unit length
 * Useful for storing vectors in a normalized form
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

  if (magnitude === 0) {
    return vector.slice(); // Return copy
  }

  return vector.map((val) => val / magnitude);
}
