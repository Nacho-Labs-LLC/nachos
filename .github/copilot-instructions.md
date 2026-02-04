# GitHub Copilot Instructions for Nachos Core

## Project Overview

Nachos is a Docker-native, security-first, modular AI assistant framework. This is a **pnpm monorepo** with multiple interconnected packages.

**Mental Model**: Think of nachos (the food) - chips (core), cheese (message bus), protein (LLM), toppings (channels/tools), salsa (security).

**Architecture**:
- **Core** (`packages/core/*`): Gateway, Bus (NATS), LLM Proxy, Salsa (security)
- **Channels** (`packages/channels/*`): Slack, Discord, Telegram, WebChat
- **Tools** (`packages/tools/*`): Browser, Filesystem, Code Runner
- **Shared** (`packages/shared/*`): Common types, utilities, schemas

## Core Principles

### 1. Security-First Design

**CRITICAL**: Every operation must consider security implications.

```typescript
// ❌ BAD: Direct operation without checks
async function writeFile(path: string, content: string) {
  await fs.writeFile(path, content);
}

// ✅ GOOD: Policy check + audit logging
async function writeFile(
  path: string,
  content: string,
  context: RequestContext
) {
  // 1. Policy check
  const policy = await salsa.evaluate({
    operation: 'filesystem.write',
    resource: path,
    context
  });

  if (!policy.allowed) {
    throw new PolicyViolationError(policy.reason);
  }

  // 2. Audit log
  await audit.log({
    event: 'filesystem.write',
    resource: path,
    user: context.userId,
    outcome: 'allowed'
  });

  // 3. Execute operation
  await fs.writeFile(path, content);
}
```

### 2. Docker-Native

Everything runs in containers with:
- Non-root user
- Read-only filesystem where possible
- Minimal capabilities
- Network isolation

```dockerfile
# Always use multi-stage builds
FROM node:22-alpine AS builder
WORKDIR /app
# Build stage...

FROM node:22-alpine
# Non-root user (REQUIRED)
RUN addgroup -g 1001 nachos && \
    adduser -D -u 1001 -G nachos nachos

USER nachos
# Runtime stage...
```

### 3. Modular Architecture

Components communicate via NATS message bus with defined schemas:

```typescript
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// Define schema
const MessageSchema = Type.Object({
  type: Type.String(),
  payload: Type.Unknown(),
  sessionId: Type.String()
});

// Validate before processing
if (!Value.Check(MessageSchema, message)) {
  throw new ValidationError('Invalid message');
}
```

### 4. Observable

Always include:
- Structured logging
- Health check endpoints
- Audit trails for security events
- Graceful shutdown handlers

## Code Style & Conventions

### TypeScript Standards

```typescript
// Use strict TypeScript
// tsconfig: "strict": true

// Explicit types for public APIs
export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(message: NormalizedMessage): Promise<void>;
}

// Async/await over promises
async function fetchData() {
  const result = await api.getData();
  return result;
}

// Never use 'any' - use 'unknown' if truly unknown
function process(data: unknown) {
  if (isValidData(data)) {
    // Type guard narrows to known type
    handleData(data);
  }
}
```

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `message-router.ts`)
- **Classes**: `PascalCase` (e.g., `MessageRouter`)
- **Functions/Variables**: `camelCase` (e.g., `routeMessage`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`)
- **Types/Interfaces**: `PascalCase`, no `I` prefix (e.g., `Message` not `IMessage`)

### Error Handling

Use structured error types:

```typescript
class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly policy: string,
    public readonly resource: string
  ) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}

// Always include context
throw new PolicyViolationError(
  'Write operation denied',
  'filesystem.write',
  filePath
);
```

## Security Patterns (CRITICAL)

### Input Validation (ALWAYS)

```typescript
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const UserInputSchema = Type.Object({
  message: Type.String({ maxLength: 10000 }),
  sessionId: Type.String({ pattern: '^[a-zA-Z0-9-_]+$' })
});

function handleUserInput(input: unknown) {
  if (!Value.Check(UserInputSchema, input)) {
    throw new ValidationError('Invalid input');
  }
  // Now input is typed and validated
  processMessage(input.message, input.sessionId);
}
```

### Policy Checks (For Tools)

```typescript
// Every tool operation MUST check policy
async function executeTool(
  tool: string,
  operation: string,
  params: unknown,
  context: RequestContext
) {
  // 1. Validate params
  const schema = await getToolSchema(tool);
  if (!Value.Check(schema, params)) {
    throw new ValidationError('Invalid parameters');
  }

  // 2. Check policy
  const policy = await salsa.evaluate({
    operation: `tool.${tool}.${operation}`,
    resource: params.resource,
    context
  });

  if (!policy.allowed) {
    await audit.log({
      event: 'policy.violation',
      tool,
      operation,
      user: context.userId,
      reason: policy.reason
    });
    throw new PolicyViolationError(policy.reason);
  }

  // 3. Execute
  const result = await tool.execute(params);

  // 4. Audit
  await audit.log({
    event: 'tool.execute',
    tool,
    operation,
    user: context.userId,
    outcome: 'success'
  });

  return result;
}
```

### Audit Logging (For Security Events)

```typescript
interface AuditEvent {
  event: string;
  timestamp: Date;
  user: string;
  session: string;
  resource?: string;
  outcome: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
}

await auditLogger.log({
  event: 'channel.message.sent',
  timestamp: new Date(),
  user: userId,
  session: sessionId,
  resource: channelId,
  outcome: 'success',
  metadata: { messageId }
});
```

### Secrets Management

```typescript
// ❌ NEVER hardcode secrets
const API_KEY = 'sk-1234567890';

// ✅ Use environment variables
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable required');
}

// ❌ NEVER log secrets
logger.info('Using API key:', API_KEY);

// ✅ Redact in logs
logger.info('Using API key:', API_KEY.slice(0, 7) + '...');
```

## Message Bus Communication

### Publishing Messages

```typescript
import { Bus } from '@nachos/core-bus';

const bus = new Bus();

await bus.publish('gateway.message.received', {
  sessionId,
  message: normalizedMessage,
  timestamp: new Date()
});
```

### Subscribing to Messages

```typescript
await bus.subscribe('gateway.message.received', async (msg) => {
  // Validate message schema
  if (!Value.Check(MessageReceivedSchema, msg)) {
    logger.error('Invalid message format');
    return;
  }

  // Process message
  await handleMessage(msg);
});
```

### Request/Reply Pattern

```typescript
const response = await bus.request('llm.generate', {
  prompt: userMessage,
  model: 'claude-3-5-sonnet',
  maxTokens: 1000
});
```

## Testing Standards

### Unit Tests (Vitest)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MessageRouter', () => {
  let router: MessageRouter;
  let mockBus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockBus = vi.fn();
    router = new MessageRouter(mockBus);
  });

  it('should route message to correct handler', async () => {
    const message = {
      type: 'chat',
      payload: { text: 'Hello' },
      sessionId: 'test-session'
    };

    await router.route(message);

    expect(mockBus).toHaveBeenCalledWith(
      'chat.message',
      expect.objectContaining({ text: 'Hello' })
    );
  });

  it('should reject invalid messages', async () => {
    await expect(
      router.route({ invalid: 'message' })
    ).rejects.toThrow(ValidationError);
  });
});
```

### Integration Tests

```typescript
describe('Gateway Integration', () => {
  let gateway: Gateway;
  let bus: Bus;

  beforeEach(async () => {
    bus = new Bus({ url: 'nats://localhost:4222' });
    gateway = new Gateway({ bus });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
    await bus.close();
  });

  it('should route message through bus', async () => {
    const received = [];
    await bus.subscribe('gateway.message', (msg) => received.push(msg));

    await gateway.processMessage({
      text: 'Hello',
      from: 'user-1'
    });

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('Hello');
  });
});
```

## Package Structure

### Typical Package Layout

```
packages/[type]/[name]/
├── package.json          # Scoped name: @nachos/[type]-[name]
├── tsconfig.json         # Extends ../../../tsconfig.base.json
├── Dockerfile           # Multi-stage build
├── manifest.json        # Module capabilities (channels/tools)
├── src/
│   ├── index.ts         # Main entry point
│   ├── types.ts         # Type definitions
│   ├── [module].ts      # Implementation
│   └── __tests__/       # Co-located tests
├── tests/
│   ├── unit/            # Unit tests
│   └── integration/     # Integration tests
└── README.md
```

### package.json Template

```json
{
  "name": "@nachos/[type]-[name]",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:ci": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@nachos/shared-types": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

## Common Patterns

### Health Check Endpoint

```typescript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    component: 'gateway',
    version: process.env.VERSION || 'dev',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');

  // Stop accepting new connections
  await server.close();

  // Close message bus connections
  await bus.close();

  // Flush audit logs
  await auditLogger.flush();

  process.exit(0);
});

// Timeout after 30s
setTimeout(() => {
  logger.error('Shutdown timeout, forcing exit');
  process.exit(1);
}, 30000);
```

### Configuration Loading

```typescript
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ConfigSchema = Type.Object({
  natsUrl: Type.String({ format: 'uri' }),
  port: Type.Number({ minimum: 1, maximum: 65535 }),
  logLevel: Type.Union([
    Type.Literal('debug'),
    Type.Literal('info'),
    Type.Literal('warn'),
    Type.Literal('error')
  ])
});

function loadConfig(): Config {
  const config = {
    natsUrl: process.env.NATS_URL,
    port: parseInt(process.env.PORT || '3000'),
    logLevel: process.env.LOG_LEVEL || 'info'
  };

  if (!Value.Check(ConfigSchema, config)) {
    const errors = [...Value.Errors(ConfigSchema, config)];
    throw new Error(`Invalid configuration: ${JSON.stringify(errors)}`);
  }

  return config;
}
```

## Monorepo Workflows

### Adding Dependencies

```bash
# Add to specific package
pnpm add --filter @nachos/core-gateway nats

# Add workspace dependency
pnpm add --filter @nachos/core-gateway @nachos/shared-types --workspace
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package and dependencies
pnpm --filter @nachos/core-gateway... build
```

### Creating Changesets

```bash
# After making changes
pnpm changeset

# Select changed packages
# Choose version bump type
# Describe changes
```

## Documentation

When adding features:

- Update package README.md
- Add JSDoc comments to public APIs
- Update TECHNICAL_SPEC.md if changing contracts
- Create ADR for architectural decisions (use `docs/adr/000-template.md`)
- Update architecture diagrams if needed

## Resources

- [CLAUDE.md](CLAUDE.md) - AI context and mental models
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [docs/architecture.md](docs/architecture.md) - System architecture
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) - Technical specs
- [docs/PROJECT_ROADMAP.md](docs/PROJECT_ROADMAP.md) - Development phases
- [docs/adr/](docs/adr/) - Architectural Decision Records
- [docs/security.md](docs/security.md) - Security model

## Common Mistakes to Avoid

1. ❌ Not validating user input
2. ❌ Missing policy checks in tool operations
3. ❌ Forgetting audit logs for security events
4. ❌ Hardcoding secrets or credentials
5. ❌ Running containers as root
6. ❌ Not implementing health checks
7. ❌ Missing graceful shutdown
8. ❌ Using `any` instead of proper types
9. ❌ Not creating changesets for version-tracked changes
10. ❌ Circular dependencies between packages

---

**Remember**: Security first, always. Every line of code should consider: "How could this be misused?"
