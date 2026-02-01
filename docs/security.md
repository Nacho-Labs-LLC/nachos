# Security Guide

**Status**: Draft - Coming Soon

Comprehensive guide to Nachos security features and best practices.

## Contents

- [Security Philosophy](#security-philosophy)
- [Security Modes](#security-modes)
- [Container Security](#container-security)
- [Network Isolation](#network-isolation)
- [Policy Engine](#policy-engine)
- [Secrets Management](#secrets-management)
- [Best Practices](#best-practices)

## Security Philosophy

Nachos is designed with security as a foundational principle, not an afterthought.

Key principles:

1. **Deny by default** - Everything locked down initially
2. **Explicit grants** - Permissions must be explicitly enabled
3. **Defense in depth** - Multiple security layers
4. **Least privilege** - Containers run with minimal permissions
5. **Transparency** - All security decisions are auditable

See [ADR-003: Security-First Design](./adr/003-security-first-design.md) for detailed rationale.

## Security Modes

Nachos provides three security presets:

### 🔒 Strict Mode (Default)

- All tools disabled by default
- Only allowlisted DMs
- Full audit logging
- Rate limits enforced
- DLP scanning enabled
- No network egress for tools
- Read-only filesystem access

**Best for**: First-time users, sensitive environments

### ⚖️ Standard Mode

- Common tools enabled (browser, filesystem read)
- Pairing-based DM approval
- Audit logging
- Reasonable rate limits
- Controlled filesystem access (./workspace only)
- Limited network egress

**Best for**: Personal use, trusted environments

### 🔓 Permissive Mode

- Most tools enabled
- DMs allowed by default
- Minimal audit logging
- Higher rate limits
- Broader filesystem access
- Broader network access

**Best for**: Development, power users (requires explicit opt-in)

## Container Security

_Coming soon - detailed container security features_

- Non-root users
- Read-only filesystems
- Dropped capabilities
- Resource limits
- Security scanning

## Network Isolation

_Coming soon - network security architecture_

- Internal network (no internet access)
- Egress network (controlled external access)
- Firewall rules
- Domain allowlists

See [Architecture Documentation](./architecture.md) for network topology.

## Policy Engine

_Coming soon - Salsa policy engine details_

The policy engine (Salsa) evaluates all actions against security rules.

See [Policy API](./api/policy-api.md) for implementation details.

## Secrets Management

_Coming soon - secrets and credentials management_

- Environment variable injection
- Encrypted storage
- Secret rotation
- Audit logging

## Best Practices

_Coming soon - security best practices_

1. Start with strict mode
2. Only enable tools you need
3. Review audit logs regularly
4. Keep containers updated
5. Use allowlists for DMs
6. Limit filesystem access
7. Review security policies

---

**Note**: Security is actively being implemented. Check back for updates or see [TECHNICAL_SPEC.md](./TECHNICAL_SPEC.md) for technical details.
