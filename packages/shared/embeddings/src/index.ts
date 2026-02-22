/**
 * @nachos/embeddings - Vector embeddings and semantic search
 * 
 * Standalone package for text embeddings and vector similarity search.
 * Uses Transformers.js for local embedding generation (no API needed).
 * 
 * @example
 * ```typescript
 * import { SemanticSearch } from '@nachos/embeddings';
 * 
 * const search = new SemanticSearch();
 * await search.init();
 * 
 * await search.addDocument({
 *   id: 'doc1',
 *   text: 'User loves breakfast tacos',
 * });
 * 
 * const results = await search.search('morning food preferences');
 * console.log(results); // Finds "breakfast tacos"
 * ```
 */

// High-level API
export { SemanticSearch, type SemanticSearchConfig, type Document } from './semantic-search.js';

// Low-level building blocks
export { Embedder, getGlobalEmbedder, resetGlobalEmbedder, type EmbedderConfig } from './embedder.js';

export {
  VectorStore,
  cosineSimilarity,
  normalizeVector,
  type VectorStoreConfig,
  type VectorEntry,
  type SearchResult,
} from './vector-store.js';
