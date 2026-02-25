# Subagents Guide

**Version:** 2.0  
**Last Updated:** 2026-02-24

---

## Table of Contents

1. [What are Subagents?](#what-are-subagents)
2. [When to Use Subagents](#when-to-use-subagents)
3. [Spawning a Subagent](#spawning-a-subagent)
4. [Model Selection](#model-selection)
5. [Progress Reporting](#progress-reporting)
6. [Streaming Results](#streaming-results)
7. [Workflow Orchestration](#workflow-orchestration)
8. [Monitoring Subagents](#monitoring-subagents)
9. [Managing Subagents](#managing-subagents)
10. [Configuration](#configuration)
11. [Troubleshooting](#troubleshooting)

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

## Model Selection

**New in v2.0** - Choose the right model for each task to optimize cost and performance.

### Why Model Selection Matters

Different tasks require different levels of intelligence:
- **Simple tasks** (syntax checks, basic summaries) → Haiku (fast & cheap)
- **Medium tasks** (code reviews, research) → Sonnet (balanced)
- **Complex tasks** (architecture design, deep analysis) → Opus (thorough)

**Cost comparison:**
- Haiku: $1 input / $5 output per MTok (baseline)
- Sonnet: 3× more expensive than Haiku
- Opus: 5× more expensive than Haiku

### Explicit Model Selection

Specify the exact model you want:

**User:**
> Run a quick syntax check on main.py using Haiku

**Bot (calls tool):**
```json
{
  "tool": "sessions_spawn",
  "parameters": {
    "task": "Check main.py for Python syntax errors",
    "model": "haiku"
  }
}
```

**Supported models:**
- `haiku` - Claude Haiku 4.5 (fast)
- `sonnet` - Claude Sonnet 4.6 (balanced, default)
- `opus` - Claude Opus 4.6 (thorough)

You can also use full model IDs:
```json
{
  "model": "anthropic.claude-sonnet-4-6"
}
```

### Model Hints

Use hints for convenience:

**User:**
> Do a thorough security audit of the authentication system

**Bot (calls tool):**
```json
{
  "tool": "sessions_spawn",
  "parameters": {
    "task": "Audit authentication system for security vulnerabilities",
    "modelHint": "thorough"
  }
}
```

**Available hints:**
- `fast` → Haiku (quick tasks)
- `balanced` → Sonnet (default)
- `thorough` → Opus (deep analysis)

### Automatic Model Selection

If no model or hint is specified, the system automatically selects based on task complexity:

**Triggers Opus (thorough):**
- Keywords: analyze, review, audit, investigate, comprehensive
- Code analysis keywords: codebase, vulnerabilities, refactor
- Multi-step tasks: numbered lists, "then", "after"
- Long tasks: >40 words

**Triggers Haiku (fast):**
- Short tasks: <8 words
- No complexity keywords
- Simple operations

**Defaults to Sonnet (balanced):**
- Medium complexity
- Everything else

**Example:**

```typescript
// Auto-selects Opus (has "analyze" + "codebase")
await sessions_spawn({
  task: "Analyze this codebase for security vulnerabilities"
});

// Auto-selects Haiku (short + simple)
await sessions_spawn({
  task: "Fix typo in README"
});

// Auto-selects Sonnet (medium complexity)
await sessions_spawn({
  task: "Write a summary of this research paper"
});
```

### Configuration

Admin can configure model selection in `nachos.toml`:

```toml
[gateway.subagent.models]
# Custom aliases
haiku = "anthropic.claude-haiku-4-5-20251001-v1:0"
sonnet = "anthropic.claude-sonnet-4-6"
opus = "anthropic.claude-opus-4-6-v1"

# Enable auto-selection
auto_select = true

# Default when no model/hint specified
default_model = "sonnet"
```

---

## Progress Reporting

**New in v2.0** - Get real-time status updates from long-running subagents.

### Why Progress Matters

For long-running tasks (>1 minute), progress updates:
- Give users confidence the subagent is working
- Show estimated completion
- Enable early intervention if something's wrong

### How Subagents Report Progress

Subagents can report progress using the `subagent_progress` tool:

```json
{
  "tool": "subagent_progress",
  "parameters": {
    "status": "Analyzing file 23 of 50",
    "percentage": 46,
    "metadata": {
      "filesProcessed": 23,
      "totalFiles": 50,
      "issuesFound": 3
    }
  }
}
```

**Parameters:**
- `status` (required) - Human-readable status message
- `percentage` (optional) - Progress percentage (0-100)
- `metadata` (optional) - Structured data (JSON object)

### Viewing Progress

**User:**
> What's the status of run-abc123?

**Bot:**
> 📊 Subagent run-abc123:
> - Status: running
> - Task: Analyze codebase for security issues
> - Started: 5m 23s ago
> - Progress: Analyzing file 23 of 50 (46%)
> - Found 3 issues so far

**Via tool call:**
```json
{
  "tool": "subagents",
  "parameters": {
    "action": "info",
    "runId": "run-abc123"
  }
}
```

**Response includes progress:**
```json
{
  "runId": "run-abc123",
  "status": "running",
  "progress": [
    {
      "timestamp": "2026-02-24T14:30:00Z",
      "status": "Starting analysis",
      "percentage": 0
    },
    {
      "timestamp": "2026-02-24T14:32:15Z",
      "status": "Analyzing file 23 of 50",
      "percentage": 46,
      "metadata": {
        "filesProcessed": 23,
        "totalFiles": 50,
        "issuesFound": 3
      }
    }
  ]
}
```

### Progress Best Practices

**For Subagents:**
```typescript
// Report progress at meaningful milestones
for (let i = 0; i < files.length; i++) {
  await analyzeFile(files[i]);
  
  // Report every 10 files
  if (i % 10 === 0) {
    await subagent_progress({
      status: `Analyzed ${i} of ${files.length} files`,
      percentage: Math.floor((i / files.length) * 100),
      metadata: { filesProcessed: i, totalFiles: files.length }
    });
  }
}
```

**Don't:**
- Report too frequently (<1 second intervals) - throttled automatically
- Report only at 0% and 100% - defeats the purpose
- Use vague statuses like "Working..." - be specific

**Do:**
- Report every 5-10% completion
- Include concrete numbers when possible
- Update when switching phases: "Analyzing → Testing → Reporting"
- Include metadata for structured tracking

---

## Streaming Results

**New in v2.0** - Get partial results before the subagent completes.

### Why Streaming Matters

For tasks that produce long outputs (reports, documentation, analyses):
- Users see results sooner (lower perceived latency)
- Early feedback if subagent is off-track
- Can act on partial results before completion

### Enabling Streaming

Add `stream: true` when spawning:

```json
{
  "tool": "sessions_spawn",
  "parameters": {
    "task": "Generate a comprehensive security audit report",
    "stream": true
  }
}
```

### How Streaming Works

```
1. Subagent starts generating response
     ↓
2. LLM streams chunks via NATS topic
     ↓
3. Gateway accumulates chunks
     ↓
4. Chunks available via subagents tool
     ↓
5. (Optional) Chunks delivered to requester in real-time
```

### Viewing Streamed Chunks

**During execution:**

```json
{
  "tool": "subagents",
  "parameters": {
    "action": "info",
    "runId": "run-abc123"
  }
}
```

**Response:**
```json
{
  "runId": "run-abc123",
  "status": "running",
  "stream": true,
  "streamChunks": [
    "# Security Audit Report\n\n",
    "## Executive Summary\n\n",
    "This audit identified 3 critical vulnerabilities:\n",
    "1. SQL injection in user login\n",
    "2. XSS in comment system\n",
    "..."
  ]
}
```

**Accumulated text:**
```
# Security Audit Report

## Executive Summary

This audit identified 3 critical vulnerabilities:
1. SQL injection in user login
2. XSS in comment system
...
```

### Real-Time Delivery (Optional)

Configure streaming to deliver chunks to the requester:

```toml
[gateway.subagent.streaming]
enabled = true
deliver_to_requester = true
chunk_throttle_ms = 500  # Min 500ms between deliveries
```

**User experience:**

**User:**
> Generate a 50-page security audit report

**Bot:**
> ✅ Spawned subagent (run-abc123, streaming enabled)

*(2 seconds later)*

**Bot:**
> 📄 **Section 1: Executive Summary**
> This audit reviewed 150 files and identified...

*(5 seconds later)*

**Bot:**
> 📄 **Section 2: Methodology**
> We used automated scanning tools combined with...

*(continues streaming sections as they're generated)*

### Streaming + Progress

Combine streaming with progress reporting for the best UX:

```typescript
// Subagent reports progress while streaming output
await subagent_progress({
  status: "Writing section 3 of 10",
  percentage: 30
});

// LLM continues streaming the actual content
```

**User sees:**
- Progress: "Writing section 3 of 10 (30%)"
- Partial output: Sections 1 and 2 already visible

---

## Workflow Orchestration

**New in v2.0** - Define multi-step workflows with dependencies.

### Why Workflows Matter

Many tasks require multiple steps in a specific order:
- **Sequential**: Research → Analyze → Summarize
- **Parallel**: Run tests + Build docs + Security scan (simultaneously)
- **Diamond**: Fetch data → [Process A, Process B] → Merge results

Workflows let you:
- Define dependencies explicitly
- Run independent steps in parallel
- Pass results between steps
- Handle failures gracefully

### Defining a Workflow

Use the `sessions_orchestrate` tool:

```json
{
  "tool": "sessions_orchestrate",
  "parameters": {
    "steps": [
      {
        "id": "research",
        "task": "Research renewable energy trends in 2025"
      },
      {
        "id": "analyze",
        "task": "Analyze the research findings",
        "dependsOn": ["research"]
      },
      {
        "id": "summarize",
        "task": "Write a 2-paragraph summary",
        "dependsOn": ["analyze"]
      }
    ],
    "label": "renewable-energy-report"
  }
}
```

**Result:**
```
✅ Workflow renewable-energy-report started (workflow-xyz789)

Step 1/3: research (running)
→ Step 2/3: analyze (queued, waiting for research)
→ Step 3/3: summarize (queued, waiting for analyze)
```

### Step Dependencies

**Linear workflow (sequential):**
```typescript
{
  steps: [
    { id: 'step1', task: 'Fetch data' },
    { id: 'step2', task: 'Process data', dependsOn: ['step1'] },
    { id: 'step3', task: 'Generate report', dependsOn: ['step2'] }
  ]
}

// Execution: step1 → step2 → step3
```

**Parallel workflow:**
```typescript
{
  steps: [
    { id: 'web', task: 'Search web' },
    { id: 'docs', task: 'Search internal docs' },
    { id: 'code', task: 'Search codebase' },
    { id: 'synthesis', task: 'Combine findings', dependsOn: ['web', 'docs', 'code'] }
  ]
}

// Execution:
// Batch 1 (parallel): web, docs, code
// Batch 2: synthesis (after all batch 1 completes)
```

**Diamond workflow:**
```typescript
{
  steps: [
    { id: 'fetch', task: 'Fetch user data' },
    { id: 'validate', task: 'Validate data', dependsOn: ['fetch'] },
    { id: 'enrich', task: 'Enrich with external data', dependsOn: ['fetch'] },
    { id: 'merge', task: 'Merge validated and enriched data', dependsOn: ['validate', 'enrich'] }
  ]
}

// Execution:
// Batch 1: fetch
// Batch 2 (parallel): validate, enrich
// Batch 3: merge
```

### Result Passing

Results from dependent steps are automatically injected:

**Step 1 (research):**
> Task: Research renewable energy trends in 2025

**Step 1 Result:**
> Solar capacity grew 45%, wind 30%...

**Step 2 (analyze) receives:**
> Task: Analyze the research findings
>
> **Results from 'research':**
> Solar capacity grew 45%, wind 30%...

The orchestrator automatically appends previous results to the task prompt.

### Per-Step Model Selection

Different steps can use different models:

```typescript
{
  steps: [
    {
      id: 'fetch',
      task: 'Fetch data from API',
      model: 'haiku'  // Fast, simple task
    },
    {
      id: 'analyze',
      task: 'Deep analysis of trends',
      dependsOn: ['fetch'],
      modelHint: 'thorough'  // Complex analysis, use Opus
    },
    {
      id: 'summarize',
      task: 'Write 2-paragraph summary',
      dependsOn: ['analyze'],
      model: 'sonnet'  // Balanced for writing
    }
  ]
}
```

### Streaming in Workflows

Enable streaming for individual steps:

```typescript
{
  steps: [
    {
      id: 'report',
      task: 'Generate 50-page security report',
      stream: true  // Stream this step's output
    }
  ]
}
```

### Workflow Management

**List workflows:**
```json
{
  "tool": "subagents",
  "parameters": {
    "action": "workflow_list"
  }
}
```

**Get workflow status:**
```json
{
  "tool": "subagents",
  "parameters": {
    "action": "workflow_info",
    "workflowId": "workflow-xyz789"
  }
}
```

**Response:**
```json
{
  "workflowId": "workflow-xyz789",
  "status": "running",
  "stepResults": {
    "research": {
      "status": "completed",
      "runId": "run-001",
      "result": "Solar capacity grew 45%...",
      "durationMs": 12500
    },
    "analyze": {
      "status": "running",
      "runId": "run-002"
    },
    "summarize": {
      "status": "queued"
    }
  },
  "currentBatch": 2,
  "totalBatches": 3
}
```

### Error Handling

**Default behavior:** Workflow stops if any step fails

```typescript
// Step 2 fails → Step 3 never runs
{
  steps: [
    { id: 'step1', task: '...' },  // ✅ Completes
    { id: 'step2', task: '...', dependsOn: ['step1'] },  // ❌ Fails
    { id: 'step3', task: '...', dependsOn: ['step2'] }   // ⏭️ Skipped
  ]
}
```

**Continue on failure:**
```typescript
{
  steps: [...],
  continueOnFailure: true  // Keep going even if steps fail
}
```

### DAG Validation

The orchestrator validates your workflow:

**Duplicate step IDs:**
```typescript
{
  steps: [
    { id: 'step1', task: '...' },
    { id: 'step1', task: '...' }  // ❌ Error: Duplicate ID
  ]
}
```

**Missing dependencies:**
```typescript
{
  steps: [
    { id: 'step1', task: '...' },
    { id: 'step2', task: '...', dependsOn: ['step3'] }  // ❌ Error: step3 doesn't exist
  ]
}
```

**Cycles:**
```typescript
{
  steps: [
    { id: 'a', task: '...', dependsOn: ['b'] },
    { id: 'b', task: '...', dependsOn: ['a'] }  // ❌ Error: Cycle detected
  ]
}
```

### Real-World Example: Bug Fix Workflow

```typescript
{
  tool: "sessions_orchestrate",
  parameters: {
    steps: [
      {
        id: 'investigate',
        task: 'Find root cause of login bug',
        model: 'opus'  // Deep investigation needs thorough model
      },
      {
        id: 'fix',
        task: 'Implement the fix based on investigation',
        dependsOn: ['investigate'],
        model: 'sonnet'
      },
      {
        id: 'test',
        task: 'Write tests to verify the fix',
        dependsOn: ['fix'],
        model: 'haiku'  // Test generation is straightforward
      },
      {
        id: 'review',
        task: 'Code review the changes',
        dependsOn: ['fix', 'test'],
        modelHint: 'thorough'
      },
      {
        id: 'document',
        task: 'Update documentation',
        dependsOn: ['review'],
        model: 'sonnet',
        stream: true  // Stream the documentation as it's written
      }
    ],
    label: 'login-bug-fix'
  }
}
```

**Execution plan:**
```
Batch 1: investigate (Opus)
Batch 2: fix (Sonnet)
Batch 3 (parallel): test (Haiku)
Batch 4: review (Opus) - waits for both fix AND test
Batch 5: document (Sonnet, streaming)
```

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

# Model Selection (New in v2.0)
[gateway.subagent.models]
# Model aliases (customize as needed)
haiku = "anthropic.claude-haiku-4-5-20251001-v1:0"
sonnet = "anthropic.claude-sonnet-4-6"
opus = "anthropic.claude-opus-4-6-v1"
fast = "anthropic.claude-haiku-4-5-20251001-v1:0"
balanced = "anthropic.claude-sonnet-4-6"
thorough = "anthropic.claude-opus-4-6-v1"

# Enable automatic model selection based on task complexity
auto_select = true

# Default model when no model/hint specified
default_model = "sonnet"

# Streaming Results (New in v2.0)
[gateway.subagent.streaming]
enabled = true
deliver_to_requester = true  # Send chunks to user in real-time
chunk_throttle_ms = 500      # Min time between chunk deliveries

# Workflows (New in v2.0)
[gateway.subagent.workflows]
max_steps = 50    # Maximum steps per workflow (prevent workflow bombs)
max_depth = 5     # Maximum nested workflow depth
```

### Per-Request Configuration

When spawning subagents programmatically (via tool calls):

```json
{
  "tool": "sessions_spawn",
  "parameters": {
    "task": "Research quantum computing",
    "label": "quantum-research",
    "model": "sonnet",
    "thinking": "high",
    "runTimeoutSeconds": 600,
    "cleanup": "delete",
    "stream": true
  }
}
```

**Parameters:**
- `task` - Task description (required)
- `label` - Human-readable label (optional)
- `model` - Model ID or alias: haiku/sonnet/opus (optional, **new in v2.0**)
- `modelHint` - Model hint: fast/balanced/thorough (optional, **new in v2.0**)
- `thinking` - Thinking level: low/medium/high (optional)
- `runTimeoutSeconds` - Max execution time (optional, default: 300)
- `cleanup` - "delete" or "keep" workspace after completion (optional, default: "keep")
- `stream` - Enable streaming results (optional, default: false, **new in v2.0**)

**Workflow orchestration:**

```json
{
  "tool": "sessions_orchestrate",
  "parameters": {
    "steps": [
      {
        "id": "step1",
        "task": "First step",
        "model": "haiku",
        "stream": false
      },
      {
        "id": "step2",
        "task": "Second step",
        "dependsOn": ["step1"],
        "modelHint": "thorough"
      }
    ],
    "label": "my-workflow",
    "continueOnFailure": false
  }
}
```

**Workflow parameters:**
- `steps` - Array of workflow steps (required)
  - `id` - Unique step identifier (required)
  - `task` - Task description (required)
  - `dependsOn` - Array of step IDs this depends on (optional)
  - `model` - Model for this step (optional)
  - `modelHint` - Model hint for this step (optional)
  - `stream` - Enable streaming for this step (optional)
- `label` - Human-readable workflow label (optional)
- `continueOnFailure` - Continue even if steps fail (optional, default: false)

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

### Model Selection Issues

**Symptom:** Wrong model selected for task

**Causes:**
- Auto-selection heuristics chose poorly
- Model alias not configured

**Solutions:**
1. **Override with explicit model:**
   ```json
   { "model": "opus" }  // Force Opus
   ```

2. **Use model hint:**
   ```json
   { "modelHint": "thorough" }  // Request thorough analysis
   ```

3. **Disable auto-selection:**
   ```toml
   [gateway.subagent.models]
   auto_select = false
   default_model = "sonnet"  # Always use Sonnet
   ```

4. **Check configured aliases:**
   ```bash
   grep -A 10 "\[gateway.subagent.models\]" nachos.toml
   ```

**Symptom:** "Unknown model" error

**Cause:** Invalid model ID or alias

**Solution:** Use valid aliases (haiku/sonnet/opus) or full model IDs:
```json
{
  "model": "anthropic.claude-sonnet-4-6"
}
```

### Progress Not Updating

**Symptom:** No progress updates visible

**Causes:**
1. Subagent isn't calling `subagent_progress` tool
2. Progress updates throttled (too frequent)
3. Querying wrong run ID

**Solutions:**
1. **Check if subagent supports progress:**
   - Not all tasks report progress
   - Long-running tasks (>1 minute) should

2. **Check throttling:**
   - Min 1 second between updates (enforced)
   - Subagent may be calling too frequently

3. **Verify run ID:**
   ```json
   {
     "tool": "subagents",
     "parameters": {
       "action": "info",
       "runId": "run-abc123"
     }
   }
   ```

### Streaming Not Working

**Symptom:** No stream chunks received

**Causes:**
1. Streaming not enabled in request
2. Streaming disabled in config
3. Model doesn't support streaming
4. Subagent completed before chunks delivered

**Solutions:**
1. **Enable streaming in request:**
   ```json
   { "stream": true }
   ```

2. **Check config:**
   ```toml
   [gateway.subagent.streaming]
   enabled = true
   ```

3. **Check stream chunks:**
   ```json
   {
     "tool": "subagents",
     "parameters": {
       "action": "info",
       "runId": "run-abc123"
     }
   }
   ```
   Response should include `"stream": true` and `"streamChunks": [...]`

4. **Verify real-time delivery:**
   ```toml
   [gateway.subagent.streaming]
   deliver_to_requester = true  # Must be enabled for real-time delivery
   ```

### Workflow Validation Errors

**Symptom:** "Cycle detected" error

**Cause:** Steps have circular dependencies

**Example:**
```typescript
// ❌ Bad: A depends on B, B depends on A
{
  steps: [
    { id: 'a', task: '...', dependsOn: ['b'] },
    { id: 'b', task: '...', dependsOn: ['a'] }
  ]
}
```

**Solution:** Remove circular dependencies:
```typescript
// ✅ Good: Linear dependency
{
  steps: [
    { id: 'a', task: '...' },
    { id: 'b', task: '...', dependsOn: ['a'] }
  ]
}
```

**Symptom:** "Missing dependency" error

**Cause:** Step depends on non-existent step

**Example:**
```typescript
// ❌ Bad: step3 doesn't exist
{
  steps: [
    { id: 'step1', task: '...' },
    { id: 'step2', task: '...', dependsOn: ['step3'] }
  ]
}
```

**Solution:** Fix step ID or remove invalid dependency:
```typescript
// ✅ Good: Correct dependency
{
  steps: [
    { id: 'step1', task: '...' },
    { id: 'step2', task: '...', dependsOn: ['step1'] }
  ]
}
```

**Symptom:** "Workflow too large" error

**Cause:** Exceeds max steps limit (default: 50)

**Solutions:**
1. **Split into smaller workflows**
2. **Increase limit (admin only):**
   ```toml
   [gateway.subagent.workflows]
   max_steps = 100
   ```

### Workflow Execution Stuck

**Symptom:** Workflow status "running" but no progress

**Causes:**
1. Step failed but `continueOnFailure` is false (default)
2. Step is actually running but taking a long time
3. Concurrency limit reached (other subagents blocking)

**Solutions:**
1. **Check step status:**
   ```json
   {
     "tool": "subagents",
     "parameters": {
       "action": "workflow_info",
       "workflowId": "workflow-xyz789"
     }
   }
   ```
   Look for failed steps.

2. **Enable continue on failure:**
   ```json
   {
     "continueOnFailure": true
   }
   ```

3. **Check concurrency:**
   - Workflows share concurrency limit with regular subagents
   - If max_concurrent=2 and 2 other subagents are running, workflow waits

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
- [ADR-004](../architecture/decisions/004-subagent-orchestration-enhancements.md) - Orchestration enhancements design
- [Configuration Reference](../config/gateway.md) - Full subagent config options
- [Tool Reference](../tools/README.md) - Tool API documentation

**Key tools:**
- `sessions_spawn` - Spawn individual subagents
- `sessions_orchestrate` - Define multi-step workflows
- `subagents` - Monitor and manage subagents/workflows
- `subagent_progress` - Report progress from within subagents

---

**Questions?** Join our Discord: https://discord.com/invite/nachos
