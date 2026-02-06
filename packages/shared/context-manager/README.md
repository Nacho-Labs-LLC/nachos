# @nachos/context-manager

Context management system for NACHOS that enables indefinite AI assistant sessions through intelligent context handling.

## Features

- **Sliding Window**: Automatically drop oldest messages when approaching context limits
- **Multi-Tier Summarization**: Intelligent compression of dropped context
- **Proactive History Saving**: Extract and persist critical information before compaction
- **Zone-Based Management**: Progressive action levels (green/yellow/orange/red/critical)
- **Turn-Aware Operations**: Never break mid-conversation
- **DLP Integration**: Leverage nachos-dlp for pattern-based extraction

## Installation

```bash
pnpm add @nachos/context-manager
```

## Usage

```typescript
import { ContextManager } from '@nachos/context-manager';

// Initialize with configuration
const contextManager = new ContextManager({
  sliding_window: {
    enabled: true,
    mode: 'hybrid',
    thresholds: {
      proactive_prune: 0.60,
      light_compaction: 0.75,
      aggressive_compaction: 0.85,
      emergency: 0.95,
    },
  },
  summarization: {
    enabled: true,
    mode: 'multi-tier',
  },
  proactive_history: {
    enabled: true,
  },
});

// Check context before turn
const check = await contextManager.checkBeforeTurn({
  sessionId: 'session-123',
  messages: nachosMessages,
  systemPromptTokens: 15000,
  contextWindow: 200000,
  reserveTokens: 20000,
});

if (check.needsCompaction) {
  // Execute compaction
  const result = await contextManager.compact({
    sessionId: 'session-123',
    messages: nachosMessages,
    action: check.action,
    config: contextConfig,
  });

  console.log(`Dropped ${result.result.messagesDropped} messages`);
  console.log(`Saved ${result.result.tokensBefore - result.result.tokensAfter} tokens`);
}
```

## Architecture

### Core Components

1. **ContextBudgetCalculator** - Real-time budget tracking and zone determination
2. **SlidingWindowManager** - Turn-aware message dropping logic
3. **HistoryExtractorService** - DLP-based pattern extraction
4. **MemoryFileStorage** - Session-scoped memory persistence
5. **MessageAdapter** - NACHOS message format conversion

### Context Zones

- **Green (0-60%)**: Normal operation
- **Yellow (60-75%)**: Proactive pruning
- **Orange (75-85%)**: Light compaction (30% drop)
- **Red (85-95%)**: Aggressive compaction (40% drop)
- **Critical (95%+)**: Emergency compaction (60% drop)

## Configuration

See [docs/context-management.md](../../../docs/context-management.md) for full configuration options.

## Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

## Development

```bash
# Build
pnpm build

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## License

MIT
