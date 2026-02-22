/**
 * High-level semantic search API combining embedder + vector store
 */

import { Embedder } from './embedder.js';
import { VectorStore, type SearchResult } from './vector-store.js';

export interface SemanticSearchConfig {
  /**
   * Embedding model to use
   * @default 'Xenova/all-MiniLM-L6-v2'
   */
  model?: string;

  /**
   * Minimum similarity score (0-1)
   * @default 0.7
   */
  minSimilarity?: number;

  /**
   * Cache directory for models
   * @default '.cache/transformers'
   */
  cacheDir?: string;

  /**
   * Enable progress logging
   * @default false
   */
  progressLogging?: boolean;
}

export interface Document<T = unknown> {
  id: string;
  text: string;
  metadata?: T;
}

/**
 * Semantic search engine with text-to-vector embedding
 * 
 * @example
 * ```typescript
 * const search = new SemanticSearch();
 * await search.init();
 * 
 * // Add documents
 * await search.addDocument({
 *   id: 'doc1',
 *   text: 'User loves breakfast tacos',
 *   metadata: { kind: 'preference' }
 * });
 * 
 * // Search semantically
 * const results = await search.search('What does user like for morning meals?');
 * // Finds "breakfast tacos" even though query doesn't say "breakfast"
 * ```
 */
export class SemanticSearch<T = unknown> {
  private embedder: Embedder;
  private vectorStore: VectorStore<T>;
  private documents = new Map<string, string>(); // id -> original text

  constructor(config: SemanticSearchConfig = {}) {
    this.embedder = new Embedder({
      model: config.model,
      cacheDir: config.cacheDir,
      progressLogging: config.progressLogging,
    });
    this.vectorStore = new VectorStore<T>({
      minSimilarity: config.minSimilarity,
    });
  }

  /**
   * Initialize the search engine (downloads model on first run)
   */
  async init(): Promise<void> {
    await this.embedder.init();
  }

  /**
   * Add a document to the search index
   */
  async addDocument(doc: Document<T>): Promise<void> {
    const vector = await this.embedder.embed(doc.text);
    this.vectorStore.add(doc.id, vector, doc.metadata);
    this.documents.set(doc.id, doc.text);
  }

  /**
   * Add multiple documents in batch (more efficient)
   */
  async addDocuments(docs: Document<T>[]): Promise<void> {
    const texts = docs.map((d) => d.text);
    const vectors = await this.embedder.embedBatch(texts);

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const vector = vectors[i];
      if (!doc || !vector) continue;
      this.vectorStore.add(doc.id, vector, doc.metadata);
      this.documents.set(doc.id, doc.text);
    }
  }

  /**
   * Semantic search for similar documents
   */
  async search(
    query: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
      filter?: (metadata?: T) => boolean;
    }
  ): Promise<Array<SearchResult<T> & { text: string }>> {
    const queryVector = await this.embedder.embed(query);
    const results = this.vectorStore.search(queryVector, options);

    // Add original text to results
    return results.map((result) => ({
      ...result,
      text: this.documents.get(result.id) ?? '',
    }));
  }

  /**
   * Remove a document by ID
   */
  remove(id: string): boolean {
    this.documents.delete(id);
    return this.vectorStore.remove(id);
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.vectorStore.clear();
    this.documents.clear();
  }

  /**
   * Get number of documents indexed
   */
  size(): number {
    return this.vectorStore.size();
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.embedder.isInitialized();
  }

  /**
   * Export all documents and vectors (for persistence)
   */
  export(): Array<{
    id: string;
    text: string;
    vector: number[];
    metadata?: T;
  }> {
    const vectors = this.vectorStore.export();
    return vectors.map((v) => ({
      id: v.id,
      text: this.documents.get(v.id) ?? '',
      vector: v.vector,
      metadata: v.metadata,
    }));
  }

  /**
   * Import documents and vectors (from persistence)
   */
  import(
    data: Array<{
      id: string;
      text: string;
      vector: number[];
      metadata?: T;
    }>
  ): void {
    for (const item of data) {
      this.vectorStore.add(item.id, item.vector, item.metadata);
      this.documents.set(item.id, item.text);
    }
  }
}
