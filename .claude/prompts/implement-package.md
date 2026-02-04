# Implement New Package

Guide for implementing a new package in the Nachos monorepo following established patterns and conventions.

## Context Gathering

### 1. Determine Package Type

What type of package are you creating?

- **Core Component** (`packages/core/*`): Gateway, Bus, LLM Proxy, Salsa
- **Channel** (`packages/channels/*`): Slack, Discord, Telegram, etc.
- **Tool** (`packages/tools/*`): Browser, Filesystem, Code Runner, etc.
- **Shared Utility** (`packages/shared/*`): Common types, utilities

### 2. Review Existing Patterns

Before implementing, examine similar packages:

**For Channels:**
- Look at existing channel implementations
- Check `docs/api/channel-interface.md`
- Review manifest structure in existing channels

**For Tools:**
- Examine existing tool implementations
- Check `docs/api/tool-interface.md`
- Review security requirements in `docs/security.md`

**For Core Components:**
- Review architecture in `docs/architecture.md`
- Check message bus patterns in `docs/api/message-bus.md`
- Examine existing core packages for patterns

### 3. Check ADRs

Review [docs/adr/](../../../docs/adr/) for architectural decisions affecting your package:
- Communication patterns
- Security requirements
- Docker considerations
- Network isolation

## Package Setup

### 4. Create Package Structure

```
packages/[type]/[package-name]/
├── package.json           # Package configuration
├── tsconfig.json          # TypeScript config (extends base)
├── manifest.json          # Module manifest (channels/tools only)
├── Dockerfile             # Container definition
├── .dockerignore
├── src/
│   ├── index.ts          # Main entry point
│   ├── types.ts          # Type definitions
│   └── ...               # Implementation files
├── tests/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
└── README.md             # Package documentation
```

### 5. Follow Security-First Principles

**For All Packages:**
- ✅ Validate all external input with TypeBox schemas
- ✅ Use structured error types
- ✅ Implement health check endpoint
- ✅ Add structured logging
- ✅ Handle graceful shutdown

**For Channels:**
- ✅ Normalize messages to standard format
- ✅ Validate platform-specific input
- ✅ Implement rate limiting hooks
- ✅ Support session management

**For Tools:**
- ✅ Route through Salsa for policy checks
- ✅ Implement sandboxed execution
- ✅ Add comprehensive audit logging
- ✅ Define clear security boundaries
- ✅ Document required permissions

## Quality Checklist

Before submitting:

- [ ] All tests passing (`pnpm test`)
- [ ] Type checking clean (`pnpm typecheck`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Security review completed
- [ ] Documentation written
- [ ] Changeset created (`pnpm changeset`)
- [ ] Dockerfile follows security best practices
- [ ] Manifest declares all capabilities
- [ ] Integrates with message bus correctly
- [ ] Health check implemented
- [ ] Graceful shutdown implemented
- [ ] Error handling comprehensive
- [ ] Audit logging added (if security-relevant)

## References

- [CLAUDE.md](../../../CLAUDE.md) - Project context
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) - Contribution guidelines
- [docs/architecture.md](../../../docs/architecture.md) - System architecture
- [docs/api/](../../../docs/api/) - API specifications
- [docs/adr/](../../../docs/adr/) - Architectural decisions
