# Discord Adapter Feature Specification

This document specifies all 8 features of the Discord channel adapter. Each
feature lists its source location, test file, relevant config keys, and a
behavior table with test coverage status and line references.

---

## 13. Message Filtering

**Source**: `packages/channels/discord/src/index.ts` **Test**:
`packages/channels/discord/src/index.test.ts` **Config**:
`channels.discord.servers[].id`, `channels.discord.servers[].channel_ids`,
`channels.discord.servers[].user_allowlist`,
`channels.discord.servers[].mention_gating`

### Behaviors

| ID    | Behavior                                                                                                 | Tested | Reference         |
| ----- | -------------------------------------------------------------------------------------------------------- | ------ | ----------------- |
| MF-01 | Messages without a config are silently dropped                                                           | NO     | --                |
| MF-02 | Guild messages require a matching server config (via `findServerConfig`)                                 | NO     | --                |
| MF-03 | Guild messages are rejected if the channel is not in `channel_ids` allowlist                             | NO     | --                |
| MF-04 | Guild messages are rejected if the user is not in `user_allowlist`                                       | NO     | --                |
| MF-05 | When `mention_gating` is enabled, messages must mention the bot (`<@botId>` or `<@!botId>`)              | YES    | index.test.ts:99  |
| MF-06 | When `mention_gating` is disabled, allowlisted user messages pass without mention                        | NO     | --                |
| MF-07 | Messages without a userId (no author) are silently dropped                                               | NO     | --                |
| MF-08 | Messages passing all filters are published to `nachos.channel.discord.inbound`                           | YES    | index.test.ts:99  |
| MF-09 | Inbound payload includes `channelMessageId`, `sender`, `conversation`, `content`, and `metadata.guildId` | YES    | index.test.ts:134 |
| MF-10 | Server config lookup supports both `server.id` and `server.ids[]` array matching                         | NO     | --                |

---

## 14. DM Handling

**Source**: `packages/channels/discord/src/index.ts` **Test**:
`packages/channels/discord/src/index.test.ts` **Config**:
`channels.discord.dm.user_allowlist`, `channels.discord.dm.pairing`

### Behaviors

| ID    | Behavior                                                                                 | Tested | Reference         |
| ----- | ---------------------------------------------------------------------------------------- | ------ | ----------------- |
| DM-01 | DMs are identified when `message.guildId` is null                                        | YES    | index.test.ts:41  |
| DM-02 | DM policy is resolved from channel config `dm` field via `resolveDmPolicy`               | NO     | --                |
| DM-03 | Falls back to adapter-level `config.dmPolicy` when channel config DM policy is undefined | NO     | --                |
| DM-04 | DMs are dropped when no DM policy is configured at all                                   | NO     | --                |
| DM-05 | Users in `dm.user_allowlist` are allowed without pairing                                 | YES    | index.test.ts:41  |
| DM-06 | When pairing is enabled, the `pair <token>` command is parsed from message text          | YES    | index.test.ts:174 |
| DM-07 | Invalid pairing tokens receive a "Pairing token invalid." reply                          | YES    | index.test.ts:198 |
| DM-08 | Successful pairing stores the userId and replies "Pairing successful."                   | YES    | index.test.ts:208 |
| DM-09 | After pairing, subsequent messages from the paired user are published inbound            | YES    | index.test.ts:216 |
| DM-10 | Non-allowlisted, non-paired users have their DMs silently dropped                        | YES    | index.test.ts:206 |
| DM-11 | Inbound DM payload sets `conversation.type` to `'dm'`                                    | YES    | index.test.ts:73  |

---

## 15. Status Emoji Reactions

**Source**: `packages/channels/discord/src/status-reactions.ts` **Test**: _No
dedicated test file exists_ **Config**: `channels.discord.status_emojis.enabled`

### Behaviors

| ID    | Behavior                                                                                                          | Tested | Reference |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------ | --------- |
| SR-01 | Status reactions are only active when `status_emojis.enabled` is true                                             | NO     | --        |
| SR-02 | Thinking status applies the brain emoji (U+1F9E0) to the user's message                                           | NO     | --        |
| SR-03 | Tool status resolves to a specialized emoji based on tool name category                                           | NO     | --        |
| SR-04 | Coding tools (`exec`, `process`, `read`, `write`, `edit`, `session_status`, `bash`) use the laptop emoji          | NO     | --        |
| SR-05 | Web tools (`web_search`, `web-search`, `web_fetch`, `web-fetch`, `browser`) use the globe emoji                   | NO     | --        |
| SR-06 | Unknown tools use the generic wrench emoji                                                                        | NO     | --        |
| SR-07 | Done status applies check-mark emoji, holds for 1500ms, then removes it                                           | NO     | --        |
| SR-08 | Error status applies X emoji, holds for 2500ms, then removes it                                                   | NO     | --        |
| SR-09 | Phase emoji changes are debounced by 700ms to avoid reaction spam                                                 | NO     | --        |
| SR-10 | Previous phase emoji is removed when a new phase emoji is applied                                                 | NO     | --        |
| SR-11 | Soft stall timer fires at 10s and applies hourglass emoji                                                         | NO     | --        |
| SR-12 | Hard stall timer fires at 30s and applies warning emoji                                                           | NO     | --        |
| SR-13 | Stall timers are reset on each new phase change                                                                   | NO     | --        |
| SR-14 | Controllers are keyed by `channelMessageId` so each message has independent reactions                             | NO     | --        |
| SR-15 | Controller subscribes to `status.thinking`, `status.tool`, `status.done`, `status.error` topics with `*` wildcard | NO     | --        |
| SR-16 | `finish()` removes active emoji and marks controller as finished                                                  | NO     | --        |
| SR-17 | All Discord API errors in reaction operations are caught and logged as warnings                                   | NO     | --        |

---

## 16. Typing Indicators

**Source**: `packages/channels/discord/src/index.ts` **Test**:
`packages/channels/discord/src/index.test.ts` **Config**:
`channels.discord.typing_indicators`

### Behaviors

| ID    | Behavior                                                                                                | Tested | Reference         |
| ----- | ------------------------------------------------------------------------------------------------------- | ------ | ----------------- |
| TI-01 | Typing indicators are enabled by default (only disabled when `typing_indicators` is explicitly `false`) | NO     | --                |
| TI-02 | A `thinking` status event starts the typing indicator for the channel                                   | YES    | index.test.ts:234 |
| TI-03 | `sendTyping()` is called immediately on the first thinking event                                        | YES    | index.test.ts:265 |
| TI-04 | Typing is re-sent every 8 seconds via interval (Discord typing lasts 10s)                               | YES    | index.test.ts:268 |
| TI-05 | A `done` status event stops the typing interval for the channel                                         | YES    | index.test.ts:277 |
| TI-06 | An `error` status event stops the typing interval for the channel                                       | NO     | --                |
| TI-07 | If already typing on a channel, a duplicate thinking event does not restart the interval                | NO     | --                |
| TI-08 | If `sendTyping()` fails, the interval is stopped for that channel and a warning is logged               | NO     | --                |
| TI-09 | `stop()` clears all active typing intervals across all channels                                         | YES    | index.test.ts:327 |
| TI-10 | Typing indicator only fires if the channel supports `sendTyping` method                                 | NO     | --                |

---

## 17. Outbound Messages

**Source**: `packages/channels/discord/src/index.ts` **Test**:
`packages/channels/discord/src/index.test.ts` **Config**: _None (uses bus
subscription on `nachos.channel.discord.outbound`)_

### Behaviors

| ID    | Behavior                                                                                                      | Tested | Reference         |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------ | ----------------- |
| OM-01 | Outbound messages fetch the target channel by `conversationId`                                                | YES    | index.test.ts:95  |
| OM-02 | Text content is sent via `channel.send({ content })`                                                          | YES    | index.test.ts:96  |
| OM-03 | Base64-encoded attachment data is decoded to Buffer before sending                                            | YES    | index.test.ts:142 |
| OM-04 | Uint8Array attachment data is converted to Buffer                                                             | NO     | --                |
| OM-05 | Fallback converts unknown attachment data to string then Buffer                                               | NO     | --                |
| OM-06 | Attachment name defaults to `'attachment'` when not provided                                                  | NO     | --                |
| OM-07 | Attachments array is passed as `files` in the send options                                                    | YES    | index.test.ts:167 |
| OM-08 | When `replyToMessageId` is set, `reply.messageReference` is included                                          | NO     | --                |
| OM-09 | Returns `{ success: true, messageId }` on successful send                                                     | YES    | index.test.ts:94  |
| OM-10 | Returns `{ success: false, error }` with `discord_channel_not_found` when channel is missing or has no `send` | NO     | --                |
| OM-11 | Returns `{ success: false, error }` with retryable flag on Discord API errors                                 | NO     | --                |
| OM-12 | Throws `InvalidStateError` if adapter is not initialized (no client)                                          | NO     | --                |
| OM-13 | Subscribes to `nachos.channel.discord.outbound` topic on `start()`                                            | NO     | --                |

---

## 18. Slash Commands

**Source**: `packages/channels/discord/src/index.ts` **Test**: _No slash command
tests exist_ **Config**: `channels.discord.commands.enabled`,
`channels.discord.commands.admin_allowlist`

### Behaviors

| ID    | Behavior                                                                                                                           | Tested | Reference |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- |
| SC-01 | Slash commands are registered globally via `client.application.commands.set()` on start                                            | NO     | --        |
| SC-02 | Registration is skipped when `commands.enabled` is empty                                                                           | NO     | --        |
| SC-03 | Only the `/nachos` top-level command is registered, with subcommands                                                               | NO     | --        |
| SC-04 | Supported subcommands: `status`, `help`, `config show`, `session reset`, `context on/off/status/auto`, `approve id/all`, `deny id` | NO     | --        |
| SC-05 | Commands are denied with audit log when `enabled` list is empty                                                                    | NO     | --        |
| SC-06 | Commands not in the `enabled` list are denied with "Command not enabled"                                                           | NO     | --        |
| SC-07 | `context.*` subcommands are enabled when `context` is in the enabled list                                                          | NO     | --        |
| SC-08 | `session.reset` is enabled when either `session.reset` or `session` is in enabled list                                             | NO     | --        |
| SC-09 | `approve.*` and `deny.*` commands are always enabled when any commands are enabled                                                 | NO     | --        |
| SC-10 | Authorization requires user to be in `admin_allowlist`, or have Administrator/ManageGuild permission                               | NO     | --        |
| SC-11 | DM command authorization requires the user to be in `admin_allowlist` (no Discord permissions in DMs)                              | NO     | --        |
| SC-12 | `session.reset` dispatches `/reset` as an inbound bus message                                                                      | NO     | --        |
| SC-13 | `context.*` commands dispatch `/context <action>` as inbound bus messages                                                          | NO     | --        |
| SC-14 | `approve id` dispatches `/approve <request_id>` as inbound bus message                                                             | NO     | --        |
| SC-15 | `approve all` dispatches `/approve-all` as inbound bus message                                                                     | NO     | --        |
| SC-16 | `deny id` dispatches `/deny <request_id> [reason]` as inbound bus message                                                          | NO     | --        |
| SC-17 | `status` replies with security mode and enabled commands list                                                                      | NO     | --        |
| SC-18 | `config show` in a guild shows server policy (mention gating, channel/user allowlists)                                             | NO     | --        |
| SC-19 | `config show` in DM shows DM policy (pairing, user allowlist)                                                                      | NO     | --        |
| SC-20 | `help` replies with the list of available commands                                                                                 | NO     | --        |
| SC-21 | All command interactions (allowed and denied) are published to the audit log topic                                                 | NO     | --        |
| SC-22 | Dispatched messages include `metadata.source: 'slash_command'`                                                                     | NO     | --        |
| SC-23 | All command replies are ephemeral (only visible to the invoking user)                                                              | NO     | --        |
| SC-24 | Failed slash command registration is caught and logged as a warning                                                                | NO     | --        |

---

## 19. Bot Filtering

**Source**: `packages/channels/discord/src/index.ts` **Test**: _No bot filtering
tests exist_ **Config**: `channels.discord.allow_bots`,
`channels.discord.bot_allowlist`

### Behaviors

| ID    | Behavior                                                                                     | Tested | Reference |
| ----- | -------------------------------------------------------------------------------------------- | ------ | --------- |
| BF-01 | Bot messages are dropped by default when `allow_bots` is falsy                               | NO     | --        |
| BF-02 | When `allow_bots` is true, bot messages are accepted                                         | NO     | --        |
| BF-03 | When `bot_allowlist` is set and non-empty, only bots with IDs in the list are accepted       | NO     | --        |
| BF-04 | The bot's own messages (matching `botUserId`) are always dropped to prevent self-reply loops | NO     | --        |
| BF-05 | Bot filtering is evaluated before all other message filters (server config, DM policy)       | NO     | --        |
| BF-06 | When `bot_allowlist` is empty or not set, all bots are allowed (if `allow_bots` is true)     | NO     | --        |
| BF-07 | Non-bot messages (`author.bot === false`) bypass bot filtering entirely                      | NO     | --        |

---

## 20. Pairing

**Source**: `packages/channels/base/src/pairing.ts` **Test**:
`packages/channels/base/src/pairing.test.ts` **Config**:
`channels.discord.dm.pairing`, env `NACHOS_PAIRING_TOKEN`, env
`RUNTIME_STATE_DIR`

### Behaviors

| ID    | Behavior                                                                                       | Tested | Reference          |
| ----- | ---------------------------------------------------------------------------------------------- | ------ | ------------------ |
| PA-01 | `parsePairingCommand` parses `pair` (case-insensitive) as a pairing command with no token      | YES    | pairing.test.ts:22 |
| PA-02 | `parsePairingCommand` parses `pair <token>` and extracts the token                             | YES    | pairing.test.ts:23 |
| PA-03 | `parsePairingCommand` returns null for non-pairing messages                                    | YES    | pairing.test.ts:24 |
| PA-04 | `FilePairingStore` persists paired user IDs to disk as JSON array                              | YES    | pairing.test.ts:8  |
| PA-05 | Store file is created under `<stateDir>/pairing/<channelId>.json`                              | YES    | pairing.test.ts:8  |
| PA-06 | Store loads existing paired users from disk on construction                                    | YES    | pairing.test.ts:15 |
| PA-07 | `setPaired` ignores empty userId strings                                                       | NO     | --                 |
| PA-08 | `removePaired` deletes a user from the paired set and persists                                 | NO     | --                 |
| PA-09 | Store state directory defaults to `./state` when no env var is provided                        | NO     | --                 |
| PA-10 | Discord adapter reads `RUNTIME_STATE_DIR` or `NACHOS_STATE_DIR` env for pairing store location | NO     | --                 |
| PA-11 | `NACHOS_PAIRING_TOKEN` env var gates the pairing flow (token must match)                       | YES    | index.test.ts:174  |
| PA-12 | When no `NACHOS_PAIRING_TOKEN` is set, `pair` command succeeds without token validation        | NO     | --                 |
| PA-13 | Store gracefully handles missing or corrupt JSON file on load                                  | NO     | --                 |
| PA-14 | Store creates directory structure recursively on first save                                    | NO     | --                 |

---

## Shared Policy Helpers

The following shared modules provide filtering logic used by the Discord adapter
and are tested independently.

**Source**: `packages/channels/base/src/policy.ts` **Test**:
`packages/channels/base/src/policy.test.ts`

| ID  | Behavior                                                                                                  | Tested | Reference         |
| --- | --------------------------------------------------------------------------------------------------------- | ------ | ----------------- |
| --  | `resolveDmPolicy` maps channel DM config to `ChannelDMPolicy` with `pairing` defaulting to `false`        | YES    | policy.test.ts:7  |
| --  | `resolveGroupPolicy` maps server config to `ChannelGroupPolicy` with `mentionGating` defaulting to `true` | YES    | policy.test.ts:13 |
| --  | `findServerConfig` finds server by `id` field                                                             | YES    | policy.test.ts:23 |
| --  | `findServerConfig` finds server by `ids[]` array membership                                               | NO     | --                |

**Source**: `packages/shared/utils/src/index.ts` **Test**:
`packages/shared/utils/src/channel-policy.test.ts`

| ID  | Behavior                                                                                 | Tested | Reference                 |
| --- | ---------------------------------------------------------------------------------------- | ------ | ------------------------- |
| --  | `shouldAllowDm` allows user in allowlist without pairing                                 | YES    | channel-policy.test.ts:25 |
| --  | `shouldAllowDm` allows paired user when pairing is enabled                               | YES    | channel-policy.test.ts:28 |
| --  | `shouldAllowGroupMessage` enforces channel allowlist, user allowlist, and mention gating | YES    | channel-policy.test.ts:11 |
| --  | `isMentioned` detects string and RegExp patterns in text                                 | YES    | channel-policy.test.ts:6  |
