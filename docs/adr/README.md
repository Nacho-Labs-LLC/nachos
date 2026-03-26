# Architectural Decision Records

This directory contains ADRs (Architectural Decision Records) for Nachos. Each
file documents a significant technical decision: the context, options
considered, the decision made, and its consequences.

## Index

| #                                             | Title                                        | Status                    |
| --------------------------------------------- | -------------------------------------------- | ------------------------- |
| [001](001-bedrock-adapter-type.md)            | Bedrock Adapter Type Choice                  | ✅ Accepted               |
| [002](002-shell-tool-security-model.md)       | Shell Tool Security Model                    | ✅ Accepted               |
| [003](003-skill-structure.md)                 | Skill Structure (SKILL.md Format)            | ✅ Accepted               |
| [004](004-webchat-hybrid-rpc-architecture.md) | Webchat Hybrid RPC Architecture              | 🔵 Proposed               |
| [005](005-modular-storage-backends.md)        | Modular Storage Backends                     | 🔵 Proposed (stub)        |
| [006](006-session-viewing-continuation.md)    | Session Viewing and Continuation in Admin UI | 📝 Draft (research stale) |

## Format

ADRs use a consistent structure:

- **Status**: Proposed / Accepted / Deprecated / Superseded
- **Context**: Why this decision was needed
- **Decision**: What was decided
- **Consequences**: Tradeoffs and follow-on effects

## Naming Convention

Files are named `NNN-short-title.md` (zero-padded 3-digit number, lowercase
kebab-case title).

## Previous Location

ADRs 001–003 and 006 were previously in `docs/architecture/decisions/`.
Consolidated here on 2026-03-23 for consistent naming and discoverability. The
`docs/architecture/decisions/` directory is now deprecated — do not add new ADRs
there.
