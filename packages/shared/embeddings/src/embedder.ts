/**
 * Text embedding using Transformers.js (local, no API needed)
 */

import { pipeline, env } from '@xenova/transformers';

export interface EmbedderConfig {
  /**
   * Model to use for embeddings
   * @default 'Xenova/all-MiniLM-L6-v2'
   */
  model?: string;

  /**
   * Cache directory for downloaded models
   * @default '.cache/transformers'
   */
  cacheDir?: string;

  /**
   * Enable progress logging during model download
   * @default false
   */
  progressLogging?: boolean;
}

/**
 * Text embedder using local transformer models
 * 
 * @example
 * ```typescript
 * const embedder = new Embedder();
 * await embedder.init();
 * 
 * const vector = await embedder.embed('Hello world');
 * console.log(vector); // [0.23, -0.15, 0.87, ...] (384 dimensions)
 * 
 * const batch = await embedder.embedBatch(['Text 1', 'Text 2', 'Text 3']);
 * console.log(batch.length); // 3
 * ```
 */
export class Embedder {
  private pipeline: any = null;
  private config: Required<EmbedderConfig>;
  private initialized = false;

  constructor(config: EmbedderConfig = {}) {
    this.config = {
      model: config.model ?? 'Xenova/all-MiniLM-L6-v2',
      cacheDir: config.cacheDir ?? '.cache/transformers',
      progressLogging: config.progressLogging ?? false,
    };

    // Configure Transformers.js
    env.cacheDir = this.config.cacheDir;
    env.allowLocalModels = false; // Use remote models
  }

  /**
   * Initialize the embedder (downloads model on first run)
   * Call this before using embed() or embedBatch()
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.config.progressLogging) {
      console.log(`[Embedder] Loading model: ${this.config.model}`);
      console.log(`[Embedder] Cache dir: ${this.config.cacheDir}`);
    }

    this.pipeline = await pipeline('feature-extraction', this.config.model);
    this.initialized = true;

    if (this.config.progressLogging) {
      console.log('[Embedder] Model loaded successfully');
    }
  }

  /**
   * Generate embedding vector for a single text
   * 
   * @throws Error if not initialized (call init() first)
   */
  async embed(text: string): Promise<number[]> {
    if (!this.initialized || !this.pipeline) {
      throw new Error('Embedder not initialized. Call init() first.');
    }

    const output = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data);
  }

  /**
   * Generate embeddings for multiple texts in batch
   * More efficient than calling embed() multiple times
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.initialized || !this.pipeline) {
      throw new Error('Embedder not initialized. Call init() first.');
    }

    const embeddings: number[][] = [];

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 32;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      for (const text of batch) {
        const output = await this.pipeline(text, {
          pooling: 'mean',
          normalize: true,
        });
        embeddings.push(Array.from(output.data));
      }
    }

    return embeddings;
  }

  /**
   * Get the dimension of the embedding vectors
   * Returns null if not initialized
   */
  async getDimension(): Promise<number | null> {
    if (!this.initialized) {
      return null;
    }

    const testVector = await this.embed('test');
    return testVector.length;
  }

  /**
   * Check if the embedder is ready to use
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<EmbedderConfig>> {
    return { ...this.config };
  }
}

/**
 * Create a singleton embedder instance (shared across application)
 * Useful to avoid loading the model multiple times
 */
let globalEmbedder: Embedder | null = null;

export function getGlobalEmbedder(config?: EmbedderConfig): Embedder {
  if (!globalEmbedder) {
    globalEmbedder = new Embedder(config);
  }
  return globalEmbedder;
}

/**
 * Reset the global embedder (useful for testing)
 */
export function resetGlobalEmbedder(): void {
  globalEmbedder = null;
}
