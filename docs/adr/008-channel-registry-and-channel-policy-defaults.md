# ADR-008: Channel Registry and Channel Policy Defaults

**Status**: Proposed

**Date**: 2026-02-04

**Deciders**: Nachos core maintainers

**Context**: Phase 4 channel foundation planning

---

## Context and Problem Statement

Nachos is entering Phase 4 (First Channels). We need a stable, secure foundation that allows multiple channel adapters (Slack, Discord, Telegram, WhatsApp) to be built in parallel without ambiguity. Key decisions include how the registry is loaded, how strict configuration validation is, and what default DM and group policy behaviors should be across platforms.

These decisions affect long-term operability, security posture, and developer ergonomics. They must be consistent across channels and safe by default.

## Decision Drivers

- Security-first defaults (explicit allowlists, mention-gating in groups)
- Deterministic deployments and auditability
- Simplicity for operators and channel authors
- Consistent behavior across platforms
- Clear migration path without hidden runtime mutations

## Considered Options

### Option 1: Config-driven registry with restart-to-reload

Static registry loads from `nachos.toml` and module manifests at startup; changes require a restart.

**Pros:**

- Deterministic and auditable
- Simple to implement and operate
- Aligns with security-first posture

**Cons:**

- No hot-add or dynamic marketplace behavior
- Requires restart for changes

### Option 2: Dynamic registry / marketplace

Runtime discovery and installation of channels via a registry service.

**Pros:**

- Easy onboarding and extension discovery
- Hot-add of channels without restart

**Cons:**

- Higher security and trust complexity (signing, verification, rollback)
- Harder to audit and reproduce
- More operational surface area

### Option 3: Hybrid registry (config + hot reload)

Config-driven base with optional runtime reload or hot-add.

**Pros:**

- Some flexibility without full marketplace
- Can reduce restarts in managed environments

**Cons:**

- Increased complexity and state drift risk
- Still requires trust and safety mechanisms for hot updates

## Decision Outcome

**Chosen option**: Option 1 (Config-driven registry with restart-to-reload)

### Rationale

This choice is the simplest, most deterministic, and most secure by default. It aligns with Nachos’ security-first design and ensures that all channel/tool/LLM changes are explicit and auditable. Restart-to-reload is an acceptable operational cost for the initial channel foundation.

### Implementation

- Registry loads from `nachos.toml` and module manifests at startup.
- Strict configuration validation; unknown keys fail startup.
- Default group policy: mention-gating on by default for group contexts.
- DM policy: explicit allowlist required; pairing supported; DM config optional (no errors if omitted).
- Server/guild policy: explicit allowlist and channel ID allowlist required.
- Minimal per-platform config schema:
  - `token`
  - `servers`/`guilds` array
  - per-server/guild settings: `channel_ids`, `user_allowlist`, and minimal required extras
- Slack supports Socket Mode and HTTP Events API (mode flag in config).

### Consequences

**Positive:**

- Secure-by-default channel behavior
- Predictable deployment and audit trail
- Consistent operator experience across platforms

**Negative:**

- Requires restart for config changes
- Limits dynamic discovery without future changes

**Neutral:**

- Platform-specific features are minimized; “fluff” commands remain optional and separate

## Validation

- Startup fails on unknown config keys
- DM traffic only accepted for allowlisted users
- Group traffic only accepted in allowlisted channels
- Mention-gating enabled by default in group contexts
- Slack works in Socket Mode and HTTP mode with equivalent behavior

## References

- Phase 4 roadmap section
- [003 - Security-First Design](./003-security-first-design.md)
- OpenClaw channel configuration docs

## Notes

These decisions establish a uniform and secure foundation for channel adapters and should be revisited only if dynamic module discovery becomes a priority.

---
