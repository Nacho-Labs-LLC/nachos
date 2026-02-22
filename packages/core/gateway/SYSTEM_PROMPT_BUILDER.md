# System Prompt Builder

Structured, modular system prompt builder for better AI assistant behavior.

## Overview

The `SystemPromptBuilder` creates comprehensive system prompts with distinct sections for:
- Identity/persona
- Tool availability and usage patterns
- Memory recall instructions
- Workspace context
- User identification
- Date/time awareness
- Messaging guidance
- Platform-specific formatting hints
- Runtime metadata

## Usage

### Basic Usage

```typescript
import { SystemPromptBuilder } from './prompts/system-prompt-builder.js';

const builder = new SystemPromptBuilder();

const prompt = builder.build({
  identity: 'You are a helpful AI assistant named Nachos.',
  toolNames: ['exec', 'web_search', 'memory_search'],
  hasMemoryTools: true,
  hasMessagingTools: true,
  runtimeInfo: {
    agentId: 'nachos-bot',
    workspaceDir: '/workspace',
    model: 'claude-sonnet-4',
    channel: 'discord',
  },
  userTimezone: 'America/New_York',
  currentDateTime: new Date().toISOString(),
});

console.log(prompt);
```

### Integration with Gateway

Replace static system prompts with dynamic builder:

```typescript
// In gateway.ts buildLLMRequest method

import { SystemPromptBuilder, PlatformHints } from './prompts/system-prompt-builder.js';

private async buildLLMRequest(sessionId: string): Promise<LLMRequestType> {
  const session = this.sessionManager.getSessionWithMessages(sessionId);
  
  const builder = new SystemPromptBuilder();
  const tools = this.buildToolDefinitions(session);
  
  const systemPrompt = builder.build({
    identity: session.systemPrompt || this.options.defaultSystemPrompt,
    toolNames: tools?.map(t => t.name) || [],
    hasMemoryTools: tools?.some(t => t.name === 'memory_search'),
    hasMessagingTools: tools?.some(t => t.name === 'message'),
    runtimeInfo: {
      agentId: session.userId,
      workspaceDir: this.options.workspaceDir,
      model: session.config?.model,
      channel: session.channel,
    },
    userTimezone: this.getUserTimezone(session),
    currentDateTime: new Date().toISOString(),
    platformHints: this.resolvePlatformHints(session.channel),
  });
  
  return {
    sessionId,
    messages: [
      { role: 'system', content: systemPrompt },
      ...session.messages,
    ],
    tools,
  };
}

private resolvePlatformHints(channel?: string): string[] {
  switch (channel) {
    case 'discord':
      return PlatformHints.discord();
    case 'telegram':
      return PlatformHints.telegram();
    case 'slack':
      return PlatformHints.slack();
    default:
      return PlatformHints.general();
  }
}
```

## Prompt Modes

### Full Mode (default)
Includes all sections for maximum guidance:
- ✅ Identity
- ✅ Tooling
- ✅ Memory
- ✅ Workspace
- ✅ User Identity
- ✅ Date/Time
- ✅ Messaging
- ✅ Documentation
- ✅ Platform Hints
- ✅ Runtime

### Minimal Mode
Only essential sections:
- ✅ Identity
- ✅ Runtime

### None Mode
Bare minimum:
- ✅ Identity only

```typescript
const minimalPrompt = builder.build({
  identity: 'You are Nachos.',
  runtimeInfo: { model: 'claude-sonnet-4' },
  promptMode: 'minimal',
});
```

## Section Details

### Identity Section
Core persona/character definition. Load from:
- Config `defaultSystemPrompt`
- SOUL.md file
- Per-session overrides

### Tooling Section
Lists available tools with:
- Tool names
- Usage summaries
- General guidelines (when to narrate, when to stay silent)

### Memory Section
Instructions for using `memory_search`:
- When to search (past decisions, user preferences)
- When NOT to search (current context, general knowledge)
- Usage limits (1-2 searches per response)

### Workspace Section
Working directory context:
- Current workspace path
- Workspace-specific notes
- File operation guidance

### Runtime Section
Environment metadata:
- Agent ID
- Host/OS/Architecture
- Node version
- Current model
- Channel (discord, telegram, etc.)
- Capabilities

## Platform Hints

Pre-built formatting hints for different platforms:

### Discord
```typescript
PlatformHints.discord()
// Returns:
// - No markdown tables (use bullet lists)
// - Wrap multiple links in <> to suppress embeds
// - Status emojis show bot activity
```

### Telegram
```typescript
PlatformHints.telegram()
// Returns:
// - Markdown supported
// - Message length limit ~4000 chars
```

### Slack
```typescript
PlatformHints.slack()
// Returns:
// - mrkdwn format (not full markdown)
// - Use threads for long conversations
```

## Advanced Features

### Dynamic Tool Summaries

```typescript
const toolSummaries = {
  'exec': 'Run shell commands in workspace',
  'web_search': 'Search the web via Brave API',
  'memory_search': 'Query stored memories from past sessions',
};

const prompt = builder.build({
  toolNames: Object.keys(toolSummaries),
  toolSummaries,
  // ...
});
```

### Custom Workspace Notes

```typescript
const prompt = builder.build({
  workspaceNotes: [
    'Project uses pnpm for package management',
    'Config files in /config directory',
    'Tests require Docker for integration tests',
  ],
  // ...
});
```

### Heartbeat Integration

```typescript
const prompt = builder.build({
  heartbeatPrompt: `Check for urgent emails and upcoming calendar events. 
If nothing needs attention, reply HEARTBEAT_OK.`,
  // ...
});
```

## Migration from Static Prompts

### Before (Static)
```typescript
const defaultSystemPrompt = `You are Nachos, an AI assistant.
You have access to tools: exec, web_search.
Current workspace: /workspace`;
```

### After (Structured)
```typescript
const builder = new SystemPromptBuilder();
const prompt = builder.build({
  identity: 'You are Nachos, an AI assistant.',
  toolNames: ['exec', 'web_search'],
  runtimeInfo: { workspaceDir: '/workspace' },
});
```

## Benefits

1. **Modularity:** Sections can be toggled independently
2. **Consistency:** Same structure across all sessions
3. **Platform Awareness:** Auto-adapt to channel capabilities
4. **Maintainability:** Update one section without touching others
5. **Testability:** Each section can be tested in isolation

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { SystemPromptBuilder } from './system-prompt-builder.js';

describe('SystemPromptBuilder', () => {
  it('builds full prompt with all sections', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test assistant',
      toolNames: ['exec'],
      hasMemoryTools: true,
      runtimeInfo: { model: 'test-model' },
    });
    
    expect(prompt).toContain('Test assistant');
    expect(prompt).toContain('## Runtime');
    expect(prompt).toContain('## Memory Recall');
  });
  
  it('respects minimal mode', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test assistant',
      runtimeInfo: { model: 'test-model' },
      promptMode: 'minimal',
    });
    
    expect(prompt).toContain('Test assistant');
    expect(prompt).not.toContain('## Memory Recall');
  });
});
```

## Future Enhancements

- [ ] Template system for identity personas
- [ ] Auto-detect optimal sections based on config
- [ ] Token budget awareness (truncate less critical sections)
- [ ] Multi-language support
- [ ] Prompt versioning and A/B testing
