# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the Nachos project.

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures an important architectural decision made along with its context and consequences.

## When to Write an ADR

Create an ADR when you make a significant architectural decision that:

- Affects the overall structure or behavior of the system
- Has long-term implications
- Is difficult or expensive to change later
- Involves trade-offs between different approaches
- Needs to be understood by future maintainers

Examples:

- Choosing between different technologies or frameworks
- Deciding on a communication pattern between components
- Establishing security or performance constraints
- Defining module boundaries

## ADR Format

Use the template in [000-template.md](./000-template.md) for new ADRs.

Each ADR should be:

- **Numbered**: Sequentially numbered (e.g., `001-`, `002-`)
- **Titled**: Short, descriptive title in kebab-case
- **Self-contained**: Can be understood without reading other ADRs
- **Concise**: Focus on the decision and its rationale

## ADR Lifecycle

ADRs follow this lifecycle:

1. **Proposed**: Initial draft, open for discussion
2. **Accepted**: Decision has been approved and implemented
3. **Superseded**: Replaced by a newer ADR (reference the new one)
4. **Deprecated**: No longer relevant but kept for historical context

## Existing ADRs

| ADR                                               | Status   | Date       | Implemented |
| ------------------------------------------------- | -------- | ---------- | ----------- |
| [001 - Docker-Native Architecture](./001-docker-native-architecture.md) | Accepted | 2026-01-15 | 2026-01-15 |
| [002 - NATS for Message Bus](./002-nats-message-bus.md) | Accepted | 2026-01-18 | 2026-01-18 |
| [003 - Security-First Design](./003-security-first-design.md) | Accepted | 2026-01-20 | 2026-01-20 |
| [004 - Embedded Salsa & Shardable Gateway](./004-embedded-salsa-shardable-gateway.md) | Accepted | 2026-02-01 | 2026-02-06 |
| [005 - Modular Audit Providers](./005-modular-audit-providers.md) | Accepted | 2026-02-01 | 2026-02-01 |
| [006 - DLP Library as Separate Repository](./006-dlp-library-separate-repo.md) | Accepted | 2026-02-01 | 2026-02-06 |
| [007 - Direct LLM API Provider Adapters](./007-direct-llm-api-provider-adapters.md) | Proposed | 2026-02-02 | - |
| [008 - Channel Registry and Channel Policy Defaults](./008-channel-registry-and-channel-policy-defaults.md) | Accepted | 2026-02-04 | 2026-02-06 |

## Creating a New ADR

1. Copy the template:

   ```bash
   cp docs/adr/000-template.md docs/adr/XXX-your-decision-title.md
   ```

2. Update the number (next in sequence)

3. Fill in all sections

4. Create a PR with the ADR

5. Discuss and iterate

6. Once approved, update the status to "Accepted"

7. Update this README with the new entry

## References

- [Michael Nygard's ADR article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [adr.github.io](https://adr.github.io/)
