# Subagent Architecture

**Version:** 1.0  
**Last Updated:** 2026-02-22  
**Audience:** Developers, Contributors

---

## Overview

This document describes the internal architecture of the Nachos subagent system, including component design, data flow, and extension points.

---

## Components

### 1. SubagentManager

**Location:** `packages/core/gateway/src/subagents/subagent-manager.ts`

**Responsibilities:**
- Execute individual subagent tasks
- Support Docker sandbox isolation
- Handle timeouts and errors

**Interface:**
```typescript
class SubagentManager {
  constructor(
    config: SubagentManagerConfig,
    sendRequest: LLMRequestSender
  );

  async run(task: SubagentTask): Promise<SubagentResult>;
}
```

**Execution Modes:**
- **`host` mode** - Run directly in gateway process (lightweight, less isolated)
- **`full` mode** - Run in Docker container (fully isolated, more overhead)

**Implementation:**
```typescript
async run(task: SubagentTask): Promise<SubagentResult> {
  const mode = task.sandboxMode ?? this.mode;

  if (mode === 'full') {
    // Use Docker sandbox
    return this.dockerSandbox.run(task);
  }

  // Run in-process
  const response = await this.sendRequest(task.request);
  return { success: response.success, response, ... };
}
```

---

### 2. SubagentOrchestrator

**Location:** `packages/core/gateway/src/subagents/subagent-orchestrator.ts`

**Responsibilities:**
- Queue management (FIFO with concurrency limit)
- Session creation and lifecycle
- Workspace provisioning
- Result aggregation and announcement
- Access control (users can only manage their own runs)

**Interface:**
```typescript
class SubagentOrchestrator {
  async enqueue(request: SubagentRunRequest): Promise<SubagentRunRecord>;
  listRuns(): SubagentRunRecord[];
  getRun(runId: string): SubagentRunRecord | null;
  getRunResult(runId: string): SubagentResult | undefined;
  getRunWorkspaceDir(runId: string): string | null;
  stopRun(runId: string): boolean;
  async steerRun(runId: string, message: string): Promise<boolean>;
  async shutdown(): Promise<void>;
}
```

**State Machine:**
```
queued → running → completed
              ↓
            failed
              ↓
          cancelled (via stopRun)
```

**Concurrency Control:**
```typescript
private maxConcurrent: number;
private runningCount: number = 0;
private queue: string[] = [];

private drainQueue(): void {
  while (this.runningCount < this.maxConcurrent && this.queue.length > 0) {
    const runId = this.queue.shift();
    void this.executeRun(runId);
  }
}
```

---

### 3. Workspace Utils

**Location:** `packages/core/gateway/src/subagents/workspace-utils.ts`

**Functions:**
- `ensureSubagentWorkspaceDir(rootDir, runId)` - Create isolated workspace
- `listSubagentWorkspaceEntries(...)` - List files with path traversal protection
- `readSubagentWorkspaceFile(...)` - Read files with size limits

**Security:**
```typescript
// Path traversal prevention
const normalized = path.normalize(relativePath);
if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
  throw new Error('Path traversal attempt detected');
}
```

---

### 4. Announce Pipeline

**Location:** `packages/core/gateway/src/subagents/announce.ts`

**Responsibilities:**
- Extract key results from subagent execution
- Generate user-friendly summaries
- Template-based or LLM-generated announcements

**Flow:**
```
Subagent completes
     ↓
Extract response text
     ↓
Build announce prompt (template or custom)
     ↓
Send to LLM for summary
     ↓
Publish announcement to requester channel
```

**Templates:**
```typescript
const defaultTemplate = `
Subagent {{runId}} has completed.

Task: {{task}}
Status: {{status}}
Duration: {{duration}}

Results:
{{responseText}}

Please summarize this for the user in 2-3 sentences.
`;
```

---

## Data Flow

### Spawning a Subagent

```
1. User sends message
     ↓
2. Main session processes with LLM
     ↓
3. LLM calls sessions_spawn tool
     ↓
4. Gateway.executeLocalToolCall()
     ↓
5. SubagentOrchestrator.enqueue()
     ├→ Create SubagentRunRecord
     ├→ Generate runId (UUID)
     ├→ Provision workspace (if configured)
     ├→ Create child session
     ├→ Add user message to child session
     └→ Add to queue
     ↓
6. SubagentOrchestrator.drainQueue()
     ├→ Check concurrency limit
     └→ Execute if slot available
     ↓
7. SubagentOrchestrator.executeRun()
     ├→ Update status: 'running'
     ├→ Build LLM request from child session
     ├→ Call SubagentManager.run()
     └→ Wait for result
     ↓
8. SubagentManager.run()
     ├→ Send LLM request
     ├→ Handle response
     └→ Return SubagentResult
     ↓
9. SubagentOrchestrator.announce()
     ├→ Extract response text
     ├→ Build announcement prompt
     ├→ Send to LLM for summary
     ├→ Publish to requester channel
     └→ Update status: 'completed'
```

### Steering a Subagent

```
1. User: "Tell run-abc123 to focus on X"
     ↓
2. LLM calls subagents tool (action: steer)
     ↓
3. Gateway.executeSubagentsToolCall()
     ↓
4. Gateway.steerSubagent(runId, message)
     ↓
5. SubagentOrchestrator.steerRun(runId, message)
     ├→ Validate run status === 'running'
     ├→ Add user message to child session
     └→ Return true
     ↓
6. Subagent continues execution with new message in context
```

### Stopping a Subagent

```
1. User: "Stop run-abc123"
     ↓
2. LLM calls subagents tool (action: stop)
     ↓
3. Gateway.executeSubagentsToolCall()
     ↓
4. Gateway.stopSubagent(runId)
     ↓
5. SubagentOrchestrator.stopRun(runId)
     ├→ Validate run status === 'queued'
     ├→ Update status: 'cancelled'
     ├→ Remove from queue
     └→ Return true

Note: Cannot stop 'running' subagents (will complete or timeout)
```

---

## Session Metadata

Child sessions (subagent sessions) include metadata:

```typescript
{
  subagent: {
    runId: string;
    label?: string;
    profile?: string;
    agentId?: string;
    requester: {
      sessionId: string;
      channel: string;
      conversationId: string;
      userId?: string;
      replyToMessageId?: string;
    };
    workspaceDir?: string;
  }
}
```

**Access control:**
```typescript
private canAccessSubagentRun(session: Session, run: SubagentRunRecord): boolean {
  if (session.id === run.requester.sessionId) {
    return true;
  }
  if (session.userId && run.requester.userId && session.userId === run.requester.userId) {
    return true;
  }
  return false;
}
```

---

## Tool Integration

### sessions_spawn

**Schema:**
```typescript
{
  task: string;              // Required
  label?: string;
  profile?: string;
  agentId?: string;
  model?: string;
  thinking?: 'low' | 'medium' | 'high';
  cleanup?: 'delete' | 'keep';
  runTimeoutSeconds?: number;
}
```

**Response:**
```json
{
  "status": "accepted",
  "runId": "run-abc123",
  "childSessionId": "session-child-xyz"
}
```

### subagents

**Actions:**
- `list` - List all runs for current session
- `info` - Get detailed info for a specific run
- `log` - Retrieve conversation log (last N messages)
- `stop` - Stop a queued run
- `steer` - Send message to running subagent
- `files_list` - List files in subagent workspace
- `files_get` - Read file from subagent workspace

---

## Extension Points

### 1. Custom Announcement Templates

Override the default announcement behavior:

```toml
[gateway.subagent.announce]
enabled = true
prompt = """
Summarize the subagent results in this format:
- Task: [task description]
- Key Findings: [bullet points]
- Recommendations: [if applicable]
"""
```

### 2. Custom Sandbox Implementations

Extend `SubagentSandbox` interface:

```typescript
interface SubagentSandbox {
  run(task: SubagentTask): Promise<SubagentResult>;
}
```

Examples:
- `DockerSubagentSandbox` (built-in)
- `K8sSubagentSandbox` (future)
- `VMSubagentSandbox` (future)

### 3. Custom Result Processors

Hook into the result aggregation:

```typescript
class CustomResultAggregator {
  async collectResults(runId: string): Promise<SubagentResult> {
    // Extract artifacts, metrics, etc.
  }
  
  async summarize(result: SubagentResult): Promise<string> {
    // Custom summary logic
  }
}
```

### 4. Event Listeners

Subscribe to subagent events:

```typescript
// Future: NATS topics for subagent lifecycle
SUBAGENT_TOPICS.spawned(runId)
SUBAGENT_TOPICS.progress(runId)
SUBAGENT_TOPICS.complete(runId)
SUBAGENT_TOPICS.error(runId)
SUBAGENT_TOPICS.killed(runId)
```

---

## Configuration Schema

```typescript
interface SubagentManagerConfig {
  mode: 'host' | 'full';
  docker?: {
    image: string;
    network?: string;
    memoryLimit?: string;
    cpuShares?: number;
    timeoutMs?: number;
  };
}

interface SubagentOrchestratorConfig {
  maxConcurrent: number;
  announce?: {
    enabled: boolean;
    prompt?: string;
  };
}
```

**Config file (`nachos.toml`):**
```toml
[gateway.subagent]
mode = "host"
max_concurrent = 2

[gateway.subagent.announce]
enabled = true

[gateway.subagent.docker]
image = "nachos/subagent-sandbox:latest"
network = "none"
memory_limit = "512m"
cpu_shares = 512
timeout_ms = 300000
```

---

## Testing

### Unit Tests

**Example:**
```typescript
import { SubagentOrchestrator } from './subagent-orchestrator';

describe('SubagentOrchestrator', () => {
  it('should enqueue and execute a subagent run', async () => {
    const orchestrator = new SubagentOrchestrator(deps);
    const run = await orchestrator.enqueue({
      task: 'Test task',
      requester: { sessionId: 'main', channel: 'test', conversationId: 'conv' },
    });
    
    expect(run.status).toBe('queued');
  });
});
```

### Integration Tests

**Test scenarios:**
1. Spawn → Complete → Announce
2. Spawn → Timeout
3. Spawn → Stop (queued)
4. Spawn → Steer → Complete
5. Multiple concurrent subagents
6. Access control (can't access other users' runs)

---

## Performance Considerations

### Memory

- Each subagent session: ~1-2 MB (messages + metadata)
- Workspace files: Configurable, default max 50 MB
- Docker containers: 512 MB default limit

**Scaling:**
- 10 concurrent subagents: ~20-30 MB
- 100 runs in history: ~100-200 MB

### CPU

- Host mode: Shares gateway CPU (minimal overhead)
- Full mode: Docker container isolation (higher overhead but safe)

### Concurrency

- Default: `maxConcurrent = 2` (conservative)
- Recommended: 4-8 for moderate load
- High-end: 16-32 (requires more RAM and CPU)

**Tuning:**
```toml
[gateway.subagent]
max_concurrent = 8  # Adjust based on your resources
```

---

## Security

### Isolation

- **Workspace:** Each run gets a unique directory
- **Session:** Separate session state (no cross-contamination)
- **Docker:** Full container isolation (network=none by default)

### Access Control

Users can only:
- List their own subagent runs
- Stop/steer their own subagents
- Access workspaces of their own subagents

**Implementation:**
```typescript
if (session.id !== run.requester.sessionId && 
    session.userId !== run.requester.userId) {
  return formatToolError('NOT_FOUND', 'Subagent run not found');
}
```

### Path Traversal Protection

```typescript
const normalized = path.normalize(relativePath);
if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
  throw new Error('Path traversal detected');
}
const fullPath = path.join(workspaceDir, normalized);
if (!fullPath.startsWith(workspaceDir)) {
  throw new Error('Path outside workspace');
}
```

---

## Future Enhancements

### 1. Progress Updates

Emit periodic status events:

```typescript
SUBAGENT_TOPICS.progress(runId)
// Payload: { runId, message: "Processing file 3 of 10..." }
```

### 2. Subagent-to-Subagent Communication

Allow subagents to spawn child subagents:

```typescript
// Subagent A spawns Subagent B
const run = await spawnSubagent({
  task: "Analyze results from previous step",
  parent: runIdA,
});
```

### 3. Dependency Graphs

Define multi-step workflows:

```typescript
const workflow = {
  steps: [
    { id: 'research', task: 'Research topic X' },
    { id: 'analyze', task: 'Analyze research', depends: ['research'] },
    { id: 'summarize', task: 'Summarize findings', depends: ['analyze'] },
  ],
};
```

### 4. Cost Tracking

Track LLM usage per subagent:

```typescript
{
  runId: 'run-abc123',
  cost: {
    inputTokens: 1500,
    outputTokens: 800,
    totalCost: 0.025,  // USD
  },
}
```

### 5. Admin UI Integration

Visual monitoring dashboard:
- Active subagents graph
- Queue length
- Average execution time
- Success/failure rates

---

## Debugging

### Enable Debug Logging

```bash
export DEBUG="nachos:subagent:*"
npm start
```

### Common Issues

**Subagent stuck in 'queued' state:**
- Check `max_concurrent` limit
- Verify running subagents are completing
- Increase timeout if needed

**Workspace files not created:**
- Ensure `workspaceRoot` is configured
- Check file system permissions
- Verify disk space

**Docker sandbox fails:**
- Check Docker daemon is running
- Verify image is pulled: `docker pull nachos/subagent-sandbox`
- Check memory limits

---

## See Also

- [User Guide](../guides/subagents.md) - How to use subagents
- [Configuration Reference](../config/gateway.md) - Full config options
- [Tool Reference](../tools/sessions_spawn.md) - API docs

---

**Contributing:** Found a bug or want to improve subagents? Open an issue on [GitHub](https://github.com/Nacho-Labs-LLC/nachos).
