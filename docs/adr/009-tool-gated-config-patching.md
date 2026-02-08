# ADR-009: Tool-Gated Config Patching for nachos.toml

**Status**: Proposed

**Date**: 2026-02-08

**Deciders**: Nachos Core Team

**Context**: Native configuration commands for Slack/Discord and audited configuration persistence

---

## Context and Problem Statement

Native configuration commands for Slack and Discord require a safe way to persist operator-approved changes to
`nachos.toml`, which is expected to live in a mounted configuration volume. We need a mechanism that:

- Preserves Nachos’ security-first posture
- Ensures all write-through changes are auditable
- Requires explicit, policy-gated intent before modifying configuration
- Avoids ad-hoc filesystem writes from channel adapters

## Decision Drivers

- **Security-first design**: Configuration writes must be gated by Salsa policy and approvals.
- **Auditability**: Every configuration mutation needs a single, observable path.
- **Operational safety**: Prevent hidden runtime mutations outside of explicit operator intent.
- **Docker-native ergonomics**: Persist updates into the mounted config volume without special sidecars.
- **Consistency**: Align behavior across channels and future native command surfaces.

## Considered Options

### Option 1: Runtime overlay only (no write-through)

Keep configuration changes in an in-memory or state-file overlay and require manual edits for persistence.

**Pros:**

- No direct writes to `nachos.toml`
- Lower risk of accidental config corruption

**Cons:**

- Restarts lose changes unless operators manually sync
- Drift between runtime and source configuration
- Poor operator experience for native commands

### Option 2: Channel adapters write `nachos.toml` directly

Let channel adapters patch configuration as part of native commands.

**Pros:**

- Simple to implement within adapters
- Immediate persistence

**Cons:**

- Bypasses centralized policy checks
- Harder to audit consistently
- Encourages duplicated write logic per channel

### Option 3: Tool-gated config patching (Chosen)

Introduce a dedicated tool that applies unified diffs to `nachos.toml`, invoked only when the LLM explicitly
requests a config write.

**Pros:**

- Single policy-gated path for writes (Salsa + approvals)
- Centralized audit logging and observability
- Clear intent boundary: config writes only via tool invocation
- Reusable by future admin surfaces (CLI, web UI, etc.)

**Cons:**

- Requires additional tool orchestration
- Still needs validation to avoid malformed patches

## Decision Outcome

**Chosen option**: Option 3 — Tool-gated config patching

### Rationale

Tool-gated patching preserves a strict security boundary, keeps configuration mutations auditable, and allows
native commands to persist settings without bypassing policy enforcement. It aligns with Nachos’ security-first
architecture while keeping the operator workflow ergonomic.

### Implementation

- Add a `config_patch` tool (SecurityTier: RESTRICTED) that applies unified diffs to `nachos.toml`.
- Resolve `nachos.toml` via `NACHOS_CONFIG_PATH`, `CONFIG_PATH`, or `config_path` in tool config.
- Preserve line endings and trailing newline to avoid formatting churn.
- Require explicit LLM invocation (tool call) before any write-through occurs.
- Keep channel adapters focused on producing a patch + tool request rather than direct file writes.

### Consequences

**Positive:**

- Consistent policy + audit enforcement for configuration changes
- Clear intent boundary for privileged operations
- Reusable for additional admin surfaces

**Negative:**

- Additional orchestration complexity
- Requires careful patch validation and testing

**Neutral:**

- Does not eliminate the need for configuration validation after patching

## Validation

- Unit tests covering patch apply, reverse patch, invalid patch handling, and line-ending preservation
- Policy rules explicitly gate `tool.config_patch` invocation
- Audit logs record all successful and denied config writes

## References

- [ADR-003: Security-First Design](./003-security-first-design.md)
- [ADR-008: Channel Registry and Channel Policy Defaults](./008-channel-registry-and-channel-policy-defaults.md)
- [Discord & Slack Native Configuration Commands Plan](../channel-configuration-commands.md)
- `.claude/prompts/add-adr.md`

## Notes

This ADR captures the agreed approach for persisting native configuration changes while keeping policy and
audit requirements intact.

---
