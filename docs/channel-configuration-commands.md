# Discord & Slack Native Configuration Commands Plan

## Research summary (OpenClaw)

Public OpenClaw documentation and guides describe native configuration and operational commands in-channel, alongside onboarding flows for Discord and Slack. Highlights include:

- **Discord**
  - Native slash commands for status/help and pairing/approval flows.
  - Guild/channel allowlists with optional mention-gating and per-server policies.
  - Direct message (DM) policies with pairing/allowlist options.
  - Configuration is surfaced through onboarding or commands to help operators avoid manual config edits.
- **Slack**
  - Onboarding commands (e.g., `openclaw channels login slack`) for token setup.
  - Socket mode by default, with HTTP events supported.
  - Channel/user restrictions (allowlists) and DM pairing workflows.
  - Native commands for status/config/pairing approvals.

**Sources consulted:**
- https://deepwiki.com/openclaw/openclaw/8.4-discord-integration
- https://docs.openclaw.ai/channels/discord
- https://docs.openclaw.ai/channels/slack
- https://markaicode.com/openclaw-slack-integration-guide/

## Current Nachos Discord & Slack capabilities

### Discord adapter (packages/channels/discord)

- Bot token from config or environment secrets.
- Message intake via `messageCreate` with DM pairing and allowlist support.
- Group policy enforcement (channel allowlist, user allowlist, mention gating).
- Attachment normalization to inbound schema.
- Outbound message send with attachment upload support.

**Not yet implemented:**
- Slash command registration and interaction handling.
- Native configuration commands for allowlists, mention gating, or pairing review.
- Permission/role-based admin checks for configuration actions.
- Dynamic config persistence (no config overlay or runtime update flow).

### Slack adapter (packages/channels/slack)

- Socket mode and HTTP events support via Slack Bolt.
- Message intake via `message` events with DM pairing and allowlist support.
- Group policy enforcement (channel allowlist, user allowlist, mention gating).
- Thread reply support via `thread_ts` for outbound responses.
- Attachment normalization to inbound schema and file uploads.

**Not yet implemented:**
- Slash command registration (`app.command`) for configuration commands.
- Native configuration commands for allowlists, mention gating, or pairing review.
- Permission/role-based admin checks for configuration actions.
- Dynamic config persistence (no config overlay or runtime update flow).

## Audit: gaps vs OpenClaw

1. **Native command surface**: OpenClaw exposes slash/command-based configuration and pairing approvals. Nachos only supports the DM `pair` keyword for pairing.
2. **Admin workflows**: OpenClaw includes onboarding and admin commands to set allowed channels/users. Nachos requires manual `nachos.toml` updates.
3. **Runtime updates**: OpenClaw applies changes without a full redeploy. Nachos config is loaded at startup only.
4. **Operational visibility**: OpenClaw provides status/ping commands. Nachos has no in-channel status checks.

## Plan: native configuration commands for Discord & Slack

### Phase 1 — Command surface + security model

- Define a **shared command schema** in `@nachos/shared-types` (e.g., `ChannelCommandRequest`, `ChannelCommandResponse`) with strict validation.
- Add a **channel command policy** in Salsa (`tool.channel.command.*`) to gate config changes.
- Define a **permissions contract** for each platform:
  - Discord: require `Administrator` or `ManageGuild` permissions.
  - Slack: require `admin`/`owner` or allowlist of user IDs.
- Establish a **command allowlist** in config (`channels.discord.commands.enabled`, `channels.slack.commands.enabled`).

### Phase 2 — Configuration storage + reload strategy

- Introduce a **runtime config overlay store** (e.g., `${RUNTIME_STATE_DIR}/channel-config-overrides.json`) that merges on top of `nachos.toml`.
- Add a **config update bus topic** (`nachos.config.update`) so channel adapters can request updates via the gateway.
- Ensure config updates are validated via existing config schemas and logged to audit providers.
- Provide CLI fallback: `nachos config apply --from-state` to persist overlay to `nachos.toml`.

### Phase 3 — Discord commands

- Register slash commands on startup (e.g., `/nachos status`, `/nachos allowlist add`, `/nachos allowlist remove`, `/nachos pairing approve`, `/nachos config show`).
- Reply with **ephemeral responses** for configuration actions.
- Enforce **guild scoping** so changes only affect the current server.
- Add audit logging for every config action with user + guild metadata.

### Phase 4 — Slack commands

- Register slash commands (`/nachos status`, `/nachos allowlist add`, `/nachos allowlist remove`, `/nachos pairing approve`, `/nachos config show`).
- Ensure `ack()` within 3 seconds and respond via ephemeral messages.
- Scope changes to the workspace (team ID) and channel.
- Add audit logging for every config action with user + workspace metadata.

### Phase 5 — Operational best practices

- Document required Slack scopes and Discord intents for command handling.
- Add rate limiting for config commands and error handling for invalid requests.
- Provide structured logs for command start/finish/denied actions.
- Extend tests:
  - Unit tests for command parsing and validation.
  - Adapter tests for permission checks and config overlay application.

## Open questions

- Should commands write to the runtime overlay only, or also patch `nachos.toml` directly?
- Should config commands be available in DMs or only in server/channel contexts?
- How should we handle multi-tenant deployments (multiple Discord guilds/Slack workspaces)?
