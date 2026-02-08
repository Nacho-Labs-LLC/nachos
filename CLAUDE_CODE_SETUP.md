# Claude Code Setup for Nachos Core

This document describes the Claude Code and GitHub Copilot configuration for the nachos-core repository.

## What's Configured

### Claude Code ([.claude/](.claude/))

Comprehensive configuration for AI-assisted development:

1. **Automatic Context Loading**
   - Project structure and tech stack
   - Links to all documentation
   - Core principles and conventions
   - Development commands

2. **Custom Prompts** (4 specialized workflows)
   - `/implement-package` - Guide for adding packages to monorepo
   - `/add-adr` - Create Architectural Decision Records
   - `/security-review` - Security-focused code review
   - `/monorepo-context` - Detailed monorepo reference

3. **Pre-approved Permissions**
   - pnpm, docker, git commands
   - GitHub CLI operations
   - No confirmations needed

4. **Safety Hooks**
   - Warnings when reading .env files
   - Blocks destructive rm commands

### GitHub Copilot ([.github/copilot-instructions.md](.github/copilot-instructions.md))

Code completion context:
- Project architecture and patterns
- Security-first code examples
- TypeScript conventions
- Message bus communication
- Testing standards
- Common anti-patterns to avoid

## Quick Start

### Using Claude Code

**For implementing new packages:**
```
/implement-package

I want to add a new channel for Microsoft Teams
```

**For architectural decisions:**
```
/add-adr

We need to decide between Redis and in-memory for rate limiting
```

**For security reviews:**
```
/security-review

Review the changes to the filesystem tool
```

**For monorepo help:**
```
/monorepo-context

How do I add a workspace dependency?
```

**For general development:**
Just ask! Claude already has full project context:
```
Add a new test for the session manager

Explain how the policy engine works

Help me debug this NATS connection issue
```

### Using GitHub Copilot

Copilot provides inline suggestions while you code, automatically following:
- Nachos security patterns (policy checks, audit logging, validation)
- TypeScript conventions (strict mode, explicit types)
- Docker best practices (non-root, health checks)
- Message bus patterns (TypeBox validation)

## File Structure

```
nachos-core/
├── .claude/
│   ├── settings.local.json       # Main configuration
│   ├── README.md                  # Detailed usage guide
│   └── prompts/                   # Custom prompt templates
│       ├── implement-package.md
│       ├── add-adr.md
│       ├── security-review.md
│       └── monorepo-context.md
├── .github/
│   └── copilot-instructions.md    # Copilot configuration
├── CLAUDE.md                       # AI context (existing)
├── CONTRIBUTING.md                 # Development workflow (existing)
└── docs/                          # Documentation (existing)
    ├── adr/                       # ADRs
    ├── api/                       # API specs
    ├── architecture.md
    ├── TECHNICAL_SPEC.md
    └── PROJECT_ROADMAP.md
```

## Key Features

### Security-First Development

Both Claude Code and Copilot are configured to:
- Always validate input with TypeBox
- Include policy checks for operations
- Add audit logging for security events
- Use structured error types
- Follow least-privilege principles

**Example suggestion from Copilot:**
```typescript
// When you start writing a tool function, Copilot suggests:
async function executeTool(params: unknown, context: RequestContext) {
  // Input validation
  if (!Value.Check(ParamsSchema, params)) {
    throw new ValidationError('Invalid parameters');
  }

  // Policy check
  const policy = await salsa.evaluate({
    operation: 'tool.execute',
    resource: params.resource,
    context
  });

  if (!policy.allowed) {
    throw new PolicyViolationError(policy.reason);
  }

  // Audit log
  await audit.log({
    event: 'tool.execute',
    user: context.userId,
    outcome: 'success'
  });

  // Execute...
}
```

### Monorepo-Aware

Both tools understand:
- pnpm workspace structure
- Package interdependencies
- Changesets workflow
- Build order requirements

### Documentation Integration

Automatically references:
- [CLAUDE.md](CLAUDE.md) - Mental models
- [CONTRIBUTING.md](CONTRIBUTING.md) - Workflow
- [docs/architecture.md](docs/architecture.md) - Architecture
- [docs/adr/](docs/adr/) - Decisions
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) - Specs

## Workflow Examples

### Example 1: Adding a New Slack Feature

```
User: I want to add support for Slack threads

Claude: Let me help you add thread support to the Slack channel.
First, I'll review the existing Slack implementation...

[Explores packages/channels/slack/]

I can see the current implementation handles direct messages.
To add thread support, we'll need to:

1. Update the message normalization to capture thread_ts
2. Modify the sendMessage function to support replies
3. Update the manifest to request threads:read permission
4. Add tests for threaded conversations

Let me implement these changes...
```

### Example 2: Creating an ADR

```
User: /add-adr

We're considering moving from SQLite to PostgreSQL for session storage

Claude: I'll help you create an ADR for this decision.
First, let me review existing ADRs...

[Reviews docs/adr/]

I see ADR-001 covers Docker-native architecture, which is relevant.

Let me create ADR-007 following your template:

# ADR-007: PostgreSQL for Session Storage

**Status**: Proposed
**Date**: 2026-02-03
...

[Creates complete ADR with proper analysis]

Would you like me to:
1. Save this to docs/adr/007-postgresql-session-storage.md?
2. Update the ADR README?
```

### Example 3: Security Review

```
User: /security-review

I just modified the browser tool

Claude: I'll perform a security review of the browser tool.

[Reads packages/tools/browser/src/]

Security Review Summary:

✅ Input validation with TypeBox - Good
✅ URL allowlist checking - Good
✅ Sandboxed execution - Good
⚠️  Consider adding rate limiting per user
⚠️  Add timeout for page loads to prevent DoS
❌ Missing audit logging for URL access

Recommendations:
1. Add rate limiting: ...
2. Implement timeouts: ...
3. Add audit logging: ...

Would you like me to implement these fixes?
```

## Benefits

### For Development

- **Faster onboarding**: Context is built-in
- **Consistent patterns**: Suggestions follow conventions
- **Security by default**: Security checks are automatic
- **Less context switching**: No need to look up docs

### For Code Quality

- **Type safety**: Always suggests proper TypeScript
- **Error handling**: Structured errors by default
- **Testing**: Suggests comprehensive test cases
- **Documentation**: Reminds to update docs

### For Security

- **Input validation**: Never forgets validation
- **Policy checks**: Always includes for tools
- **Audit logging**: Suggests for security events
- **Best practices**: Docker, network isolation

## Tips

1. **Trust the context**: Claude already knows the project structure
2. **Use custom prompts**: They're optimized for common tasks
3. **Ask for explanations**: Great for understanding existing code
4. **Iterate with Claude**: Refine implementations together
5. **Security reviews**: Use before PRs
6. **ADRs**: Use the prompt to ensure completeness

## Customization

Want to add more prompts or modify configuration?

1. **Add custom prompt:**
   - Create `.claude/prompts/my-prompt.md`
   - Add to `settings.local.json` customPrompts
   - Document in `.claude/README.md`

2. **Modify permissions:**
   - Edit `permissions.allow` in `settings.local.json`

3. **Add hooks:**
   - Edit `hooks` section in `settings.local.json`

4. **Update Copilot instructions:**
   - Edit `.github/copilot-instructions.md`

## Troubleshooting

**Claude doesn't see prompts:**
- Ensure you're in the nachos-core directory
- Check `.claude/settings.local.json` exists
- Restart Claude session

**Copilot suggestions not relevant:**
- Verify `.github/copilot-instructions.md` exists
- Restart VSCode
- Ensure file is in repository

**Hooks not working:**
- Check hook patterns in `settings.local.json`
- Verify command syntax

## Resources

- [.claude/README.md](.claude/README.md) - Detailed Claude config docs
- [CLAUDE.md](CLAUDE.md) - Project context
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development workflow
- [Claude Code Documentation](https://claude.ai/code/docs)
- [GitHub Copilot Docs](https://docs.github.com/en/copilot)

## Next Steps

1. Try a custom prompt: `/monorepo-context`
2. Ask Claude to explain a component
3. Start coding and watch Copilot suggest patterns
4. Use `/security-review` before your next PR

---

**Welcome to AI-assisted development with Nachos!** 🌮
