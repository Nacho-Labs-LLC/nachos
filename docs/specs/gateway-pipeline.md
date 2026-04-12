# Gateway Pipeline Feature Specification

> **Last updated**: 2026-03-03 **Source**: `packages/core/gateway/src/`

## Pipeline Overview

The gateway processes every inbound user message through a fixed pipeline of 12
features. The full message flow is:

```
Channel Inbound
  -> [AF] Approval command intercept (early exit)
  -> [RL] Rate limit check (block if exceeded)
  -> [SM] Session get-or-create
  -> [PE] Policy enforcement / Cheese (inbound receive check)
  -> [DLP] DLP scan inbound message (block/redact/alert)
  -> Context command intercept (/new, /reset, /context, /identity)
  -> Store user message in session
  -> Publish processed envelope
  -> [STR] Register streaming session (if enabled)
  -> [SE] Publish "thinking" status event
  -> [BS] Build LLM request (assemble prompt, inject bootstrap/identity/memory)
  -> [CM] Context check and compaction (before LLM turn)
  -> [LLM] Send LLM request via router (rate-limited)
  -> [LLM] Receive LLM response
  -> [TE] If tool calls: execute tools -> store results -> loop back to LLM (max 10 iterations)
  -> [PE] Policy enforcement / Cheese (outbound send check)
  -> [DLP] DLP scan outbound response (block/redact/alert)
  -> Store assistant message in session
  -> Send outbound to channel
  -> [SE] Publish "done" status event
```

On error at any stage, the gateway sends an error message to the user and
publishes an "error" status event.

---

## 1. Message Intake/Routing (MI)

**Source**: `packages/core/gateway/src/gateway.ts` (handleInboundMessage, line
~500), `packages/core/gateway/src/router.ts` **Test**:
`packages/core/gateway/src/router.test.ts`,
`packages/core/gateway/src/integration.test.ts` **Config**: `channels`
(GatewayOptions), NATS bus connection

### Behaviors

| ID    | Behavior                                                                           | Tested | Reference                   |
| ----- | ---------------------------------------------------------------------------------- | ------ | --------------------------- |
| MI-01 | Validate inbound message schema (channel, sender, conversation, content required)  | YES    | integration.test.ts:165-175 |
| MI-02 | Drop invalid inbound messages with a log warning (no crash)                        | YES    | integration.test.ts:165-175 |
| MI-03 | Register handler for `channel.inbound` type on router                              | YES    | router.test.ts:76-88        |
| MI-04 | Route message to correct handler based on envelope type                            | YES    | router.test.ts:91-106       |
| MI-05 | Subscribe to channel-specific inbound topics (e.g. `nachos.channel.slack.inbound`) | YES    | router.test.ts:108-136      |
| MI-06 | Create valid MessageEnvelope with id, timestamp, source, type, payload             | YES    | router.test.ts:51-73        |
| MI-07 | NatsBusAdapter validates envelope before publish (rejects non-envelope data)       | YES    | router.test.ts:364-385      |
| MI-08 | NatsBusAdapter validates envelope before request (rejects non-envelope data)       | YES    | router.test.ts:387-406      |
| MI-09 | Publish processed message to `nachos.gateway.processed` after intake               | YES    | integration.test.ts:417-419 |
| MI-10 | InMemoryMessageBus delivers to multiple subscribers on same topic                  | YES    | router.test.ts:308-323      |
| MI-11 | InMemoryMessageBus does not deliver to unsubscribed topics                         | YES    | router.test.ts:325-335      |
| MI-12 | Log warning for unhandled message types (no throw)                                 | YES    | router.test.ts:101-106      |

---

## 2. Session Management (SM)

**Source**: `packages/core/gateway/src/session.ts`,
`packages/core/gateway/src/state.ts` **Test**:
`packages/core/gateway/src/session.test.ts`,
`packages/core/gateway/src/state.test.ts` **Config**: `dbPath` (SQLite path or
`:memory:`), `maxMessagesPerSession` (default 10000)

### Behaviors

| ID    | Behavior                                                              | Tested | Reference               |
| ----- | --------------------------------------------------------------------- | ------ | ----------------------- |
| SM-01 | Create new session atomically (TOCTOU-safe via transaction)           | YES    | session.test.ts:19-31   |
| SM-02 | Return existing active session for same channel+conversationId        | YES    | session.test.ts:33-47   |
| SM-03 | Reactivate paused session on new message                              | YES    | session.test.ts:49-66   |
| SM-04 | Reactivate ended session on new message                               | YES    | session.test.ts:68-85   |
| SM-05 | Create session with system prompt                                     | YES    | session.test.ts:87-96   |
| SM-06 | Create session with config (model, maxTokens)                         | YES    | session.test.ts:98-107  |
| SM-07 | Refuse adding messages to inactive (paused/ended) sessions            | YES    | session.test.ts:338-353 |
| SM-08 | Refuse adding messages when max message limit reached (default 10000) | NO     | --                      |
| SM-09 | Log warning when approaching 90% of max message limit                 | NO     | --                      |
| SM-10 | Enforce unique constraint on channel + conversation_id                | YES    | state.test.ts:202-216   |
| SM-11 | Delete session cascades to delete all messages (transaction)          | YES    | state.test.ts:108-131   |
| SM-12 | Replace messages atomically (used after context compaction)           | NO     | --                      |
| SM-13 | Session pinning and archiving                                         | YES    | state.test.ts:389-461   |
| SM-14 | List active sessions (recent or pinned, not archived)                 | YES    | state.test.ts:463-560   |
| SM-15 | List archived sessions with search filter                             | YES    | state.test.ts:562-645   |

---

## 3. Bootstrap/State Injection (BS)

**Source**: `packages/core/gateway/src/gateway.ts` (buildLLMRequest, line ~1138;
assemblePrompt via StateLayer) **Test**:
`packages/core/gateway/src/gateway.test.ts` **Config**: `stateLayerConfig`,
`defaultSystemPrompt`, `toolsConfig.bootstrap.enabled`

### Behaviors

| ID    | Behavior                                                                           | Tested | Reference               |
| ----- | ---------------------------------------------------------------------------------- | ------ | ----------------------- |
| BS-01 | Start with base system prompt from session or gateway default                      | YES    | gateway.test.ts:233-252 |
| BS-02 | Inject bootstrap profile blocks into system prompt (via StateLayer.assemblePrompt) | NO     | --                      |
| BS-03 | Inject identity data (soul, identity, user profile) into prompt                    | NO     | --                      |
| BS-04 | Inject memory entries and facts into prompt                                        | NO     | --                      |
| BS-05 | Include skills prompt from SkillsManager in assembled prompt                       | NO     | --                      |
| BS-06 | Lock bootstrap tool after identity completion (bootstrapLocked flag)               | YES    | gateway.test.ts:256-282 |
| BS-07 | Increment bootstrap version on set operation                                       | YES    | gateway.test.ts:284-345 |
| BS-08 | Filter bootstrap for subagent sessions (only agents + tools blocks)                | NO     | --                      |
| BS-09 | Prune bootstrap "bootstrap" block after identity completion                        | NO     | --                      |
| BS-10 | Include tool_use and tool_result blocks in message history for multi-turn          | NO     | --                      |
| BS-11 | Fall back to base prompt with token estimation if state layer unavailable          | NO     | --                      |
| BS-12 | Store prompt report in session metadata after assembly                             | NO     | --                      |

---

## 4. Policy Enforcement / Cheese (PE)

**Source**: `packages/core/gateway/src/cheese/policy/evaluator.ts`,
`packages/core/gateway/src/cheese/index.ts` **Test**:
`packages/core/gateway/src/cheese/policy/evaluator.test.ts`,
`packages/core/gateway/src/cheese/index.test.ts` **Config**:
`policyConfig.policiesPath`, `policyConfig.securityMode`,
`policyConfig.enableHotReload`, `policyConfig.defaultEffect`

### Behaviors

| ID    | Behavior                                                                       | Tested | Reference                 |
| ----- | ------------------------------------------------------------------------------ | ------ | ------------------------- |
| PE-01 | Allow request when matching rule has `allow` effect                            | YES    | evaluator.test.ts:13-49   |
| PE-02 | Deny request when matching rule has `deny` effect (with reason)                | YES    | evaluator.test.ts:51-89   |
| PE-03 | Apply default deny when no rule matches                                        | YES    | evaluator.test.ts:91-113  |
| PE-04 | Evaluate rules in priority order (highest priority first)                      | YES    | evaluator.test.ts:115-157 |
| PE-05 | Match by resource type (single or array)                                       | YES    | evaluator.test.ts:161-199 |
| PE-06 | Match by resource ID (single or array)                                         | YES    | evaluator.test.ts:202-239 |
| PE-07 | Match by action (single or array)                                              | YES    | evaluator.test.ts:241-273 |
| PE-08 | Evaluate `equals` condition on request fields                                  | YES    | evaluator.test.ts:277-318 |
| PE-09 | Evaluate `in` condition (value in array)                                       | YES    | evaluator.test.ts:320-356 |
| PE-10 | Evaluate `starts_with` condition on metadata fields                            | YES    | evaluator.test.ts:358-399 |
| PE-11 | Evaluate `matches` (regex) condition with ReDoS protection                     | YES    | evaluator.test.ts:401-442 |
| PE-12 | Reject regex patterns exceeding 200 characters                                 | NO     | --                        |
| PE-13 | Reject regex patterns with nested quantifiers (catastrophic backtracking)      | NO     | --                        |
| PE-14 | Require ALL conditions to match (AND logic)                                    | YES    | evaluator.test.ts:444-495 |
| PE-15 | Evaluate in less than 1ms (even with 100 rules)                                | YES    | evaluator.test.ts:498-528 |
| PE-16 | Atomic policy reload: reject entire load if any document has validation errors | YES    | index.test.ts:119-148     |
| PE-17 | Hot-reload policies from disk (watcher)                                        | NO     | --                        |
| PE-18 | Track evaluation statistics (count, avg time)                                  | YES    | evaluator.test.ts:531-567 |
| PE-19 | Policy check on inbound receive (gateway.ts line ~579)                         | NO     | --                        |
| PE-20 | Policy check on outbound send (gateway.ts line ~1712)                          | NO     | --                        |

---

## 5. DLP Scanning (DLP)

**Source**: `packages/core/gateway/src/security/dlp.ts` **Test**:
`packages/core/gateway/src/security/dlp.test.ts` **Config**:
`dlpConfig.enabled`, `dlpConfig.globalPolicy`, `dlpConfig.channels`,
`dlpConfig.fastPath`

### Behaviors

| ID     | Behavior                                                           | Tested | Reference           |
| ------ | ------------------------------------------------------------------ | ------ | ------------------- |
| DLP-01 | Detect AWS access keys (critical severity)                         | YES    | dlp.test.ts:14-20   |
| DLP-02 | Detect GitHub PAT tokens                                           | YES    | dlp.test.ts:22-27   |
| DLP-03 | Detect OpenAI API keys (critical severity)                         | YES    | dlp.test.ts:29-35   |
| DLP-04 | Allow clean messages with no findings                              | YES    | dlp.test.ts:37-44   |
| DLP-05 | Block messages when policy action is `block`                       | YES    | dlp.test.ts:66-82   |
| DLP-06 | Redact sensitive data when policy action is `redact`               | YES    | dlp.test.ts:84-102  |
| DLP-07 | Alert on findings when policy action is `alert` (still allowed)    | YES    | dlp.test.ts:104-121 |
| DLP-08 | Allow all messages when DLP is disabled                            | YES    | dlp.test.ts:297-313 |
| DLP-09 | Apply reduced DLP ruleset for secure channels (high/critical only) | YES    | dlp.test.ts:125-149 |
| DLP-10 | Allow low-severity patterns on secure channels                     | YES    | dlp.test.ts:151-175 |
| DLP-11 | Apply channel-specific policy over global policy                   | YES    | dlp.test.ts:236-261 |
| DLP-12 | Register/unregister secure channels dynamically                    | YES    | dlp.test.ts:200-232 |
| DLP-13 | Filter findings by severity levels from policy config              | YES    | dlp.test.ts:264-293 |
| DLP-14 | Log findings to audit logger when configured                       | YES    | dlp.test.ts:345-361 |
| DLP-15 | Scan inbound user messages (gateway.ts line ~655)                  | NO     | --                  |
| DLP-16 | Scan outbound LLM responses (gateway.ts line ~1754)                | NO     | --                  |
| DLP-17 | Fast-path prefilter skips full scan when no keywords match         | NO     | --                  |
| DLP-18 | Update global policy at runtime                                    | YES    | dlp.test.ts:334-342 |

---

## 6. LLM Interaction (LLM)

**Source**: `packages/core/gateway/src/gateway.ts` (requestLLMResponse line
~1274, sendLLMResponse line ~1659) **Test**:
`packages/core/gateway/src/router.test.ts` (sendLLMRequest),
`packages/core/gateway/src/gateway.test.ts` **Config**: `session.config.model`,
`session.config.maxTokens`, `streamingPassthrough`

### Behaviors

| ID     | Behavior                                                                    | Tested | Reference              |
| ------ | --------------------------------------------------------------------------- | ------ | ---------------------- |
| LLM-01 | Build LLM request with system prompt, message history, and tool definitions | NO     | --                     |
| LLM-02 | Send LLM request via router with 60s timeout                                | YES    | router.test.ts:225-233 |
| LLM-03 | Rate-limit LLM requests (throw if exceeded)                                 | NO     | --                     |
| LLM-04 | Extract response payload from bus envelope                                  | NO     | --                     |
| LLM-05 | Execute tool calls from LLM response, then re-request LLM                   | NO     | --                     |
| LLM-06 | Cap tool iterations at MAX_TOOL_ITERATIONS (10) to prevent infinite loops   | NO     | --                     |
| LLM-07 | Store assistant message (with tool calls) in session after LLM response     | NO     | --                     |
| LLM-08 | Store tool result messages in session for multi-turn history                | NO     | --                     |
| LLM-09 | Policy check on outbound LLM response before sending to channel             | NO     | --                     |
| LLM-10 | DLP scan outbound LLM response before sending to channel                    | NO     | --                     |
| LLM-11 | Send error feedback to user on LLM failure (timeout vs generic error)       | NO     | --                     |
| LLM-12 | Audit log LLM request errors                                                | NO     | --                     |

---

## 7. Tool Execution (TE)

**Source**: `packages/core/gateway/src/tools/tool-executor.ts`,
`packages/core/gateway/src/tools/shell-tool.ts` **Test**:
`packages/core/gateway/src/tools/shell-tool.test.ts`,
`packages/core/gateway/src/gateway.test.ts` **Config**: `toolsConfig`,
`toolGroups`, `subagentToolPolicy`

### Behaviors

| ID    | Behavior                                                                        | Tested | Reference                  |
| ----- | ------------------------------------------------------------------------------- | ------ | -------------------------- |
| TE-01 | Build tool definitions based on session type (main vs subagent)                 | YES    | gateway.test.ts:256-282    |
| TE-02 | Omit bootstrap tool when disabled in config                                     | YES    | gateway.test.ts:256-282    |
| TE-03 | Binary allowlisting: only approved CLI tools can execute                        | YES    | shell-tool.test.ts:25-29   |
| TE-04 | Block destructive file operations (rm, mv, cp, chmod, chown)                    | YES    | shell-tool.test.ts:108-114 |
| TE-05 | Block shell execution (bash, sh)                                                | YES    | shell-tool.test.ts:116-119 |
| TE-06 | Block package management commands (npm, apt-get, pip)                           | YES    | shell-tool.test.ts:121-126 |
| TE-07 | Block command injection via $(), backticks, ${}, process substitution           | YES    | shell-tool.test.ts:153-194 |
| TE-08 | Allow pipes between allowed commands, block if any command disallowed           | YES    | shell-tool.test.ts:197-223 |
| TE-09 | Reject blocked subcommands during execution (git push, docker rm)               | YES    | shell-tool.test.ts:331-357 |
| TE-10 | Validate required environment variables before execution                        | YES    | shell-tool.test.ts:359-372 |
| TE-11 | Tool group mapping (lookup, media, summarize, workspace, file-inspection, etc.) | YES    | shell-tool.test.ts:227-254 |
| TE-12 | Subagent tool policy: deny session tools by default                             | YES    | gateway.test.ts:377-389    |
| TE-13 | Subagent tool policy: respect allowlist overrides                               | YES    | gateway.test.ts:391-413    |
| TE-14 | Subagent tool policy: support profile-specific allowlists                       | YES    | gateway.test.ts:415-452    |
| TE-15 | DLP scan on tool input parameters                                               | NO     | --                         |

---

## 8. Status Events (SE)

**Source**: `packages/core/gateway/src/gateway.ts` (publishStatusEvent, line
~1936) **Test**: None dedicated **Config**: None (always active, best-effort)

### Behaviors

| ID    | Behavior                                                                                   | Tested | Reference |
| ----- | ------------------------------------------------------------------------------------------ | ------ | --------- |
| SE-01 | Publish "thinking" status when LLM request starts                                          | NO     | --        |
| SE-02 | Publish "tool" status when tool execution starts                                           | NO     | --        |
| SE-03 | Publish "done" status after sending final response to channel                              | NO     | --        |
| SE-04 | Publish "error" status on LLM failure                                                      | NO     | --        |
| SE-05 | Status events are best-effort (failures logged at debug, do not affect message processing) | NO     | --        |
| SE-06 | Status event envelope includes sessionId, status, channelId, channelMessageId, toolName    | NO     | --        |
| SE-07 | Publish to topic `nachos.status.<status>.<sessionId>`                                      | NO     | --        |

---

## 9. Streaming (STR)

**Source**: `packages/core/gateway/src/streaming/streaming-session-manager.ts`
**Test**: None dedicated **Config**: `streamingPassthrough`,
`streamingChunkSize` (default 200), `streamingMinIntervalMs` (default 500ms)

### Behaviors

| ID     | Behavior                                                               | Tested | Reference |
| ------ | ---------------------------------------------------------------------- | ------ | --------- |
| STR-01 | Register streaming session with inbound message context                | NO     | --        |
| STR-02 | Buffer LLM stream deltas and send when chunk size threshold met        | NO     | --        |
| STR-03 | Enforce minimum interval between streaming chunk sends (default 500ms) | NO     | --        |
| STR-04 | Clean up streaming session on "done" chunk type                        | NO     | --        |
| STR-05 | Send streaming chunks as ephemeral outbound messages                   | NO     | --        |
| STR-06 | Sweep stale streaming sessions after maxSessionAgeMs (default 5 min)   | NO     | --        |
| STR-07 | Stop sweep interval and clear all sessions on stop()                   | NO     | --        |
| STR-08 | Subscribe to wildcard LLM stream topic (`nachos.llm.stream.*`)         | NO     | --        |

---

## 10. Context Management (CM)

**Source**: `packages/core/gateway/src/router.ts` (checkAndCompactContext, line
~351), `@nachos/context-manager` **Test**: None in gateway (context-manager has
its own tests) **Config**: ContextManager config (proactive_history,
memoryFlush), contextWindow (default 200000)

### Behaviors

| ID    | Behavior                                                                     | Tested | Reference |
| ----- | ---------------------------------------------------------------------------- | ------ | --------- |
| CM-01 | Skip context check if contextManager or sessionManager not configured        | NO     | --        |
| CM-02 | Skip context check if session metadata has contextManagement.enabled = false | NO     | --        |
| CM-03 | Check context budget before each LLM turn                                    | NO     | --        |
| CM-04 | Publish budget update event to `nachos.context.budgetUpdate`                 | NO     | --        |
| CM-05 | Publish zone change event when zone is yellow/orange/red/critical            | NO     | --        |
| CM-06 | Execute compaction when budget threshold exceeded                            | NO     | --        |
| CM-07 | Replace messages atomically in storage after compaction                      | NO     | --        |
| CM-08 | Update session metadata with compaction history                              | NO     | --        |
| CM-09 | Publish compaction event with token stats and messages dropped count         | NO     | --        |
| CM-10 | Trigger memory flush extraction when soft threshold reached                  | NO     | --        |
| CM-11 | Trigger threshold extraction when utilization ratio hits threshold           | NO     | --        |
| CM-12 | Store extracted data via MemoryPipeline during compaction                    | NO     | --        |

---

## 11. Rate Limiting (RL)

**Source**: `packages/core/gateway/src/security/rate-limiter.ts` **Test**:
`packages/core/gateway/src/security/rate-limiter.test.ts` **Config**:
`rateLimiterConfig.enabled`, `rateLimiterConfig.limits`,
`rateLimiterConfig.redisUrl`, `rateLimiterConfig.presets`

### Behaviors

| ID    | Behavior                                                            | Tested | Reference                  |
| ----- | ------------------------------------------------------------------- | ------ | -------------------------- |
| RL-01 | Allow all traffic when rate limiter is disabled                     | YES    | rate-limiter.test.ts:18-28 |
| RL-02 | Enforce sliding window limits per user per action                   | YES    | rate-limiter.test.ts:30-48 |
| RL-03 | Reset count after window expires (60s)                              | YES    | rate-limiter.test.ts:45-47 |
| RL-04 | Select limits by security mode (strict/standard/permissive presets) | YES    | rate-limiter.test.ts:50-57 |
| RL-05 | Fall back to memory store when Redis fails                          | YES    | rate-limiter.test.ts:59-90 |
| RL-06 | Rate limit inbound messages (gateway.ts line ~524)                  | NO     | --                         |
| RL-07 | Rate limit outbound messages (router.ts sendToChannel)              | YES    | router.test.ts:160-204     |
| RL-08 | Rate limit LLM requests (router.ts sendLLMRequest)                  | NO     | --                         |
| RL-09 | Rate limit tool requests (router.ts sendToolRequest)                | NO     | --                         |
| RL-10 | Publish audit event on rate limit block                             | YES    | router.test.ts:193-203     |
| RL-11 | Send rate limit exceeded message to user channel                    | NO     | --                         |
| RL-12 | Memory store periodic cleanup (purge expired entries every 60s)     | NO     | --                         |

---

## 12. Approval Flow (AF)

**Source**: `packages/core/gateway/src/tools/approval-manager.ts`,
`packages/core/gateway/src/gateway.ts` (handleApprovalCommand, line ~1840)
**Test**: None dedicated **Config**: `approvalAllowlist` (GatewayOptions),
`approvalTimeoutMs` (default 120000ms / 2 min)

### Behaviors

| ID    | Behavior                                                                          | Tested | Reference |
| ----- | --------------------------------------------------------------------------------- | ------ | --------- |
| AF-01 | Require approval for SecurityTier >= 3 (RESTRICTED)                               | NO     | --        |
| AF-02 | Publish approval request message to channel with tool details                     | NO     | --        |
| AF-03 | Wait for approval with configurable timeout (default 2 min)                       | NO     | --        |
| AF-04 | Deny request on timeout                                                           | NO     | --        |
| AF-05 | `/approve <id>` approves a pending request (owner or requester only)              | NO     | --        |
| AF-06 | `/deny <id> [reason]` denies a pending request                                    | NO     | --        |
| AF-07 | `/approve-all` approves all pending requests (owner only)                         | NO     | --        |
| AF-08 | Approval commands intercepted BEFORE session creation (early exit)                | NO     | --        |
| AF-09 | Strip leading mention patterns from approval commands                             | NO     | --        |
| AF-10 | Cancel all pending requests when session ends                                     | NO     | --        |
| AF-11 | Emit `approval-requested` event for gateway to publish to channel                 | NO     | --        |
| AF-12 | Format approval message with tool name, security tier, parameters, and request ID | NO     | --        |
| AF-13 | Non-owner cannot approve/deny another user's request                              | NO     | --        |

---

## Test Coverage Summary

| Feature                   | ID Prefix | Total Behaviors | Tested | Coverage |
| ------------------------- | --------- | --------------- | ------ | -------- |
| Message Intake/Routing    | MI        | 12              | 12     | 100%     |
| Session Management        | SM        | 15              | 12     | 80%      |
| Bootstrap/State Injection | BS        | 12              | 3      | 25%      |
| Policy Enforcement        | PE        | 20              | 15     | 75%      |
| DLP Scanning              | DLP       | 18              | 14     | 78%      |
| LLM Interaction           | LLM       | 12              | 1      | 8%       |
| Tool Execution            | TE        | 15              | 14     | 93%      |
| Status Events             | SE        | 7               | 0      | 0%       |
| Streaming                 | STR       | 8               | 0      | 0%       |
| Context Management        | CM        | 12              | 0      | 0%       |
| Rate Limiting             | RL        | 12              | 6      | 50%      |
| Approval Flow             | AF        | 13              | 0      | 0%       |
| **Total**                 |           | **156**         | **77** | **49%**  |

### Priority Test Gaps

1. **Status Events (SE)**: Zero coverage. Core status lifecycle
   (thinking/tool/done/error) is untested.
2. **Streaming (STR)**: Zero coverage. Buffer logic, sweep, and chunk thresholds
   untested.
3. **Approval Flow (AF)**: Zero coverage. Approval/deny commands, timeout, and
   authorization untested.
4. **Context Management (CM)**: Zero coverage. Compaction, budget events, and
   memory flush untested.
5. **LLM Interaction (LLM)**: Only router-level send tested. Tool loop, max
   iterations, error handling untested.
6. **Bootstrap/State Injection (BS)**: Prompt assembly with state layer blocks
   untested.
