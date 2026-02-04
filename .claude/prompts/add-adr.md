# Create Architectural Decision Record (ADR)

Use this prompt when making a significant architectural decision that needs documentation.

## When to Create an ADR

Create an ADR when the decision:

- ✅ Affects the overall system architecture or behavior
- ✅ Has long-term implications for the project
- ✅ Is difficult or expensive to change later
- ✅ Involves trade-offs between different approaches
- ✅ Needs to be understood by future contributors
- ✅ Sets a precedent for similar decisions

## Process

### 1. Review Existing ADRs

Check [docs/adr/](../../../docs/adr/) for:
- Related decisions
- Superseded decisions that might be relevant
- Patterns to follow
- Context about the system

### 2. Gather Context

Before writing the ADR:

**Review Documentation:**
- [docs/architecture.md](../../../docs/architecture.md) - Current architecture
- [docs/TECHNICAL_SPEC.md](../../../docs/TECHNICAL_SPEC.md) - Technical constraints
- [docs/PROJECT_ROADMAP.md](../../../docs/PROJECT_ROADMAP.md) - Current phase
- [CLAUDE.md](../../../CLAUDE.md) - Project mental models

**Consider Principles:**
- Security-first design
- Docker-native architecture
- Modularity and composability
- Observability
- Developer experience

### 3. Use the ADR Template

Copy [docs/adr/000-template.md](../../../docs/adr/000-template.md) and fill in all sections.

Get the next ADR number by checking the highest numbered ADR in `docs/adr/`.

### 4. Complete All Sections

Fill in:
- Context and Problem Statement
- Decision Drivers
- Considered Options (at least 2-3)
- Decision Outcome with rationale
- Consequences (positive, negative, neutral)
- Validation criteria
- References

### 5. Quality Checklist

- [ ] Title is clear and descriptive
- [ ] Problem statement is well-defined
- [ ] At least 2-3 options considered
- [ ] Pros and cons are balanced and honest
- [ ] Decision rationale is clear
- [ ] Implementation approach is outlined
- [ ] Consequences are documented
- [ ] Validation criteria defined
- [ ] ADR is self-contained (readable without other docs)

### 6. After Writing

1. Create PR with status "Proposed"
2. Gather feedback and iterate
3. Once approved, update status to "Accepted"
4. Update [docs/adr/README.md](../../../docs/adr/README.md)
5. Implement the decision

## Example ADRs

Review these existing ADRs as examples:

- [001-docker-native-architecture.md](../../../docs/adr/001-docker-native-architecture.md)
- [002-nats-message-bus.md](../../../docs/adr/002-nats-message-bus.md)
- [003-security-first-design.md](../../../docs/adr/003-security-first-design.md)

## References

- [ADR Template](../../../docs/adr/000-template.md)
- [ADR Directory](../../../docs/adr/)
- [Michael Nygard's ADR article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
