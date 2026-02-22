# @nachos/embeddings

Vector embeddings and semantic search for Nachos. Runs entirely locally using [Transformers.js](https://huggingface.co/docs/transformers.js) — no API keys or external services needed.

## Features

- ✅ **Local embeddings** - No API calls, no costs, no rate limits
- ✅ **Semantic search** - Find similar text even with different wording
- ✅ **Privacy-first** - Data never leaves your machine
- ✅ **Lightweight** - ~25MB model download, then runs offline
- ✅ **Fast** - In-memory vector index with cosine similarity
- ✅ **Reusable** - Standalone package, use anywhere

## Installation

```bash
pnpm add @nachos/embeddings
```

## Quick Start

### Simple Semantic Search

```typescript
import { SemanticSearch } from '@nachos/embeddings';

// Create search engine
const search = new SemanticSearch();
await search.init(); // Downloads model on first run (~25MB)

// Add documents
await search.addDocument({
  id: 'pref-1',
  text: 'User loves breakfast tacos',
  metadata: { kind: 'preference' },
});

await search.addDocument({
  id: 'pref-2',
  text: 'User dislikes mushrooms',
  metadata: { kind: 'preference' },
});

// Semantic search
const results = await search.search('What does user like for morning meals?');

console.log(results);
// [
//   {
//     id: 'pref-1',
//     similarity: 0.87,
//     text: 'User loves breakfast tacos',
//     metadata: { kind: 'preference' }
//   }
// ]
```

### Low-Level API

For more control, use `Embedder` and `VectorStore` directly:

```typescript
import { Embedder, VectorStore } from '@nachos/embeddings';

// Initialize embedder
const embedder = new Embedder();
await embedder.init();

// Generate embeddings
const vec1 = await embedder.embed('Hello world');
const vec2 = await embedder.embed('Hi there');

console.log(vec1.length); // 384 (vector dimension)

// Store vectors
const store = new VectorStore();
store.add('doc1', vec1, { content: 'Hello world' });
store.add('doc2', vec2, { content: 'Hi there' });

// Search
const queryVec = await embedder.embed('Greetings');
const results = store.search(queryVec, { limit: 5 });

console.log(results);
// [
//   { id: 'doc2', similarity: 0.92, metadata: { content: 'Hi there' } },
//   { id: 'doc1', similarity: 0.89, metadata: { content: 'Hello world' } }
// ]
```

## Configuration

### Model Selection

Default: `Xenova/all-MiniLM-L6-v2` (fast, 384 dimensions)

```typescript
const search = new SemanticSearch({
  model: 'Xenova/all-MiniLM-L6-v2',  // Default
  // model: 'Xenova/all-mpnet-base-v2',  // Higher quality, slower
  cacheDir: '.cache/transformers',
  progressLogging: true,
});
```

### Similarity Threshold

```typescript
const search = new SemanticSearch({
  minSimilarity: 0.7,  // Default (range: 0-1)
});

// Or override per search
const results = await search.search('query', {
  minSimilarity: 0.8,
  limit: 10,
});
```

### Filtering

```typescript
const results = await search.search('query', {
  filter: (metadata) => metadata?.kind === 'preference',
});
```

## Persistence

Export and import for saving to disk:

```typescript
// Export
const data = search.export();
await fs.writeFile('embeddings.json', JSON.stringify(data));

// Import
const data = JSON.parse(await fs.readFile('embeddings.json', 'utf-8'));
search.import(data);
```

## Use Cases

### Memory Search (Nachos)

```typescript
// Add user memories
await search.addDocument({
  id: 'mem-1',
  text: 'User prefers dark mode',
  metadata: { kind: 'preference', timestamp: '2026-02-22' },
});

// Search semantically
const prefs = await search.search('interface theme settings');
// Finds "User prefers dark mode"
```

### Document Similarity

```typescript
const docs = [
  { id: '1', text: 'The quick brown fox jumps over the lazy dog' },
  { id: '2', text: 'A fast brown canine leaps above a sleepy hound' },
  { id: '3', text: 'Quantum mechanics is fascinating' },
];

await search.addDocuments(docs);

const similar = await search.search('agile fox jumping');
// Finds doc 1 and 2 (semantically similar), not doc 3
```

### FAQ Matching

```typescript
const faqs = [
  { id: 'q1', text: 'How do I reset my password?' },
  { id: 'q2', text: 'What are your business hours?' },
  { id: 'q3', text: 'How can I contact support?' },
];

await search.addDocuments(faqs);

const match = await search.search('forgot password help');
// Finds "How do I reset my password?"
```

## Performance

| Operation | Time (approx) |
|-----------|---------------|
| Model init (first time) | ~2-5 seconds |
| Model init (cached) | ~500ms |
| Embed single text | ~10-50ms |
| Embed batch (100 texts) | ~500ms-2s |
| Search 1000 vectors | ~5-10ms |

**Memory:**
- Model: ~100MB (loaded once, reused)
- Each vector: ~1.5KB (384 floats)
- 1000 documents: ~1.5MB vectors + original text

## Comparison to Alternatives

| Feature | @nachos/embeddings | OpenAI | Pinecone |
|---------|-------------------|--------|----------|
| Cost | Free | ~$0.0001/1k chars | ~$70/month |
| Setup | `pnpm add` | API key | Account + API |
| Privacy | 100% local | Cloud | Cloud |
| Speed (after init) | Fast | Network latency | Network latency |
| Quality | Good (85-90%) | Excellent (95%) | N/A (database) |
| Offline | Yes | No | No |

## Advanced Usage

### Custom Vector Operations

```typescript
import { cosineSimilarity, normalizeVector } from '@nachos/embeddings';

const vec1 = [0.5, 0.3, 0.8];
const vec2 = [0.6, 0.4, 0.7];

const similarity = cosineSimilarity(vec1, vec2);
console.log(similarity); // 0.987

const normalized = normalizeVector(vec1);
console.log(normalized); // Unit vector
```

### Batch Processing

```typescript
const texts = Array.from({ length: 1000 }, (_, i) => `Document ${i}`);

// Efficient batch embedding
const embeddings = await embedder.embedBatch(texts);

// Add to store
const docs = texts.map((text, i) => ({
  id: `doc-${i}`,
  vector: embeddings[i],
  metadata: { text },
}));

store.addBatch(docs);
```

### Global Singleton

```typescript
import { getGlobalEmbedder } from '@nachos/embeddings';

// Shared instance across your app
const embedder = getGlobalEmbedder();
await embedder.init(); // Only init once

// Use anywhere
const vec = await embedder.embed('text');
```

## Troubleshooting

### Model not downloading

Check your internet connection on first run. The model (~25MB) is cached at `.cache/transformers/` by default.

### Out of memory

Reduce batch size:

```typescript
const embedder = new Embedder();
await embedder.init();

// Process in smaller batches
for (let i = 0; i < texts.length; i += 100) {
  const batch = texts.slice(i, i + 100);
  const embeddings = await embedder.embedBatch(batch);
  // ... process
}
```

### Slow search

If you have >10K vectors, consider:
1. Use higher `minSimilarity` to filter results earlier
2. Filter by metadata before vector search
3. Upgrade to a dedicated vector database (Qdrant, Milvus)

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm typecheck

# Clean
pnpm clean
```

## License

MIT

## See Also

- [Transformers.js](https://huggingface.co/docs/transformers.js) - The underlying ML library
- [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) - Default model
- [Nachos](https://github.com/Nacho-Labs-LLC/nachos) - AI agent framework
