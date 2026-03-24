# ADR-002: Shell Tool Security Model

## Status

Accepted (2026-02-24)

## Context

The shell tool enables the LLM to execute CLI commands for debugging,
inspection, and skill-based operations. This creates significant security risk
if not properly constrained. We needed to choose between different security
models.

### Options Considered

1. **Full Sandbox (Docker/VM isolation)**
   - Pros: Maximum security, true isolation
   - Cons: High complexity, resource overhead, limits functionality (can't
     inspect host system)

2. **Shell Script Parsing + Validation**
   - Pros: Flexible, could block patterns
   - Cons: Complex, brittle, easily bypassed, shell injection risks

3. **Binary Allowlist + Direct Process Spawning**
   - Pros: Simple, auditable, no shell injection possible
   - Cons: Limited flexibility, requires tool registration

4. **Policy-Based (SELinux/AppArmor)**
   - Pros: Kernel-level enforcement
   - Cons: OS-dependent, complex setup, overkill for this use case

## Decision

Use **Binary Allowlist + Direct Process Spawning** (Option 3) with multi-layer
enforcement.

### Architecture

```typescript
// Layer 1: Allowlist check (fast rejection)
isCommandAllowed(command: string): boolean {
  const binaries = extractCommandBins(command);
  return binaries.every(bin => this.allowedTools.has(bin));
}

// Layer 2: Subcommand validation (at execution time)
validateSubcommand(bin: string, args: string[]): boolean {
  const config = this.allowedTools.get(bin);
  if (config.blockedSubcommands?.includes(args[0])) {
    return false; // e.g., 'git push' blocked
  }
  if (config.allowedSubcommands) {
    return config.allowedSubcommands.includes(args[0]);
  }
  return true;
}

// Layer 3: Direct process spawn (no shell)
spawn(binary, args, { shell: false });
```

### Tool Groups

Commands organized into security domains:

- `file-inspection` (ls, cat, find) - read-only
- `text-processing` (grep, awk, sed) - read-only
- `network-debug` (ping, curl, dig) - read-only
- `git` (status, log, diff) - read-only subcommands only
- `docker-inspect` (ps, logs, inspect) - read-only subcommands only

## Consequences

### Positive

1. **No Shell Injection**: Direct process spawning eliminates entire class of
   vulnerabilities
   - No: `$(rm -rf /)`, `` `malicious` ``, `${VAR}`, `<(cmd)`, `>(cmd)`
   - Shell metacharacters treated as literal arguments

2. **Auditable**: Simple allowlist, easy to review
   - `getAllowedBinaries()` returns full list
   - Tool groups map to policy enforcement

3. **Granular Control**: Subcommand filtering for complex tools
   - `git status` ✅ allowed
   - `git push` ❌ blocked at execution time

4. **Resource Limits**: Built-in protection
   - Output size limit: 100KB (prevents memory exhaustion)
   - Timeout enforcement: 30s default, 5min max
   - Process isolation: child process tree

5. **Low Overhead**: No container/VM overhead, fast execution

### Negative

1. **Limited Flexibility**: Can't execute arbitrary commands
   - Workaround: Add tool to allowlist via config

2. **Pipe/Redirect Complexity**: Requires custom parsing
   - Implemented: `splitCommandSegments()` for pipes, `&&`, `||`, `;`
   - Trade-off: Complexity vs functionality

3. **False Sense of Security**: Allowlist doesn't prevent all risks
   - Example: `curl https://evil.com` is allowed (network-debug group)
   - Mitigation: Audit logging (see ADR consequences below)

### Security Boundaries

**What's Blocked:**

- Destructive operations: rm, mv, chmod, chown
- Shell execution: bash, sh, eval
- Package managers: npm install, apt-get, pip
- Write operations: git push/commit, docker stop/rm

**What's Allowed (with caveats):**

- Network access: curl, wget (potential SSRF, but needed for debugging)
- Git read: status, log, diff (safe)
- Docker read: ps, logs, inspect (safe)
- Process inspection: ps, top (safe)

### Risk Acceptance

We accept these residual risks:

1. **SSRF via curl/wget**: Needed for debugging, output logged for audit
2. **Information Disclosure**: `cat /etc/passwd` allowed (read-only files,
   container context)
3. **Resource Exhaustion**: `find / -name "*"` could run long (mitigated by
   timeout)

## Implementation Notes

### Subcommand Validation Happens at Execution

Key design: `isCommandAllowed()` only checks binary allowlist, NOT subcommands.

```typescript
// Returns true (git is in allowlist)
shellTool.isCommandAllowed('git push');

// But execute() rejects:
await shellTool.execute({ command: 'git push' });
// → ExitCode 1, stderr: "Subcommand 'push' not allowed"
```

**Rationale**: Separation of concerns

- `isCommandAllowed()`: Fast allowlist check (used for validation before
  queueing)
- `execute()`: Full validation including subcommands, env vars, resource checks

### Audit Logging

Per ADR-002 consequences, audit logging added:

```typescript
// All command executions logged to file + structured logs
await fs.appendFile(
  '/var/log/nachos/shell-audit.log',
  JSON.stringify({
    timestamp: Date.now(),
    user: context.userId,
    command: params.command,
    toolGroup: getToolGroup(command),
    exitCode: result.exitCode,
    duration: result.duration,
  }) + '\n'
);
```

Purpose:

- Post-incident forensics
- Compliance auditing
- Detecting abuse patterns (e.g., repeated SSRF attempts)

## Alternatives Revisited

If security requirements increase:

1. **Add Sandbox Mode**: Docker-in-Docker for untrusted execution
2. **Network Policy**: Restrict outbound connections (k8s NetworkPolicy,
   iptables)
3. **Rate Limiting**: Max commands per minute per user
4. **Enhanced Logging**: Send to SIEM (Splunk, ELK) for alerting

## References

- PR #114: Debug utilities implementation
- `packages/core/gateway/src/tools/shell-tool.ts`
- `DEBUG_TOOLS.md`: Complete tool listing and security model
- CWE-78: OS Command Injection (what we prevent)
- CWE-918: SSRF (residual risk we accept)
