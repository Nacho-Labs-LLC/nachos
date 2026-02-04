# Claude Code Configuration for Nachos Core

This directory contains Claude Code configuration specific to the nachos-core repository.

## Overview

The nachos-core repo has its own Claude configuration that complements the workspace-level config. When working inside nachos-core, Claude will automatically load this context.

## Files

### [settings.local.json](settings.local.json)

Repository-specific configuration:
- **System prompt**: Loads nachos-core context automatically
- **Custom prompts**: Shortcuts for common development tasks
- **Permissions**: Pre-approved commands for pnpm, docker, git
- **Hooks**: Safety warnings for sensitive operations

### Custom Prompts

#### `/implement-package` ([prompts/implement-package.md](prompts/implement-package.md))

Guide for implementing a new package in the monorepo.

**Use when:**
- Adding a new channel (Slack, Discord, etc.)
- Adding a new tool (Browser, Filesystem, etc.)
- Creating a new core component
- Adding shared utilities

**What it does:**
1. Reviews existing package patterns
2. Checks ADRs for architectural decisions
3. Guides you through package structure
4. Ensures security-first implementation
5. Provides quality checklist

**Example:**
```
/implement-package

I want to create a new channel for Microsoft Teams
```

#### `/add-adr` ([prompts/add-adr.md](prompts/add-adr.md))

Create an Architectural Decision Record.

**Use when:**
- Making significant architectural decisions
- Choosing between technologies
- Defining communication patterns
- Establishing security constraints
- Changing module boundaries

**What it does:**
1. Reviews existing ADRs for context
2. Helps gather decision drivers
3. Guides through options evaluation
4. Uses the ADR template
5. Ensures completeness

**Example:**
```
/add-adr

We need to decide between PostgreSQL and SQLite for session storage
```

#### `/security-review` ([prompts/security-review.md](prompts/security-review.md))

Review code changes for security implications.

**Use when:**
- Before submitting PRs
- Adding new features
- Modifying security-sensitive code
- Working with user input
- Implementing tools or channels

**What it does:**
1. Checks input validation
2. Verifies policy enforcement
3. Reviews audit logging
4. Checks container security
5. Validates error handling
6. Reviews dependencies

**Example:**
```
/security-review

Review the changes I just made to the filesystem tool
```

#### `/monorepo-context` ([prompts/monorepo-context.md](prompts/monorepo-context.md))

Get detailed monorepo structure and conventions.

**Use when:**
- Starting work in the monorepo
- Understanding package relationships
- Learning pnpm workspace features
- Troubleshooting build issues
- Adding dependencies

**What it does:**
- Explains monorepo structure
- Documents pnpm workflows
- Shows common patterns
- Troubleshooting guide
- Best practices

**Example:**
```
/monorepo-context

How do I add a dependency to the gateway package?
```

## Automatic Context Loading

When you start a Claude session in nachos-core, the following context is automatically loaded:

**Documentation:**
- [CLAUDE.md](../CLAUDE.md) - Project mental models
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development workflow
- [docs/architecture.md](../docs/architecture.md) - System architecture
- [docs/TECHNICAL_SPEC.md](../docs/TECHNICAL_SPEC.md) - Technical specs
- [docs/PROJECT_ROADMAP.md](../docs/PROJECT_ROADMAP.md) - Development phases
- [docs/adr/](../docs/adr/) - Architectural decisions

**Project Info:**
- Repository structure (packages/, docs/, etc.)
- Tech stack (TypeScript, pnpm, Docker, NATS)
- Core principles (security-first, Docker-native, modular)
- Development commands

**Reminders:**
- Check ADRs for related decisions
- Review CONTRIBUTING.md for workflow
- Ensure security-first alignment
- Create changeset for version changes
- Run tests before committing

## Pre-approved Commands

The following commands don't require confirmation:

**Package Management:**
- `pnpm install/build/test/lint/typecheck/dev/changeset`

**Docker:**
- `docker compose build/up/down/logs/ps`
- `docker ps/logs/exec`

**Git:**
- `git add/commit/push/status/diff/log/branch/checkout`

**GitHub CLI:**
- `gh issue list/view/create`
- `gh pr list/view/create`

## Safety Hooks

**Pre-tool Use:**
- **Reading .env files**: Displays warning about secrets
- **Destructive commands** (`rm -rf *`): Blocked with error

## Usage Tips

### Starting a Development Session

1. **Open nachos-core in your editor**
2. **Start Claude Code**
3. **Context is auto-loaded** - no need to manually load files
4. **Use custom prompts** or ask questions directly

### For Complex Tasks

Use the appropriate custom prompt:
- **New package**: `/implement-package`
- **Architecture decision**: `/add-adr`
- **Security check**: `/security-review`
- **Monorepo help**: `/monorepo-context`

### For Quick Tasks

Just describe what you need:
```
Add a new test for the message router

Fix the TypeScript error in gateway/src/session-manager.ts

Update the NATS connection to use TLS
```

Claude already knows the project structure and conventions.

## Integration with Workspace Config

The workspace-level config ([../../.claude/](../../.claude/)) provides:
- Cross-repo context (nachos-workspace)
- Planning prompts with ADRs
- Workspace-level documentation

This repo-level config provides:
- Nachos-core specific context
- Monorepo-specific workflows
- Package implementation guides

Both configs work together when you're in the nachos-core directory.

## GitHub Copilot Integration

This repo also has [.github/copilot-instructions.md](../.github/copilot-instructions.md) with:
- Project overview for Copilot
- Security patterns
- Code style conventions
- Common patterns and anti-patterns

Use Copilot for inline suggestions while coding, and Claude Code for planning, implementation, and understanding.

## Customizing

### Adding New Prompts

1. Create a new `.md` file in [prompts/](prompts/)
2. Add entry to `customPrompts` in [settings.local.json](settings.local.json)
3. Document it in this README

### Modifying Permissions

Edit the `permissions.allow` array in [settings.local.json](settings.local.json).

### Adding Hooks

Add to the `hooks.PreToolUse` array with pattern and command.

## Examples

### Example 1: Implementing a New Channel

```
/implement-package

I want to add a Discord channel adapter
```

Claude will:
1. Review existing channel implementations
2. Check channel interface documentation
3. Guide you through the structure
4. Ensure security requirements
5. Help with manifest creation
6. Provide testing guidance

### Example 2: Making an Architectural Decision

```
/add-adr

We need to decide on session storage: SQLite vs PostgreSQL
```

Claude will:
1. Review related ADRs
2. Gather decision drivers
3. Evaluate both options
4. Help complete the ADR template
5. Guide through the review process

### Example 3: Security Review

```
/security-review

Review the new browser tool I just implemented
```

Claude will:
1. Check input validation
2. Verify policy checks
3. Review sandbox implementation
4. Check audit logging
5. Verify Docker security
6. Provide recommendations

### Example 4: Monorepo Question

```
/monorepo-context

How do I add the shared-types package as a dependency to the gateway?
```

Claude will provide the exact commands and explain the workspace protocol.

## Documentation

For more information:
- [CLAUDE.md](../CLAUDE.md) - Project context and mental models
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Development workflow
- [../../.claude/README.md](../../.claude/README.md) - Workspace-level config
- [Claude Code Documentation](https://claude.ai/code/docs)

## Support

If you have questions or want to enhance the setup:
1. Review existing prompts for examples
2. Check the Claude Code documentation
3. Experiment with custom prompts
4. Share improvements with the team
