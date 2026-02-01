# Contributing to Nachos

Thank you for your interest in contributing to Nachos! This guide will help you get started with development.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Creating New Modules](#creating-new-modules)

## Code of Conduct

Be respectful, inclusive, and constructive. We're building something cool together.

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js** 22.0.0 or higher
- **pnpm** 9.0.0 or higher
- **Docker** and Docker Compose
- **Git**

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:

```bash
git clone https://github.com/YOUR_USERNAME/nachos.git
cd nachos
```

3. Add the upstream repository:

```bash
git remote add upstream https://github.com/Nacho-Labs-LLC/nachos.git
```

## Development Setup

### 1. Install Dependencies

```bash
pnpm install
```

This will install all dependencies for the monorepo workspace.

### 2. Build All Packages

```bash
pnpm build
```

This builds all packages in the correct order based on their dependencies.

### 3. Run Tests

```bash
# Run tests in watch mode (default)
pnpm test

# Run tests once (CI mode)
pnpm test:ci
```

### 4. Linting and Formatting

```bash
# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check

# Type checking
pnpm typecheck
```

## Project Structure

Nachos uses a monorepo structure managed with pnpm workspaces:

```
nachos/
├── packages/
│   ├── cli/              # Nachos CLI tool
│   ├── core/             # Core components
│   │   ├── gateway/      # Session management & routing
│   │   ├── bus/          # Message bus (NATS wrapper)
│   │   ├── llm-proxy/    # LLM provider abstraction
│   │   └── salsa/        # Policy engine
│   ├── channels/         # Channel adapters
│   │   ├── slack/
│   │   ├── discord/
│   │   ├── telegram/
│   │   └── webchat/
│   ├── tools/            # Tool containers
│   │   ├── browser/
│   │   ├── filesystem/
│   │   └── code-runner/
│   ├── skills/           # Bundled prompt+tool recipes
│   └── shared/           # Shared utilities
├── docs/                 # Documentation
├── diagrams/             # Architecture diagrams
├── policies/             # Default security policies
└── tests/                # E2E tests
```

### Package Organization

- **Core packages** (`packages/core/*`): Essential components that form the foundation
- **Channel packages** (`packages/channels/*`): Platform adapters (Slack, Discord, etc.)
- **Tool packages** (`packages/tools/*`): Capability containers
- **Shared packages** (`packages/shared/*`): Common utilities and types

## Development Workflow

### Working on a Package

Each package can be developed independently:

```bash
# Navigate to the package
cd packages/core/gateway

# Install dependencies (if needed)
pnpm install

# Build the package
pnpm build

# Run package-specific tests
pnpm test

# Run in development mode (if available)
pnpm dev
```

### Working on the CLI

The CLI is the primary user interface for Nachos:

```bash
cd packages/cli

# Build the CLI
pnpm build

# Test CLI commands (after build)
node dist/index.js --help
```

### Docker Development

To test containers locally:

```bash
# Build all Docker images
docker compose build

# Start the stack
docker compose up

# View logs
docker compose logs -f

# Stop the stack
docker compose down
```

## Testing

### Test Structure

```
packages/
  package-name/
    src/
    tests/
      unit/          # Unit tests
      integration/   # Integration tests
```

### Writing Tests

We use Vitest for testing:

```typescript
import { describe, it, expect } from 'vitest';

describe('MyComponent', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

### Running Tests

```bash
# Watch mode (default)
pnpm test

# Run once (CI mode)
pnpm test:ci

# Specific package
cd packages/core/gateway
pnpm test

# Coverage
pnpm test --coverage
```

## Code Style

### TypeScript

- Use TypeScript for all code
- Enable strict mode
- Prefer explicit types over inference for public APIs
- Use interfaces for object shapes
- Use type aliases for unions and complex types

### Formatting

We use Prettier with the following conventions:

- Single quotes for strings
- 2 spaces for indentation
- Semicolons required
- Trailing commas in multiline
- 80 character line length (soft limit)

### Naming Conventions

- **Files**: `kebab-case.ts`
- **Classes**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Types/Interfaces**: `PascalCase`

### Comments

- Use JSDoc for public APIs
- Use inline comments sparingly, only when code isn't self-explanatory
- Keep comments up-to-date with code changes

Example:

```typescript
/**
 * Routes incoming messages to the appropriate handler.
 * @param message - The message to route
 * @returns Promise resolving to the routing result
 */
async function routeMessage(message: Message): Promise<RoutingResult> {
  // Implementation
}
```

## Submitting Changes

### Branching Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates

### Commit Messages

Follow the Conventional Commits specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:

```
feat(gateway): add session timeout handling
fix(cli): resolve config parsing error
docs(readme): update installation instructions
```

### Pull Request Process

1. **Create a branch** from `develop`:

   ```bash
   git checkout -b feature/my-awesome-feature
   ```

2. **Make your changes** with clear, focused commits

3. **Test your changes**:

   ```bash
   pnpm build
   pnpm test
   pnpm lint
   pnpm typecheck
   ```

4. **Update documentation** if needed

5. **Create a changeset** (for version-tracked changes):

   ```bash
   pnpm changeset
   ```

   Follow the prompts to describe your changes.

6. **Push your branch**:

   ```bash
   git push origin feature/my-awesome-feature
   ```

7. **Open a Pull Request** on GitHub:
   - Use a clear, descriptive title
   - Reference any related issues
   - Describe what changed and why
   - Include screenshots for UI changes
   - Ensure all CI checks pass

### PR Review Process

- At least one maintainer approval required
- All CI checks must pass
- No merge conflicts
- Documentation updated (if applicable)
- Changeset created (if applicable)

## Creating New Modules

### New Channel

```bash
cd packages/channels
mkdir my-channel
cd my-channel

# Create package.json
cat > package.json << EOF
{
  "name": "@nachos/channel-my-channel",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  }
}
EOF

# Create manifest
cat > manifest.json << EOF
{
  "name": "nachos-channel-my-channel",
  "version": "0.0.1",
  "type": "channel",
  "capabilities": {
    "network": {
      "egress": ["api.example.com"]
    },
    "secrets": ["MY_CHANNEL_TOKEN"]
  },
  "provides": {
    "channel": "my-channel"
  }
}
EOF
```

### New Tool

```bash
cd packages/tools
mkdir my-tool
cd my-tool

# Similar structure to channels
# Include security tier in manifest
```

### Module Requirements

All modules must:

1. Have a `manifest.json` declaring capabilities
2. Implement the appropriate interface (Channel or Tool)
3. Include unit tests
4. Document configuration options
5. Follow security best practices
6. Include a Dockerfile for containerization

## Architecture Decisions

For significant architectural changes:

1. Review [Architecture Documentation](docs/architecture.md)
2. Create an ADR (Architecture Decision Record) in `docs/adr/`
3. Discuss in an issue or RFC before implementing

## Getting Help

- **Issues**: For bug reports and feature requests
- **Discussions**: For questions and community help
- **Discord**: Join our community server (link in README)

## License

By contributing to Nachos, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Nachos! 🧀
