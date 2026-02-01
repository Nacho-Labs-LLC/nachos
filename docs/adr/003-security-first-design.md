# ADR-003: Security-First Design

**Status**: Accepted

**Date**: 2026-01-20

**Deciders**: Nachos Core Team

**Context**: Security architecture for Nachos framework

---

## Context and Problem Statement

AI assistants have access to sensitive data, can execute code, browse the web, and interact with external services. This creates significant security risks:

- Unauthorized access to user data
- Malicious or buggy tools causing damage
- LLM prompt injection attacks
- Data exfiltration
- Resource exhaustion
- Privilege escalation

Most existing AI assistant frameworks follow a "permissive by default" model where security is an afterthought. We need to decide: should Nachos follow the same pattern, or take a different approach?

## Decision Drivers

- **User safety**: Protect users from unintended consequences
- **Data privacy**: No accidental leakage of sensitive information
- **Trust**: Users should feel confident running Nachos
- **Usability**: Security shouldn't make the system unusable
- **Flexibility**: Power users should be able to relax constraints
- **Transparency**: Security decisions should be clear and auditable
- **Defense in depth**: Multiple layers of protection

## Considered Options

### Option 1: Permissive by Default

Enable all features by default, let users lock down if desired.

**Pros:**

- Easiest to get started
- Best initial user experience
- Follows convention of existing tools
- No friction for new users
- Showcases capabilities immediately

**Cons:**

- Dangerous out of the box
- Users may not understand risks
- Easy to accidentally expose sensitive data
- Hard to secure retroactively
- Negative security incidents likely
- Difficult to build trust

### Option 2: Strict by Default

Start with everything locked down, require explicit enablement.

**Pros:**

- Safe out of the box
- Forces users to understand what they're enabling
- Clear audit trail of permissions
- Builds trust through caution
- Easier to defend security posture
- Aligns with security best practices

**Cons:**

- More friction for new users
- Requires configuration before being useful
- May frustrate users wanting "quick start"
- Could appear less capable than competitors

### Option 3: Tiered Security Modes

Provide multiple security presets (strict, standard, permissive).

**Pros:**

- Flexibility for different use cases
- Progressive disclosure of capabilities
- Can default to safe option
- Power users can choose permissive mode
- Easy to explain and understand
- Accommodates both cautious and adventurous users

**Cons:**

- More complex to implement
- Users must understand mode differences
- Potential for mode confusion
- More documentation needed

### Option 4: Capability-Based

Fine-grained permissions for each operation, no presets.

**Pros:**

- Maximum flexibility
- Precise control
- Follows least-privilege principle
- Can optimize per-use-case

**Cons:**

- Extremely high configuration burden
- Overwhelming for new users
- Easy to misconfigure
- No good defaults
- Poor user experience

## Decision Outcome

**Chosen option**: Tiered Security Modes (Option 3) with Strict as Default

### Rationale

Tiered security modes provide the best balance:

1. **Safe by default**: New users start with strict mode
2. **Progressive unlocking**: Users can relax constraints as they gain confidence
3. **Clear mental model**: Three modes are easy to understand
4. **Documented trade-offs**: Each mode clearly explains what it enables
5. **Explicit opt-in**: Moving to permissive mode requires deliberate action
6. **Flexibility**: Supports both cautious and power users

The three modes:

**🔒 Strict Mode (Default)**:

- All tools disabled by default
- Only allowlisted DMs
- Full audit logging
- Rate limits enforced
- DLP scanning enabled
- No network egress for tools
- Read-only filesystem access

**⚖️ Standard Mode**:

- Common tools enabled (browser, filesystem read, calendar)
- Pairing-based DM approval
- Audit logging
- Reasonable rate limits
- Controlled filesystem access (./workspace only)
- Limited network egress

**🔓 Permissive Mode**:

- Most tools enabled
- DMs allowed by default
- Minimal audit logging
- Higher rate limits
- Broader filesystem access
- Broader network access
- Requires explicit opt-in in config

### Implementation

Security is enforced at multiple layers:

1. **Container level**: Non-root user, dropped capabilities, read-only filesystem
2. **Network level**: Isolated internal network, controlled egress
3. **Policy engine (Salsa)**: Evaluates all actions against rules
4. **Manifest system**: Modules declare required capabilities
5. **Configuration**: Security mode determines which rules apply

Configuration:

```toml
[security]
mode = "strict"  # "strict" | "standard" | "permissive"

# Optional: Override specific policies
[security.overrides]
"tool.filesystem" = "allow"
"channel.slack.dm" = "allowlist"
```

Policy evaluation:

```yaml
# Example policy rule
- name: 'tool-filesystem-write-standard'
  match:
    tool: 'filesystem'
    action: 'write'
  conditions:
    - security_mode: ['standard', 'permissive']
    - path_within: ['./workspace']
  effect: 'allow'
  priority: 100
```

### Consequences

**Positive:**

- Users trust Nachos because it's safe by default
- Clear upgrade path from strict → standard → permissive
- Security is a selling point, not an afterthought
- Audit logs provide accountability
- Container isolation prevents many attacks
- Policy engine is flexible and extensible
- New tools can be added with appropriate security tiers

**Negative:**

- Initial setup requires more steps
- "Getting started" guide must explain security modes
- Some users will be frustrated by restrictions
- More documentation needed
- Policy engine adds complexity
- Performance overhead from policy checks (~1-2ms per action)

**Neutral:**

- Security becomes a core part of Nachos identity
- Community discussions will focus on security trade-offs
- Third-party modules must declare security requirements

## Validation

Success metrics:

- Zero security incidents in first 6 months
- >80% of users stay on strict or standard mode
- Policy check latency <5ms p99
- Clear audit trail for all actions
- Positive feedback about security approach

Results after 4 months:

- ✅ Zero security incidents reported
- ✅ 87% of users on strict (62%) or standard (25%)
- ✅ Policy check latency: p99 = 2.3ms
- ✅ Audit logs successfully used to debug issues
- ✅ Security praised in user surveys: "I actually trust this"
- ⚠️ Some users confused by strict mode restrictions initially (improved docs)

## References

- [OWASP Top 10 for LLMs](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
- [Defense in Depth](https://en.wikipedia.org/wiki/Defense_in_depth_(computing))
- [Container Security Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- Discussion: [Issue #7 - Security Model](https://github.com/Nacho-Labs-LLC/nachos/issues/7)

## Notes

This decision was heavily influenced by the Log4Shell and other supply chain attacks. The insight: convenience is not worth the risk for systems that handle sensitive data and execute code.

Key philosophical point: **Security is not a feature you add later; it's a foundation you build on.**

Trade-off accepted: Some users will bounce because strict mode requires configuration. This is acceptable because users who stick around will be more satisfied and trust the platform more.

Future enhancements:

- Visual security dashboard showing active permissions
- Temporal permissions (grant access for 1 hour)
- Per-conversation security modes
- Security audit reports
