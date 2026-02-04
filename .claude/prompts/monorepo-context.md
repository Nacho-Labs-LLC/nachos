# Monorepo Context

Detailed context about the Nachos monorepo structure, conventions, and workflows.

## Monorepo Structure

```
nachos-core/
├── package.json              # Root package (private, workspaces)
├── pnpm-workspace.yaml       # Workspace configuration
├── pnpm-lock.yaml           # Lockfile (commit this)
├── tsconfig.base.json       # Shared TypeScript config
├── tsconfig.json            # Root TypeScript config
├── vitest.config.ts         # Test configuration
├── eslint.config.js         # ESLint configuration
├── .prettierrc              # Prettier configuration
├── .changeset/              # Changesets for versioning
├── docker/                  # Shared Docker resources
├── policies/                # Default security policies
├── examples/                # Usage examples
├── docs/                    # Documentation
│   ├── adr/                # Architectural Decision Records
│   ├── api/                # API specifications
│   └── *.md                # Various guides
└── packages/               # Workspace packages
    ├── core/               # Core components
    │   ├── gateway/
    │   ├── bus/
    │   ├── llm-proxy/
    │   └── salsa/
    ├── channels/           # Channel adapters
    │   ├── slack/
    │   ├── discord/
    │   ├── telegram/
    │   └── webchat/
    ├── tools/              # Tool containers
    │   ├── browser/
    │   ├── filesystem/
    │   └── code-runner/
    └── shared/             # Shared utilities
        ├── types/
        ├── utils/
        └── schemas/
```

## Package Naming Conventions

- **Scoped names**: `@nachos/[type]-[name]`
- **Core**: `@nachos/core-gateway`, `@nachos/core-bus`
- **Channels**: `@nachos/channel-slack`, `@nachos/channel-discord`
- **Tools**: `@nachos/tool-browser`, `@nachos/tool-filesystem`
- **Shared**: `@nachos/shared-types`, `@nachos/shared-utils`

## pnpm Workspace Features

### Installation

```bash
# Install all workspace dependencies
pnpm install

# Install in specific package
cd packages/core/gateway
pnpm install

# Add dependency to specific package
pnpm add --filter @nachos/core-gateway nats

# Add workspace dependency
pnpm add --filter @nachos/core-gateway @nachos/shared-types --workspace
```

### Running Scripts

```bash
# Run script in all packages
pnpm -r run build
pnpm -r run test

# Run script in specific package
pnpm --filter @nachos/core-gateway build
pnpm --filter @nachos/core-gateway test

# Run script in packages matching pattern
pnpm --filter "./packages/core/*" build
```

### Workspace Protocol

Use `workspace:*` for internal dependencies:

```json
{
  "dependencies": {
    "@nachos/shared-types": "workspace:*",
    "@nachos/shared-utils": "workspace:*"
  }
}
```

## TypeScript Configuration

### Base Config (`tsconfig.base.json`)

Shared configuration extended by all packages:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### Package Config

Each package extends the base:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

## Development Workflow

### 1. Making Changes

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes in packages
cd packages/core/gateway
# Edit files...

# Build to check for errors
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### 2. Creating Changesets

For version-tracked changes:

```bash
# From repo root
pnpm changeset

# Follow prompts:
# - Select packages that changed
# - Choose bump type (major/minor/patch)
# - Describe changes

# Commit the changeset file
git add .changeset/
git commit -m "Add changeset"
```

### 3. Building

```bash
# Build all packages (respects dependencies)
pnpm build

# Build specific package
pnpm --filter @nachos/core-gateway build

# Build package and its dependencies
pnpm --filter @nachos/core-gateway... build

# Clean and rebuild
pnpm clean
pnpm build
```

### 4. Testing

```bash
# Watch mode (default)
pnpm test

# Run once (CI)
pnpm test:ci

# Specific package
cd packages/core/gateway
pnpm test

# Coverage
pnpm test --coverage
```

## Package Dependencies

### Internal Dependencies

Packages can depend on each other:

```
gateway → shared-types, shared-utils, bus
salsa → shared-types, shared-schemas
channel-slack → shared-types, bus
```

Build order is automatically determined by pnpm.

### Circular Dependencies

Avoid circular dependencies. If needed, extract shared code to a common package.

## Common Tasks

### Add New Package

```bash
# Create directory
mkdir -p packages/[type]/[name]
cd packages/[type]/[name]

# Create package.json
cat > package.json << EOF
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
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  }
}
EOF

# Create tsconfig.json
cat > tsconfig.json << EOF
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
EOF

# Create src directory
mkdir src
echo "export const hello = 'world';" > src/index.ts

# Install dependencies
cd ../../..
pnpm install
```

### Update Dependencies

```bash
# Update all dependencies
pnpm update

# Update specific package
pnpm update --filter @nachos/core-gateway

# Update to latest (interactive)
pnpm update --interactive --latest
```

### Publish Packages

```bash
# Version packages (uses changesets)
pnpm changeset:version

# Build all packages
pnpm build

# Publish to npm
pnpm changeset:publish
```

## Scripts Reference

### Root Scripts

```json
{
  "build": "pnpm -r run build",
  "test": "vitest",
  "test:ci": "vitest run",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\"",
  "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md}\"",
  "typecheck": "pnpm -r run typecheck",
  "clean": "pnpm -r run clean && rm -rf node_modules",
  "changeset": "changeset",
  "changeset:version": "changeset version",
  "changeset:publish": "changeset publish"
}
```

### Package Scripts

Each package should have:

```json
{
  "build": "tsc",
  "dev": "tsc --watch",
  "test": "vitest",
  "test:ci": "vitest run",
  "typecheck": "tsc --noEmit",
  "clean": "rm -rf dist"
}
```

## Docker Integration

### Multi-stage Builds

Packages with Dockerfiles:

```dockerfile
# Build stage (uses monorepo context)
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/[type]/[name]/package.json ./packages/[type]/[name]/

# Install dependencies
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source
COPY packages/[type]/[name] ./packages/[type]/[name]
COPY packages/shared ./packages/shared

# Build
RUN pnpm --filter @nachos/[type]-[name] build

# Runtime stage
FROM node:22-alpine
WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/packages/[type]/[name]/dist ./dist
COPY --from=builder /app/packages/[type]/[name]/package.json ./

# Install production dependencies only
RUN corepack enable && pnpm install --prod --frozen-lockfile

CMD ["node", "dist/index.js"]
```

## Troubleshooting

### Phantom Dependencies

If a package imports something not in its dependencies:

```bash
# Add missing dependency
pnpm add --filter @nachos/package-name missing-dep
```

### Type Resolution Issues

```bash
# Clear and rebuild
pnpm clean
pnpm install
pnpm build
```

### Test Failures After Dependency Changes

```bash
# Reinstall everything
rm -rf node_modules packages/*/node_modules
pnpm install
```

## Best Practices

1. **Always run from root** for cross-package operations
2. **Use workspace protocol** for internal dependencies
3. **Commit lock file** (pnpm-lock.yaml)
4. **Create changesets** for version-tracked changes
5. **Run typecheck** before committing
6. **Keep packages focused** (single responsibility)
7. **Document breaking changes** in changesets
8. **Update tests** when changing APIs

## References

- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Changesets](https://github.com/changesets/changesets)
- [CONTRIBUTING.md](../../../CONTRIBUTING.md)
