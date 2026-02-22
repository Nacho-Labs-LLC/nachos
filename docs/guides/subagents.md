# Subagents Guide

**Version:** 1.0  
**Last Updated:** 2026-02-22

---

## Table of Contents

1. [What are Subagents?](#what-are-subagents)
2. [When to Use Subagents](#when-to-use-subagents)
3. [Spawning a Subagent](#spawning-a-subagent)
4. [Monitoring Subagents](#monitoring-subagents)
5. [Managing Subagents](#managing-subagents)
6. [Configuration](#configuration)
7. [Troubleshooting](#troubleshooting)

---

## What are Subagents?

**Subagents** are isolated AI sessions that run tasks independently and report back when complete. Think of them as background workers that handle complex, time-consuming tasks without blocking your conversation.

### How It Works

```
User Request
     ↓
Main Bot Session
     ↓
   Spawn Subagent (isolated session)
     ↓
Subagent works independently
     ↓
   Results aggregated
     ↓
  Announcement to user
     ↓
Conversation continues
```

### Key Features

- **Isolated execution** - Subagents run in separate sessions with their own workspace
- **Async operation** - Your main conversation continues while subagent works
- **Auto-announcement** - Results are automatically delivered when ready
- **Resource limits** - Timeouts and cleanup prevent runaway execution
- **Multi-agent support** - Run multiple subagents in parallel

---

## When to Use Subagents

### ✅ Good Use Cases

**Research tasks:**
- "Research the latest developments in quantum computing and write a 3-paragraph summary"
- "Find 5 reputable sources on renewable energy and summarize each"

**Analysis:**
- "Analyze this codebase for security vulnerabilities and create a report"
- "Review the last 50 commits and identify breaking changes"

**Long-running operations:**
- "Generate a comprehensive test suite for this API"
- "Create documentation for all public functions in this project"

**Parallel work:**
- "Run security audit, performance analysis, and code quality review in parallel"

### ❌ Don't Use Subagents For

- **Simple questions** - "What is 2+2?" (just answer directly)
- **Real-time conversation** - "Tell me a joke" (no need for background processing)
- **Quick lookups** - "What's the weather today?" (use tools directly)
- **Interactive workflows** - Back-and-forth conversations work better in main session

**Rule of thumb:** If the task takes >30 seconds or requires multiple steps, use a subagent.

---

## Spawning a Subagent

The main bot automatically decides when to spawn subagents, but you can explicitly request it:

### Basic Example

**User:**
> Can you research the history of artificial intelligence and summarize the key milestones in a timeline?

**Bot:**
> ✅ Spawned subagent (run-abc123)  
> I'll research AI history and prepare a timeline. You'll receive the results when ready.

*(Conversation continues...)*

**Bot (later):**
> ✅ Subagent completed (run-abc123)
>
> **AI History Timeline:**
> - 1950: Turing Test proposed by Alan Turing
> - 1956: Dartmouth Conference coins "Artificial Intelligence"
> - ...

### Advanced Example with Multiple Subagents

**User:**
> Analyze this repository for:
> 1. Security vulnerabilities
> 2. Performance bottlenecks
> 3. Code quality issues
>
> Run these in parallel and compare results.

**Bot:**
> ✅ Spawned 3 subagents:
> - Security audit (run-001)
> - Performance analysis (run-002)
> - Code quality review (run-003)
>
> Running in parallel...

---

## Monitoring Subagents

### Check Active Subagents

**User:**
> What subagents are currently running?

**Bot:**
> 📊 Active subagents:
> 1. **run-abc123** (running) - Research AI history
> 2. **run-def456** (queued) - Security audit

### Get Subagent Details

**User:**
> Show me details for run-abc123

**Bot:**
> 📋 Subagent run-abc123:
> - Status: running
> - Task: Research AI history and create timeline
> - Started: 2026-02-22 14:30:00
> - Duration: 2m 15s

### View Subagent Conversation Log

**User:**
> Show me the log for run-abc123

**Bot:**
> 📝 Conversation log for run-abc123:
>
> **User:** Research the history of artificial intelligence...
> **Assistant:** I'll search for information about AI history...
> *(tool calls, research progress)*

---

## Managing Subagents

### Stopping a Queued Subagent

If a subagent hasn't started yet, you can cancel it:

**User:**
> Stop subagent run-def456

**Bot:**
> ✅ Stopped subagent run-def456 (was queued)

**Note:** You can only stop **queued** subagents. Running subagents will complete naturally or timeout.

### Steering a Running Subagent

You can send additional instructions to a running subagent:

**User:**
> Tell run-abc123 to focus on developments since 2020

**Bot:**
> ✅ Message sent to subagent run-abc123

The subagent will receive your message and adjust its approach accordingly.

**Example steering messages:**
- "Focus on X instead of Y"
- "Add more detail about Z"
- "Skip section A and move to B"
- "Prioritize recent sources"

### Viewing Subagent Workspace Files

Subagents work in isolated workspaces. You can inspect their files:

**User:**
> List files in run-abc123's workspace

**Bot:**
> 📁 Workspace files for run-abc123:
> - research-notes.md (2.3 KB)
> - sources.txt (1.1 KB)
> - timeline-draft.md (4.5 KB)

**User:**
> Show me research-notes.md from run-abc123

**Bot:**
> 📄 research-notes.md:
> ```markdown
> # AI Research Notes
> ...
> ```

---

## Configuration

### Admin Configuration

Subagent behavior is configured in `nachos.toml`:

```toml
[gateway.subagent]
mode = "host"              # or "full" for Docker sandbox
max_concurrent = 2         # Max parallel subagents
default_timeout_seconds = 300  # 5 minutes default

[gateway.subagent.announce]
enabled = true
# Optional custom announcement template
# prompt = "Summarize the results of this subagent run..."

[gateway.subagent.docker]
# Only needed if mode = "full"
image = "nachos/subagent-sandbox:latest"
network = "none"
memory_limit = "512m"
cpu_shares = 512
```

### Per-Request Configuration

When spawning subagents programmatically (via tool calls):

```json
{
  "tool": "sessions_spawn",
  "parameters": {
    "task": "Research quantum computing",
    "label": "quantum-research",
    "model": "claude-sonnet-4",
    "thinking": "high",
    "runTimeoutSeconds": 600,
    "cleanup": "delete"
  }
}
```

**Parameters:**
- `task` - Task description (required)
- `label` - Human-readable label (optional)
- `model` - Override default model (optional)
- `thinking` - Thinking level: low/medium/high (optional)
- `runTimeoutSeconds` - Max execution time (optional, default: 300)
- `cleanup` - "delete" or "keep" workspace after completion (optional, default: "keep")

---

## Troubleshooting

### Subagent Stuck/Not Responding

**Symptom:** Subagent status is "running" for a very long time

**Solutions:**
1. Check if there's a timeout configured (default: 5 minutes)
2. The subagent may be waiting for tool results or processing large data
3. You can steer the subagent to provide a status update: "Give me a progress update"

### Subagent Failed

**Symptom:** Subagent status is "failed"

**Solutions:**
1. Check the error message: `Show me info for run-abc123`
2. Common causes:
   - Timeout exceeded
   - Tool access denied (policy restrictions)
   - Out of memory (for Docker sandbox)
   - LLM API error
3. Review the conversation log to see where it failed: `Show me log for run-abc123`

### Can't Stop Running Subagent

**Symptom:** Stop command returns "Cannot stop run (already running)"

**Explanation:** You can only stop **queued** subagents. Once a subagent is running, it will complete naturally or timeout.

**Workaround:**
- Wait for timeout (default: 5 minutes)
- Steer the subagent to finish early: "Wrap up and provide current findings"

### Too Many Concurrent Subagents

**Symptom:** New subagent stays "queued" for a long time

**Explanation:** The system has a max concurrent limit (default: 2). New subagents wait for slots.

**Solutions:**
1. Wait for running subagents to complete
2. Stop queued subagents you don't need
3. Increase `max_concurrent` in config (admin only)

### Workspace Files Not Found

**Symptom:** "Workspace not available" error when listing files

**Causes:**
- Subagent was spawned with `cleanup: "delete"` (workspace removed)
- Workspace provisioning failed (check logs)
- Running in non-sandboxed mode (no workspace created)

**Solution:**
- Only sandboxed subagents have workspaces
- Keep important workspaces: use `cleanup: "keep"`

---

## Advanced: Developer Integration

If you're building tools or extensions that spawn subagents programmatically:

### Using the sessions_spawn Tool

```typescript
import type { ToolCall } from '@nachos/types';

const spawnCall: ToolCall = {
  id: 'call-123',
  tool: 'sessions_spawn',
  parameters: {
    task: 'Analyze security vulnerabilities in the codebase',
    label: 'security-audit',
    model: 'claude-sonnet-4',
    runTimeoutSeconds: 600,
  },
};

// Gateway will return:
// {
//   success: true,
//   content: [{
//     type: 'text',
//     text: JSON.stringify({
//       status: 'accepted',
//       runId: 'run-xyz789',
//       childSessionId: 'session-child-123'
//     })
//   }]
// }
```

### Monitoring via subagents Tool

```typescript
// List all runs for current session
const listCall: ToolCall = {
  id: 'call-456',
  tool: 'subagents',
  parameters: {
    action: 'list',
  },
};

// Get detailed info
const infoCall: ToolCall = {
  id: 'call-789',
  tool: 'subagents',
  parameters: {
    action: 'info',
    runId: 'run-xyz789',
  },
};
```

### Stopping and Steering

```typescript
// Stop a queued run
const stopCall: ToolCall = {
  id: 'call-stop',
  tool: 'subagents',
  parameters: {
    action: 'stop',
    runId: 'run-xyz789',
  },
};

// Steer a running subagent
const steerCall: ToolCall = {
  id: 'call-steer',
  tool: 'subagents',
  parameters: {
    action: 'steer',
    runId: 'run-xyz789',
    message: 'Focus on OWASP Top 10 vulnerabilities',
  },
};
```

---

## Best Practices

### 1. Clear Task Descriptions

❌ **Bad:** "Do research"  
✅ **Good:** "Research renewable energy trends in 2025, focusing on solar and wind. Summarize in 3 paragraphs with sources."

### 2. Use Labels for Organization

```typescript
{
  task: "Security audit",
  label: "security-audit-2026-02-22"  // Easy to identify later
}
```

### 3. Set Appropriate Timeouts

- Quick research: 120s
- Code analysis: 300s (default)
- Comprehensive audit: 600-900s

### 4. Keep Important Workspaces

```typescript
{
  task: "Generate test suite",
  cleanup: "keep"  // Preserve workspace files
}
```

### 5. Monitor Long-Running Subagents

For tasks >5 minutes, periodically check status or enable progress updates.

---

## See Also

- [Architecture Guide](../architecture/subagents.md) - How subagents work internally
- [Configuration Reference](../config/gateway.md) - Full subagent config options
- [Tool Reference](../tools/sessions_spawn.md) - API documentation

---

**Questions?** Join our Discord: https://discord.com/invite/nachos
