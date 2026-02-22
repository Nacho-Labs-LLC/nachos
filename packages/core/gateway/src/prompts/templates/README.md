# Prompt Templates Library

Reusable system prompt templates for common use cases.

## Available Templates

### General Purpose
- `assistant-general.md` - General-purpose helpful assistant
- `assistant-concise.md` - Brief, to-the-point responses
- `assistant-verbose.md` - Detailed, explanatory responses

### Specialized Roles
- `coding-assistant.md` - Software development focus
- `research-assistant.md` - Research and analysis
- `creative-writer.md` - Creative writing and storytelling
- `data-analyst.md` - Data analysis and visualization
- `technical-writer.md` - Documentation and technical writing

### Platform-Specific
- `discord-bot.md` - Discord-optimized assistant
- `telegram-bot.md` - Telegram-optimized assistant
- `slack-bot.md` - Slack workspace assistant

## Usage

### With SystemPromptBuilder

```typescript
import { SystemPromptBuilder } from '../system-prompt-builder.js';
import { loadTemplate } from './index.js';

const template = await loadTemplate('coding-assistant');
const builder = new SystemPromptBuilder();

const prompt = builder.build({
  identity: template.identity,
  toolNames: ['exec', 'web_search'],
  runtimeInfo: { workspaceDir: '/workspace' },
});
```

### Direct Usage

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';

const templatePath = join(__dirname, 'coding-assistant.md');
const template = await readFile(templatePath, 'utf-8');
```

## Template Format

Each template is a markdown file with frontmatter:

```markdown
---
name: coding-assistant
description: Software development assistant
platform: any
tone: professional
verbosity: balanced
---

You are an expert software developer and coding assistant.
...
```

## Creating Custom Templates

1. Copy an existing template as a starting point
2. Modify the identity and instructions
3. Test with your use case
4. Save to this directory

## Best Practices

- Keep templates focused on a single role
- Use clear, specific language
- Include platform-specific hints when relevant
- Test templates with actual conversations
- Version control template changes
