# Nachos Policy System

The Salsa policy engine provides security controls for the Nachos AI assistant framework. This document explains how to write and use policies.

## Overview

Policies are defined in YAML files and control access to resources (tools, channels, DMs, filesystem, network). The policy engine evaluates every action against loaded rules in priority order, applying the first matching rule's effect (allow or deny).

## Policy Schema

### Basic Structure

```yaml
version: "1.0"

metadata:
  name: "My Security Policy"
  description: "Custom policies for my deployment"
  mode: "standard"  # strict | standard | permissive

rules:
  - id: "unique-rule-id"
    description: "Human-readable description"
    priority: 100  # Higher priority = evaluated first
    match:
      resource: "tool"  # What resource type
      resourceId: "browser"  # Specific resource (optional)
      action: "read"  # What action
    conditions:  # Optional additional conditions
      - field: "security_mode"
        operator: "equals"
        value: "standard"
    effect: "allow"  # allow | deny
    reason: "Reason for denial (if deny)"
```

### Resource Types

- `tool` - Tool access (browser, shell, filesystem, etc.)
- `channel` - Channel messages
- `dm` - Direct messages
- `filesystem` - File system operations
- `network` - Network access
- `llm` - LLM API calls

### Action Types

- `read` - Read operations
- `write` - Write operations
- `execute` - Execution operations
- `send` - Send messages
- `receive` - Receive messages
- `call` - API/function calls

### Condition Operators

- `equals` - Exact match
- `not_equals` - Not equal
- `in` - Value in array
- `not_in` - Value not in array
- `contains` - String contains substring
- `matches` - Regular expression match
- `starts_with` - String starts with
- `ends_with` - String ends with

### Condition Fields

Common fields available for conditions:

- `security_mode` - Current security mode (strict, standard, permissive)
- `user_id` - User making the request
- `session_id` - Session ID
- `resource_type` - Type of resource being accessed
- `resource_id` - Specific resource identifier
- `action` - Action being performed
- `metadata.*` - Any metadata field (e.g., `metadata.path`, `metadata.is_paired`)

## Security Modes

Nachos provides three default security modes:

### Strict Mode (Maximum Security)

- All tools disabled by default
- Only allowlisted DMs
- No filesystem or network access
- Best for high-security environments

### Standard Mode (Balanced)

- Common tools enabled (browser, web search)
- Filesystem access restricted to workspace
- Pairing required for DMs
- Recommended for most users

### Permissive Mode (Maximum Flexibility)

- Most tools enabled
- Broader filesystem access
- DMs allowed by default
- Requires explicit opt-in

## Example Policies

### Allow Browser Access in Standard Mode

```yaml
rules:
  - id: "allow-browser-standard"
    priority: 100
    match:
      resource: "tool"
      resourceId: "browser"
      action: "read"
    conditions:
      - field: "security_mode"
        operator: "in"
        value: ["standard", "permissive"]
    effect: "allow"
```

### Restrict Filesystem to Workspace

```yaml
rules:
  - id: "allow-workspace-write"
    priority: 200
    match:
      resource: "filesystem"
      action: "write"
    conditions:
      - field: "metadata.path"
        operator: "starts_with"
        value: "./workspace"
    effect: "allow"

  - id: "deny-filesystem-outside"
    priority: 199
    match:
      resource: "filesystem"
    effect: "deny"
    reason: "Filesystem access restricted to workspace directory"
```

### Allow DMs from Paired Users

```yaml
rules:
  - id: "allow-paired-dms"
    priority: 300
    match:
      resource: "dm"
      action: "send"
    conditions:
      - field: "metadata.is_paired"
        operator: "equals"
        value: true
    effect: "allow"

  - id: "deny-unpaired-dms"
    priority: 299
    match:
      resource: "dm"
    effect: "deny"
    reason: "DMs require pairing"
```

### Allow Specific Users

```yaml
rules:
  - id: "allow-admin-users"
    priority: 500
    match:
      resource: "tool"
      resourceId: "shell"
    conditions:
      - field: "user_id"
        operator: "matches"
        value: "^admin-.*"
    effect: "allow"
```

## Policy Loading

### Directory Structure

Place policy files in the `/app/policies` directory (configurable via `POLICY_PATH` environment variable):

```
/app/policies/
  ├── strict.yaml      # Strict mode policies
  ├── standard.yaml    # Standard mode policies
  ├── permissive.yaml  # Permissive mode policies
  └── custom.yaml      # Your custom policies
```

### Hot Reload

The policy engine watches for file changes and automatically reloads policies without restarting the Gateway. This is enabled by default but can be disabled with `POLICY_HOT_RELOAD=false`.

### Loading Priority

Rules are evaluated by priority (highest first). If multiple policy files define rules with the same priority, they are loaded in alphabetical filename order.

## Configuration

### Environment Variables

- `POLICY_PATH` - Path to policy files directory (default: `/app/policies`)
- `SECURITY_MODE` - Security mode (strict | standard | permissive, default: standard)
- `POLICY_HOT_RELOAD` - Enable hot reload (default: true)

### Docker Compose

```yaml
services:
  gateway:
    environment:
      - SECURITY_MODE=standard
      - POLICY_PATH=/app/policies
      - POLICY_HOT_RELOAD=true
    volumes:
      - ./policies:/app/policies:ro
```

### nachos.toml

```toml
[security]
mode = "standard"  # strict | standard | permissive

[security.policy]
path = "./policies"
hot_reload = true
```

## Performance

The policy engine is designed for <1ms evaluation time:

- Rules are sorted by priority on load
- First matching rule terminates evaluation
- Condition evaluation is optimized
- No network calls during evaluation

## Validation

Policy files are validated on load. Validation errors are logged but don't prevent startup. Use the health endpoint to check for validation errors:

```bash
curl http://localhost:8081/health
```

Response includes policy status:

```json
{
  "status": "healthy",
  "salsa": {
    "policiesLoaded": 3,
    "rulesActive": 25,
    "hasErrors": false
  }
}
```

## Best Practices

1. **Use descriptive rule IDs** - Makes debugging easier
2. **Add descriptions** - Document intent for future maintainers
3. **Order by priority** - Higher priority = more specific rules
4. **Test policies** - Verify rules work as expected
5. **Start strict** - Easier to relax than tighten security
6. **Version control** - Track policy changes
7. **Review regularly** - Audit policies periodically

## Troubleshooting

### Rules not matching

- Check priority order - higher priority rules are evaluated first
- Verify condition fields exist in request metadata
- Check for typos in resource types, action types, or operators
- Enable debug logging to see evaluation details

### Validation errors

- Check YAML syntax
- Verify all required fields are present
- Ensure enums match valid values
- Look for duplicate rule IDs

### Performance issues

- Reduce number of rules if possible
- Optimize condition evaluation
- Use more specific match criteria
- Consider combining related rules

## Security Considerations

- **Default deny** - If no rule matches, access is denied
- **Fail closed** - Evaluation errors result in denial
- **Audit logging** - All policy decisions are logged
- **Least privilege** - Grant minimum necessary permissions
- **Defense in depth** - Combine with container isolation, network policies, etc.

## Advanced Topics

### Custom Metadata

Pass custom metadata in security requests for fine-grained control:

```typescript
const result = gateway.evaluatePolicy({
  requestId: 'req-123',
  userId: 'user-456',
  sessionId: 'session-789',
  securityMode: 'standard',
  resource: { type: 'tool', id: 'custom-tool' },
  action: 'execute',
  metadata: {
    custom_field: 'value',
    risk_score: 0.75,
  },
  timestamp: new Date(),
})
```

Then reference in policies:

```yaml
conditions:
  - field: "metadata.risk_score"
    operator: "less_than"
    value: 0.5
```

### Multiple Policy Files

Load policies from multiple files for better organization:

```
/app/policies/
  ├── 00-base.yaml       # Base rules (priority 1000+)
  ├── 10-tools.yaml      # Tool-specific rules
  ├── 20-channels.yaml   # Channel rules
  └── 99-overrides.yaml  # Local overrides
```

Files are loaded in alphabetical order, rules are then sorted by priority.

## Further Reading

- [ADR-003: Security-First Design](../docs/adr/003-security-first-design.md)
- [ADR-004: Embedded Salsa](../docs/adr/004-embedded-salsa-shardable-gateway.md)
- [Security Configuration](../docs/configuration.md#security)
