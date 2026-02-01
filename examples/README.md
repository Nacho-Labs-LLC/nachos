# Configuration System Examples

This directory contains examples demonstrating the Nachos configuration system.

## Running the Examples

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
