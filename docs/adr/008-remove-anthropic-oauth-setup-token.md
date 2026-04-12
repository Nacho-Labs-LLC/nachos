# ADR-008: Remove Anthropic OAuth Setup-Token Support

## Status

Accepted (2026-04-12)

## Context

During the multi-provider implementation, Nachos included support for Anthropic
OAuth tokens (`sk-ant-oat01-*`) — sometimes referred to as "setup tokens". These
are OAuth bearer tokens issued by Anthropic to Claude Pro/Max subscription users
via the `claude setup-token` CLI command.

The feature included:

- `AnthropicAdapter.getClient()` detecting OAuth tokens and switching to Bearer
  auth with Claude Code identity headers (`anthropic-beta: claude-code-20250219`,
  `user-agent: claude-cli/2.1.2`, `x-app: cli`)
- `nachos auth setup-token` CLI command for configuring OAuth profiles
- `ANTHROPIC_SETUP_TOKEN` / `CLAUDE_SETUP_TOKEN` environment variable fallbacks
- Doctor check validation for setup-token format

The intent was to let Claude subscription users avoid paying for API credits by
routing through their subscription.

## Problem

OAuth setup tokens issued by Anthropic to Claude Code are issued for use by
Claude Code specifically. Using them in third-party applications:

1. Violates Anthropic's Terms of Service — the tokens are scoped to the Claude
   Code product, and using them in another product masquerades as that product.
2. Requires impersonating Claude Code's `user-agent` and `x-app` headers, which
   is deceptive.
3. Creates account risk for users — Anthropic may revoke tokens or accounts if
   they detect misuse.

This was raised as a terms-of-use violation that needed to be corrected before
shipping.

## Decision

**Remove all setup-token / OAuth support from Nachos.**

Specifically:

- `isOAuthToken()` function removed from `anthropic.ts`
- `OAUTH_HEADERS` constant (Claude Code identity headers) removed
- Bearer auth branch in `AnthropicAdapter.getClient()` removed
- `ANTHROPIC_SETUP_TOKEN` / `CLAUDE_SETUP_TOKEN` env fallback in
  `resolveApiKey()` removed
- `nachos auth setup-token` CLI command removed
- Setup-token validation in `nachos doctor` env check removed
- All documentation references updated to use `ANTHROPIC_API_KEY`

Users who want to use Anthropic with Nachos must use a proper API key obtained
from [console.anthropic.com](https://console.anthropic.com).

## Consequences

### Positive

1. **ToS compliance**: Nachos no longer facilitates misuse of Anthropic's OAuth
   token system.
2. **Reduced attack surface**: Fewer auth code paths = fewer places for bugs.
3. **Cleaner UX**: Only one auth path for Anthropic (API key). Simpler docs,
   simpler CLI.

### Negative

1. **Subscription users must purchase API credits**: Users who relied on setup
   tokens to avoid API costs need to either buy API credits or switch to a
   free/cheaper provider (e.g., Ollama for local, Gemini for free tier).
2. **Migration needed for existing configs**: Any `nachos.toml` with an
   `ANTHROPIC_SETUP_TOKEN` profile will silently fail — the env var just won't
   be found. Users will see "Anthropic API key missing" errors.

### Migration Path

For any user who had setup-token configured:

```diff
 [[llm.profiles]]
 name = "anthropic-primary"
 provider = "anthropic"
-api_key_env = "ANTHROPIC_SETUP_TOKEN"
+api_key_env = "ANTHROPIC_API_KEY"
```

```diff
 # .env
-ANTHROPIC_SETUP_TOKEN="sk-ant-oat01-..."
+ANTHROPIC_API_KEY="sk-ant-api03-..."
```

Alternatively, switch to another provider:

```toml
[llm]
provider = "ollama"
model = "llama3.2"
base_url = "http://host.docker.internal:11434"
```

## References

- PR: `feat/llm-multi-provider`
- `packages/core/llm-proxy/src/adapters/anthropic.ts`
- `packages/cli/src/commands/auth/` (setup-token.ts deleted)
- `docs/guides/provider-switching.md`
