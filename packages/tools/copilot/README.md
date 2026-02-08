# GitHub Copilot CLI Tool

A secure, modular tool for Nachos that provides safe access to GitHub Copilot CLI.

## Features

- **SecurityTier: RESTRICTED (3)** - Requires explicit user approval for every invocation
- **Strict Guardrails**:
  - CLI presence and authentication validation
  - Prompt length limits (1-4000 characters)
  - Output size limits (50KB max)
  - Timeout enforcement (5-60 seconds)
- **Comprehensive Error Handling** - All failure modes mapped to actionable error codes
- **Full Audit Trail** - Every invocation logged with policy decision
- **Graceful Fallback** - Clear guidance when CLI unavailable

## Installation

### Prerequisites

1. Install GitHub CLI:
   ```bash
   # macOS
   brew install gh

   # Linux (Debian/Ubuntu)
   sudo apt install gh

   # Windows
   winget install --id GitHub.cli
   ```

2. Install GitHub Copilot CLI extension:
   ```bash
   gh extension install github/gh-copilot
   ```

3. Authenticate with GitHub:
   ```bash
   gh auth login
   ```

### Adding to Nachos

```bash
nachos add tool copilot
nachos up
```

## Usage

The tool supports four operation modes:

### 1. Explain Mode
Ask Copilot to explain code concepts or specific syntax.

**Parameters:**
```typescript
{
  prompt: "Explain how async/await works in JavaScript",
  mode: "explain"
}
```

### 2. Suggest Mode
Get code suggestions from Copilot.

**Parameters:**
```typescript
{
  prompt: "Write a function to validate email addresses",
  mode: "suggest"
}
```

### 3. Review Mode
Request code review feedback from Copilot.

**Parameters:**
```typescript
{
  prompt: "Review this authentication function for security issues",
  mode: "review"
}
```

### 4. General Mode (Default)
General-purpose Copilot queries.

**Parameters:**
```typescript
{
  prompt: "How do I handle rate limiting in API calls?",
  mode: "general"  // or omit for default
}
```

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Question or prompt to send to Copilot (1-4000 chars) |
| `mode` | enum | No | `general` | Operation mode: `explain`, `suggest`, `review`, `general` |
| `allowSensitive` | boolean | No | `false` | Reserved for future sensitive-data gating |
| `timeout` | number | No | `30` | Timeout in seconds (5-60) |
| `allowWrite` | boolean | No | `false` | Future use: Allow file write suggestions |
| `allowExec` | boolean | No | `false` | Future use: Allow execution suggestions |
| `allowNetwork` | boolean | No | `false` | Future use: Allow network operation suggestions |

## Security

### Security Tier: RESTRICTED (3)

All Copilot tool invocations require explicit user approval via the approval flow:

```
User: @nachos explain async/await
Nachos: 🔐 Approval Required
        Tool: copilot
        Parameters: { prompt: "explain async/await", mode: "explain" }
        Request ID: approval-abc123

        To approve: /approve approval-abc123
        To deny: /deny approval-abc123

User: /approve approval-abc123
Nachos: [Copilot response]
```

### Security Layers

1. **Policy Checks** - Salsa policy engine validates against security mode rules
2. **User Approval** - Explicit approval required for every execution
3. **Rate Limiting** - Standard rate limits (15 calls/min in standard mode)
4. **Audit Logging** - Every execution logged with outcome and policy decision

### Policy Configuration

**Strict Mode:** Copilot disabled entirely
**Standard Mode:** Requires user approval (default)
**Permissive Mode:** Requires user approval (same as standard)

`allowSensitive` is reserved for future sensitive-data gating.

## Error Handling

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `CLI_NOT_FOUND` | GitHub CLI or Copilot extension not installed | Run: `gh extension install github/gh-copilot` |
| `CLI_NOT_AUTHENTICATED` | GitHub CLI not authenticated | Run: `gh auth login` |
| `TIMEOUT` | Execution exceeded timeout limit | Increase timeout parameter or simplify prompt |
| `RATE_LIMIT` | GitHub API rate limit exceeded | Wait and try again later |
| `OUTPUT_TOO_LARGE` | Response exceeded 50KB limit | Simplify prompt or request shorter response |
| `EXECUTION_ERROR` | Generic execution failure | Check stderr in error details |

## Environment Variables

Configure the tool via environment variables:

```bash
# Maximum prompt length in characters (default: 4000)
MAX_PROMPT_LENGTH=4000

# Maximum output size in bytes (default: 50000)
MAX_OUTPUT_SIZE=50000

# Default timeout in seconds (default: 30)
DEFAULT_TIMEOUT_SEC=30

# Maximum timeout in seconds (default: 60)
MAX_TIMEOUT_SEC=60

# Optional: GitHub token (overrides gh CLI stored auth)
GH_TOKEN=ghp_xxx

# Security mode
SECURITY_MODE=standard
```

## Audit Events

Every tool invocation generates an audit event:

```typescript
{
  eventType: 'tool_call',
  action: 'tool.copilot.execute',
  resource: 'copilot',
  outcome: 'allowed' | 'denied' | 'error',
  reason: 'User approved',
  policyMatched: 'copilot-standard-allow',
  details: {
    mode: 'explain',
    promptLength: 256,
    timeout: 30,
    allowSensitive: false,
    executionTimeMs: 1234,
    exitCode: 0,
    truncated: false
  }
}
```

## Troubleshooting

### Tool shows as unavailable

Check CLI installation:
```bash
gh --version
gh extension list | grep copilot
```

### Authentication failures

Re-authenticate:
```bash
gh auth logout
gh auth login
```

### Rate limit errors

GitHub API has rate limits. Wait 10-15 minutes before retrying, or check your rate limit status:
```bash
gh api rate_limit
```

### Container permissions

Ensure the container has network egress access to GitHub domains:
- api.github.com
- github.com
- *.github.com

## Development

### Building

```bash
cd packages/tools/copilot
pnpm install
pnpm build
```

### Testing

```bash
pnpm test
```

### Docker Build

```bash
docker build -t nachos-copilot:dev .
```

## License

See the main Nachos LICENSE file.
