# GitHub Copilot Instructions for Nachos Core

## Project

pnpm monorepo for Nachos, a Docker-native security-first AI assistant platform.

## Architecture

- `packages/core/*`: gateway, bus (NATS), llm-proxy, cheese (security/policy
  engine)
- `packages/channels/*`: slack, discord, telegram, webchat
- `packages/tools/*`: browser, filesystem, code-runner
- `packages/shared/*`: common types, utilities, TypeBox schemas

## Security Rules (Critical)

- **Validate all external input** with TypeBox schemas before processing — no
  exceptions
- **Policy-check all tool operations** through the Cheese engine before
  executing
- **Audit-log all security events** (policy violations, tool executions, auth
  events)
- Never hardcode secrets; use `process.env` and throw at startup if missing
- Never log secret values; redact with `.slice(0, 7) + '...'`
- Deny by default — capabilities must be explicitly granted

## TypeScript Conventions

- Strict mode always; never use `any`, use `unknown` with type guards
- Files: `kebab-case.ts` · Classes: `PascalCase` · Functions/vars: `camelCase` ·
  Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`, no `I` prefix (e.g. `Message` not `IMessage`)
- Structured error types with context: extend `Error`, set `this.name`, include
  resource/operation fields
- `async/await` over `.then()` chains

## NATS Bus

- Validate all inbound NATS messages with TypeBox before processing
- Topics follow `component.noun.verb` pattern (e.g. `gateway.message.received`,
  `tool.filesystem.write`)
- Use `bus.publish()` for fire-and-forget; `bus.request()` for request/reply

## Docker Requirements

- Multi-stage builds; runtime stage on `node:22-alpine`
- Non-root user (`nachos` uid 1001) required in runtime stage
- Read-only filesystem where possible; drop unnecessary capabilities

## Package Conventions

- Scoped names: `@nachos/[type]-[name]` (e.g. `@nachos/core-gateway`,
  `@nachos/channel-slack`)
- Each package extends root `tsconfig.base.json`
- Channels and tools require a `manifest.json` declaring network/secret
  capabilities
- Run `pnpm changeset` after version-tracked changes

## Common Mistakes

- Missing TypeBox validation on user or NATS input
- Missing Cheese policy check before tool operations
- Missing audit log for security-relevant events
- Hardcoded secrets or secrets appearing in log output
- Containers running as root
- `any` instead of typed interfaces or `unknown`
- Circular dependencies between packages

## References

- Architecture: `docs/architecture.md`
- Security model: `docs/security.md`
- ADRs: `docs/adr/`
- Shared types: `packages/shared/types/src/`
- Policies: `policies/`
