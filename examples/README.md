# Configuration System Examples

This directory contains examples demonstrating the Nachos configuration system.

## Provider Config Examples

Ready-to-use `nachos.toml` templates for each LLM provider. Copy one as your
starting point and edit to taste. See the full
[Provider Switching Guide](../docs/guides/provider-switching.md) for details.

| File                                                       | Provider                        |
| ---------------------------------------------------------- | ------------------------------- |
| [`nachos.anthropic.toml`](nachos.anthropic.toml)           | Anthropic (Claude) — direct API |
| [`nachos.openai.toml`](nachos.openai.toml)                 | OpenAI (GPT-4o)                 |
| [`nachos.ollama.toml`](nachos.ollama.toml)                 | Ollama — local models           |
| [`nachos.bedrock.toml`](nachos.bedrock.toml)               | AWS Bedrock                     |
| [`nachos.fallback-chain.toml`](nachos.fallback-chain.toml) | Multi-provider fallback chain   |

```bash
# Example: start with the OpenAI config
cp examples/nachos.openai.toml nachos.toml
# Edit .env with your OPENAI_API_KEY, then:
nachos up
```

## Running the Code Examples

### Prerequisites

1. Build the project:
   ```bash
   pnpm run build
   ```

### Config Example

Demonstrates loading, validating, and using the Nachos configuration:

```bash
node examples/config-example.mjs
```

This example shows:

- Loading configuration from `nachos.toml.example`
- Applying environment variable overlays
- Validating the configuration
- Accessing configuration values
- Using configuration in application logic

### Environment Variable Override Example

Test environment variable overlays:

```bash
# Override LLM settings
export LLM_MODEL="gpt-4"
export LLM_MAX_TOKENS="8192"
export SECURITY_MODE="strict"

node examples/config-example.mjs
```

You should see the overridden values in the output.

## Creating Your Own Examples

Create a new `.mjs` file and import from the built packages:

```javascript
import { loadAndValidateConfig } from '../packages/shared/config/dist/index.js';

const config = loadAndValidateConfig({
  configPath: './my-config.toml',
});

console.log(config.llm.model);
```

## TypeScript Examples

For TypeScript examples, use the `.ts` extension and run with tsx:

```bash
npx tsx examples/my-example.ts
```

Make sure to import from `@nachos/config` for proper type checking.
