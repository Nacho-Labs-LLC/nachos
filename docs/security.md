# Security Guide

Nachos is designed with security-first defaults. This guide explains the security model, available modes, and best practices for safe deployment.

---

## Security Modes

Nachos has three security modes, set via `security.mode` in `nachos.toml`:

### `strict` (default)
- Only allowlisted tools enabled
- No shell access
- Pairing required for DMs
- Recommended for production

### `standard`
- Common tools enabled (file inspection, network debugging, git read)
- Pairing-based DMs
- Balanced security for trusted environments

### `permissive`
- All tools available, including shell
- Use only in air-gapped or fully trusted environments

```toml
[security]
mode = "standard"  # strict | standard | permissive
```

---

## Shell Tool Security

When the shell tool is enabled (`mode = "permissive"` or explicit config), Nachos enforces:

1. **Binary allowlist** — only registered binaries can be executed
2. **Direct process spawning** — no shell interpreter, eliminating injection attacks
3. **Subcommand filtering** — e.g., `git status` is allowed, `git push` is not
4. **Resource limits** — 30s timeout (configurable, max 5min), 100KB output cap
5. **Audit logging** — all executions logged to `/var/log/nachos/shell-audit.log`

See [ADR-002](adr/002-shell-tool-security-model.md) for the full rationale.

**What's blocked by default:**
- Destructive ops: `rm`, `mv`, `chmod`, `chown`
- Shell execution: `bash`, `sh`, `eval`
- Package managers: `npm install`, `apt-get`, `pip`
- Write ops: `git push`, `git commit`, `docker stop`, `docker rm`

---

## Network Isolation

Nachos runs in an isolated Docker network by default. Containers cannot reach each other unless explicitly linked. The gateway is the only externally-exposed service.

```yaml
# docker-compose.yml (enforced)
networks:
  nachos-internal:
    internal: true  # no external routing
```

To allow outbound access (e.g., for web browsing tools), set `security.mode = "standard"` or add explicit network policies.

---

## Credential Handling

**Rules:**
- Never put API keys or tokens in `nachos.toml`. Use `.env` or environment variables.
- `.env` is in `.gitignore` — do not commit it.
- Tokens referenced as `${ENV_VAR}` in config are resolved at startup.

```toml
# Good — reference from environment
[[channels]]
type = "discord"
token = "${DISCORD_TOKEN}"

# Bad — hardcoded secret
[[channels]]
type = "discord"
token = "MTAzN..."  # Never do this
```

---

## Pairing and DMs

Direct Messages to the bot are gated by the pairing system. A user must complete a pairing handshake before they can send private messages.

- `security.mode = "strict"`: Pairing always required for DMs
- `security.mode = "standard"`: Pairing required for DMs (same)
- `security.mode = "permissive"`: Pairing optional (configurable)

---

## Audit Logging

All tool executions and config changes are logged. Log locations:

| Event | Log path |
|---|---|
| Shell commands | `/var/log/nachos/shell-audit.log` |
| Gateway events | Docker logs (`docker compose logs gateway`) |
| Config loads | Gateway startup logs |

---

## Security Checklist for Production

- [ ] `security.mode = "strict"` or `standard`
- [ ] API keys in `.env`, not in `nachos.toml`
- [ ] Docker network isolation enabled (default)
- [ ] Audit logs forwarded to persistent storage
- [ ] DM pairing enabled
- [ ] Shell tool disabled unless explicitly needed

---

## Reporting Vulnerabilities

Please do not open public GitHub issues for security vulnerabilities. Email the maintainers directly or use GitHub's private security advisory feature.

---

## Further Reading

- [ADR-002: Shell Tool Security Model](adr/002-shell-tool-security-model.md)
- [Configuration Reference](configuration.md)
- [Architecture Deep Dive](architecture.md)
