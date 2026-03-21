# Subagent Architecture

**Version:** 2.0  
**Last Updated:** 2026-02-24  
**Audience:** Developers, Contributors

---

## Overview

This document describes the internal architecture of the Nachos subagent system,
including component design, data flow, and extension points.

**What's new in v2.0:**

- Model selection and auto-routing
- Progress reporting
- Streaming results via NATS
- Workflow orchestration with dependency graphs

See [ADR-004](decisions/004-subagent-orchestration-enhancements.md) for the
design rationale.

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
  constructor(config: SubagentManagerConfig, sendRequest: LLMRequestSender);

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
- `listSubagentWorkspaceEntries(...)` - List files with path traversal
  protection
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

### 5. Model Selection

**New in v2.0**

**Location:** `packages/core/gateway/src/subagents/model-selection.ts`

**Responsibilities:**

- Resolve model aliases (haiku → full model ID)
- Auto-select model based on task complexity
- Apply model hints (fast/balanced/thorough)

**Interface:**

```typescript
function selectModel(
  task: string,
  options: {
    model?: string;
    modelHint?: 'fast' | 'balanced' | 'thorough';
  },
  config: ModelSelectionConfig
): string;
```

**Selection Priority:**

```
1. Explicit model parameter → resolve alias → return
2. Model hint (fast/balanced/thorough) → resolve → return
3. Auto-selection enabled? → analyze task → select
4. Default model from config → return
5. Fallback to Sonnet
```

**Auto-Selection Heuristics:**

```typescript
function analyzeTaskComplexity(task: string): ComplexityIndicators {
  const wordCount = task.split(/\s+/).length;

  // Complex analysis keywords → Opus
  const complexKeywords = [
    'analyze',
    'review',
    'audit',
    'investigate',
    'comprehensive',
  ];

  // Code analysis keywords → Opus
  const codeKeywords = ['codebase', 'vulnerabilities', 'refactor', 'bugs'];

  // Multi-step indicators → Opus
  const multiStepKeywords = ['then', 'after', 'steps', 'first', 'second'];
  const hasNumberedList = (task.match(/\d+\./g)?.length ?? 0) > 1;

  if (hasComplexOrCodeKeywords || hasMultipleSteps) return 'opus';
  if (wordCount > 40) return 'opus';
  if (wordCount < 8 && !hasKeywords) return 'haiku';
  return 'sonnet'; // Default
}
```

**Model Aliases (Default):**

```typescript
const DEFAULT_MODEL_ALIASES = {
  haiku: 'anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'anthropic.claude-sonnet-4-6',
  opus: 'anthropic.claude-opus-4-6-v1',
  fast: 'anthropic.claude-haiku-4-5-20251001-v1:0',
  balanced: 'anthropic.claude-sonnet-4-6',
  thorough: 'anthropic.claude-opus-4-6-v1',
};
```

**Cost Multipliers:**

```typescript
function getModelCostMultiplier(modelId: string): number {
  if (modelId.includes('haiku')) return 1.0; // Baseline
  if (modelId.includes('sonnet')) return 3.0; // 3× Haiku
  if (modelId.includes('opus')) return 5.0; // 5× Haiku
  return 1.0;
}
```

---

### 6. Progress Reporting

**New in v2.0**

**Location:** `packages/core/gateway/src/subagents/subagent-orchestrator.ts`

**Type Definitions:**

```typescript
interface SubagentProgressUpdate {
  timestamp: string;
  status: string;
  percentage?: number;
  metadata?: Record<string, unknown>;
}

interface SubagentRunRecord {
  // ... existing fields
  progress?: SubagentProgressUpdate[];
}
```

**API:**

```typescript
class SubagentOrchestrator {
  reportProgress(
    runId: string,
    update: {
      status: string;
      percentage?: number;
      metadata?: Record<string, unknown>;
    }
  ): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'running')
      throw new Error('Can only report progress for running subagents');

    // Throttle updates (min 1 second interval)
    const lastUpdate = run.progress?.[run.progress.length - 1];
    if (lastUpdate) {
      const elapsed = Date.now() - new Date(lastUpdate.timestamp).getTime();
      if (elapsed < 1000) return; // Throttled
    }

    run.progress = run.progress ?? [];
    run.progress.push({
      timestamp: new Date().toISOString(),
      status: update.status,
      percentage: update.percentage,
      metadata: update.metadata,
    });
  }
}
```

**Tool Integration:**

```typescript
// Subagents call this tool to report progress
{
  tool: "subagent_progress",
  parameters: {
    status: "Processing file 23 of 50",
    percentage: 46,
    metadata: { filesProcessed: 23, totalFiles: 50 }
  }
}
```

**Gateway Handler:**

```typescript
// In gateway.ts
if (call.tool === 'subagent_progress') {
  const subagentMeta = session.metadata?.subagent;
  if (!subagentMeta) {
    return formatToolError('NOT_ALLOWED', 'Only subagents can report progress');
  }

  this.orchestrator.reportProgress(subagentMeta.runId, {
    status: call.parameters.status,
    percentage: call.parameters.percentage,
    metadata: call.parameters.metadata,
  });

  return {
    success: true,
    content: [{ type: 'text', text: 'Progress updated' }],
  };
}
```

---

### 7. Streaming Results

**New in v2.0**

**Location:** `packages/core/gateway/src/subagents/subagent-orchestrator.ts`

**Type Definitions:**

```typescript
interface SubagentRunRequest {
  // ... existing fields
  stream?: boolean;
}

interface SubagentRunRecord {
  // ... existing fields
  stream?: boolean;
  streamChunks?: string[];
}
```

**NATS Topic Structure:**

```typescript
const STREAM_TOPIC = `nachos.llm.stream.${childSessionId}`;
```

**Implementation Flow:**

```typescript
class SubagentOrchestrator {
  private async executeRun(runId: string): Promise<void> {
    const run = this.runs.get(runId)!;

    // Subscribe to stream if enabled
    let streamSubscription;
    if (run.stream) {
      streamSubscription = this.nats.subscribe(
        `nachos.llm.stream.${run.childSessionId}`,
        (msg) => {
          const delta = msg.data.delta;
          if (delta?.text) {
            run.streamChunks = run.streamChunks ?? [];
            run.streamChunks.push(delta.text);

            // Optional: deliver to requester in real-time
            if (this.config.streaming?.deliverToRequester) {
              this.deliverChunkToRequester(run, delta.text);
            }
          }
        }
      );
    }

    try {
      // Execute subagent
      const result = await this.manager.run(task);
      run.status = 'completed';
    } finally {
      // Cleanup subscription
      if (streamSubscription) {
        await streamSubscription.unsubscribe();
      }
    }
  }
}
```

**Chunk Accumulation:**

```typescript
// Stream chunks are accumulated in order
run.streamChunks = [
  '# Report\n\n',
  '## Introduction\n',
  'This is the first section...',
  '## Analysis\n',
  '...',
];

// Full accumulated text
const fullText = run.streamChunks.join('');
```

**Real-Time Delivery (Optional):**

```typescript
private async deliverChunkToRequester(run: SubagentRunRecord, chunk: string): Promise<void> {
  // Throttle delivery (default: 500ms)
  const now = Date.now();
  if (now - this.lastChunkDelivery < (this.config.streaming?.chunkThrottleMs ?? 500)) {
    return; // Skip this chunk
  }
  this.lastChunkDelivery = now;

  // Send to requester channel
  await this.sendMessage(run.requester.channel, {
    conversationId: run.requester.conversationId,
    text: `📄 [${run.label ?? run.runId}] ${chunk}`,
  });
}
```

---

### 8. Workflow Orchestration

**New in v2.0**

**Location:** `packages/core/gateway/src/subagents/`

**Key Files:**

- `dependency-graph.ts` - DAG validation and topological sort
- `subagent-orchestrator.ts` - Workflow execution engine

**Type Definitions:**

```typescript
interface WorkflowStep {
  id: string;
  task: string;
  dependsOn?: string[];
  model?: string;
  modelHint?: 'fast' | 'balanced' | 'thorough';
  stream?: boolean;
}

interface WorkflowDefinition {
  steps: WorkflowStep[];
}

type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface WorkflowStepResult {
  stepId: string;
  runId: string;
  status: SubagentRunStatus;
  result?: string;
  error?: { code: string; message: string };
  durationMs?: number;
}

interface WorkflowRunRecord {
  workflowId: string;
  status: WorkflowRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  requester: SubagentRequesterInfo;
  stepResults: Map<string, WorkflowStepResult>;
  currentBatch?: number;
  totalBatches?: number;
  durationMs?: number;
  error?: { code: string; message: string };
}
```

**DAG Validation:**

```typescript
// In dependency-graph.ts
function validateWorkflow(
  workflow: WorkflowDefinition
): WorkflowValidationResult {
  // 1. Check for duplicate step IDs
  const stepIds = new Set<string>();
  for (const step of workflow.steps) {
    if (stepIds.has(step.id)) {
      return {
        valid: false,
        error: { code: 'DUPLICATE_STEP_ID', stepId: step.id },
      };
    }
    stepIds.add(step.id);
  }

  // 2. Check for missing dependencies
  const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
  for (const step of workflow.steps) {
    for (const depId of step.dependsOn ?? []) {
      if (!stepMap.has(depId)) {
        return {
          valid: false,
          error: { code: 'MISSING_DEPENDENCY', stepId: step.id },
        };
      }
    }
  }

  // 3. Check for cycles using DFS
  const cycleCheck = detectCycle(stepMap);
  if (!cycleCheck.valid) return cycleCheck;

  return { valid: true };
}
```

**Cycle Detection (DFS):**

```typescript
function detectCycle(
  stepMap: Map<string, WorkflowStep>
): WorkflowValidationResult {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(stepId: string): boolean {
    if (recursionStack.has(stepId)) return true; // Cycle found
    if (visited.has(stepId)) return false; // Already processed

    visited.add(stepId);
    recursionStack.add(stepId);

    const step = stepMap.get(stepId)!;
    for (const depId of step.dependsOn ?? []) {
      if (dfs(depId)) return true;
    }

    recursionStack.delete(stepId);
    return false;
  }

  for (const stepId of stepMap.keys()) {
    if (dfs(stepId)) {
      return { valid: false, error: { code: 'CYCLE_DETECTED' } };
    }
  }

  return { valid: true };
}
```

**Topological Sort (Kahn's Algorithm):**

```typescript
function computeExecutionPlan(workflow: WorkflowDefinition): ExecutionPlan {
  const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Build adjacency list and in-degree map
  for (const step of workflow.steps) {
    inDegree.set(step.id, 0);
    adjList.set(step.id, []);
  }

  for (const step of workflow.steps) {
    for (const depId of step.dependsOn ?? []) {
      adjList.get(depId)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm: process nodes with in-degree 0
  const batches: string[][] = [];
  const queue: string[] = [];

  for (const [stepId, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(stepId);
  }

  while (queue.length > 0) {
    const batch = [...queue];
    batches.push(batch);
    queue.length = 0;

    for (const stepId of batch) {
      for (const neighbor of adjList.get(stepId)!) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }
  }

  return { batches, steps: stepMap };
}
```

**Workflow Execution Engine:**

```typescript
class SubagentOrchestrator {
  async enqueueWorkflow(
    request: WorkflowOrchestrationRequest
  ): Promise<WorkflowRunRecord> {
    const workflowId = `workflow-${uuid()}`;

    // Validate DAG
    const validation = validateWorkflow({ steps: request.steps });
    if (!validation.valid) {
      throw new Error(validation.error!.message);
    }

    // Compute execution plan (topological sort)
    const plan = computeExecutionPlan({ steps: request.steps });

    // Create workflow record
    const workflow: WorkflowRunRecord = {
      workflowId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      requester: request.requester,
      stepResults: new Map(),
      totalBatches: plan.batches.length,
    };

    this.workflows.set(workflowId, workflow);

    // Start execution
    void this.executeWorkflow(workflowId, plan);

    return workflow;
  }

  private async executeWorkflow(
    workflowId: string,
    plan: ExecutionPlan
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId)!;
    workflow.status = 'running';
    workflow.startedAt = new Date().toISOString();

    try {
      // Execute batches sequentially
      for (let i = 0; i < plan.batches.length; i++) {
        workflow.currentBatch = i + 1;
        const batch = plan.batches[i];

        // Execute batch steps in parallel
        await Promise.all(
          batch.map((stepId) =>
            this.executeWorkflowStep(workflowId, stepId, plan)
          )
        );

        // Check for failures
        const hasFailures = batch.some((stepId) => {
          const result = workflow.stepResults.get(stepId);
          return result && result.status === 'failed';
        });

        if (hasFailures && !request.continueOnFailure) {
          workflow.status = 'failed';
          workflow.error = {
            code: 'STEP_FAILED',
            message: 'Workflow stopped due to step failure',
          };
          return;
        }
      }

      workflow.status = 'completed';
    } catch (error) {
      workflow.status = 'failed';
      workflow.error = { code: 'EXECUTION_ERROR', message: String(error) };
    } finally {
      workflow.completedAt = new Date().toISOString();
      workflow.durationMs =
        new Date(workflow.completedAt).getTime() -
        new Date(workflow.startedAt!).getTime();
    }
  }

  private async executeWorkflowStep(
    workflowId: string,
    stepId: string,
    plan: ExecutionPlan
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId)!;
    const step = plan.steps.get(stepId)!;

    // Build task prompt with dependencies' results
    let taskPrompt = step.task;
    if (step.dependsOn && step.dependsOn.length > 0) {
      taskPrompt += '\n\n**Results from dependent steps:**\n';
      for (const depId of step.dependsOn) {
        const depResult = workflow.stepResults.get(depId);
        if (depResult && depResult.result) {
          taskPrompt += `\n**Step '${depId}':**\n${depResult.result}\n`;
        }
      }
    }

    // Spawn subagent for this step
    const run = await this.enqueue({
      task: taskPrompt,
      label: `${workflowId}:${stepId}`,
      requester: workflow.requester,
      model: step.model,
      modelHint: step.modelHint,
      stream: step.stream,
    });

    // Mark step as belonging to workflow
    run.workflowId = workflowId;
    run.stepId = stepId;

    // Wait for completion
    await this.waitForRunCompletion(run.runId);

    // Record step result
    const completedRun = this.runs.get(run.runId)!;
    workflow.stepResults.set(stepId, {
      stepId,
      runId: run.runId,
      status: completedRun.status,
      result:
        completedRun.status === 'completed'
          ? this.extractResultText(completedRun)
          : undefined,
      error: completedRun.error,
      durationMs: completedRun.durationMs,
    });
  }
}
```

---

## Data Flow

### Spawning a Subagent (Basic)

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
     ├→ Select model (if auto-select enabled) [NEW v2.0]
     ├→ Create SubagentRunRecord
     ├→ Generate runId (UUID)
     ├→ Provision workspace (if configured)
     ├→ Create child session with selected model [NEW v2.0]
     ├→ Add user message to child session
     ├→ Subscribe to stream topic (if stream=true) [NEW v2.0]
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
     ├→ Send LLM request (with selected model) [NEW v2.0]
     ├→ Handle response
     ├→ Stream chunks accumulated (if enabled) [NEW v2.0]
     └→ Return SubagentResult
     ↓
9. SubagentOrchestrator.announce()
     ├→ Extract response text
     ├→ Build announcement prompt
     ├→ Send to LLM for summary
     ├→ Publish to requester channel
     ├→ Unsubscribe from stream topic [NEW v2.0]
     └→ Update status: 'completed'
```

### Progress Reporting Flow (New v2.0)

```
1. Subagent running, calls subagent_progress tool
     ↓
2. Gateway.executeLocalToolCall()
     ├→ Verify caller is a subagent (check session.metadata.subagent)
     └→ Extract runId from session metadata
     ↓
3. SubagentOrchestrator.reportProgress(runId, update)
     ├→ Validate run exists and status === 'running'
     ├→ Throttle check (min 1 second since last update)
     ├→ Append progress update to run.progress[]
     └→ Return success
     ↓
4. User queries progress via subagents tool (action: info)
     ↓
5. Response includes progress array with all updates
```

### Streaming Flow (New v2.0)

```
1. sessions_spawn called with stream=true
     ↓
2. SubagentOrchestrator.enqueue()
     ├→ Set run.stream = true
     ├→ Initialize run.streamChunks = []
     └→ Subscribe to NATS topic: nachos.llm.stream.{childSessionId}
     ↓
3. SubagentManager.run() sends LLM request
     ↓
4. LLM begins streaming response
     ↓
5. For each chunk received:
     ├→ NATS publishes to nachos.llm.stream.{childSessionId}
     ├→ SubagentOrchestrator receives chunk
     ├→ Appends delta.text to run.streamChunks[]
     └→ (Optional) Delivers to requester if deliverToRequester=true
     ↓
6. LLM completes response
     ↓
7. SubagentOrchestrator.executeRun() finishes
     ├→ Unsubscribe from NATS topic
     ├→ run.streamChunks contains full accumulated text
     └→ Announce completion
     ↓
8. User queries run via subagents tool (action: info)
     └→ Response includes streamChunks array
```

**NATS Topics:**

```typescript
// Streaming topic (per child session)
const STREAM_TOPIC = `nachos.llm.stream.${childSessionId}`;

// Message format
{
  sessionId: string;
  delta: {
    type: 'text_delta';
    text: string;
  }
}
```

### Workflow Orchestration Flow (New v2.0)

```
1. User (or LLM) calls sessions_orchestrate
     ↓
2. Gateway.executeLocalToolCall()
     ↓
3. SubagentOrchestrator.enqueueWorkflow(request)
     ├→ Validate DAG (no cycles, no missing deps)
     ├→ Compute execution plan (topological sort → batches)
     ├→ Create WorkflowRunRecord
     ├→ Generate workflowId
     └→ Start workflow execution
     ↓
4. SubagentOrchestrator.executeWorkflow(workflowId, plan)
     ↓
5. For each batch in plan.batches (sequentially):
     ├→ Update workflow.currentBatch
     ├→ For each step in batch (parallel):
     │    ├→ Build task prompt (append results from dependencies)
     │    ├→ Spawn subagent (enqueue with model/stream from step)
     │    ├→ Mark run.workflowId and run.stepId
     │    ├→ Wait for run completion
     │    └→ Store result in workflow.stepResults
     ├→ Check for failures
     └→ If failure and !continueOnFailure, stop workflow
     ↓
6. Workflow completes (or fails)
     ├→ Update workflow.status
     ├→ Calculate workflow.durationMs
     └→ Announce workflow result to requester
```

**Execution Plan (Topological Sort):**

```typescript
// Input workflow
{
  steps: [
    { id: 'fetch', task: '...' },
    { id: 'validate', task: '...', dependsOn: ['fetch'] },
    { id: 'enrich', task: '...', dependsOn: ['fetch'] },
    { id: 'merge', task: '...', dependsOn: ['validate', 'enrich'] }
  ]
}

// Computed execution plan
{
  batches: [
    ['fetch'],               // Batch 1: No dependencies
    ['validate', 'enrich'],  // Batch 2: Parallel (both depend only on fetch)
    ['merge']                // Batch 3: Waits for validate AND enrich
  ],
  steps: Map { ... }
}
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

**Schema (Updated v2.0):**

```typescript
{
  task: string;              // Required
  label?: string;
  profile?: string;
  agentId?: string;
  model?: string;            // NEW: Model ID or alias (haiku/sonnet/opus)
  modelHint?: 'fast' | 'balanced' | 'thorough';  // NEW: Auto-select hint
  thinking?: 'low' | 'medium' | 'high';
  cleanup?: 'delete' | 'keep';
  runTimeoutSeconds?: number;
  stream?: boolean;          // NEW: Enable streaming results
}
```

**Response:**

```json
{
  "status": "accepted",
  "runId": "run-abc123",
  "childSessionId": "session-child-xyz",
  "model": "anthropic.claude-sonnet-4-6", // NEW: Selected model
  "stream": true // NEW: Streaming enabled
}
```

**Examples:**

```typescript
// Explicit model
await sessions_spawn({
  task: 'Quick syntax check',
  model: 'haiku',
});

// Model hint
await sessions_spawn({
  task: 'Deep security audit',
  modelHint: 'thorough',
});

// Auto-selection (analyzes task complexity)
await sessions_spawn({
  task: 'Analyze this 10,000-line codebase for vulnerabilities',
});
// → Auto-selects Opus

// Streaming enabled
await sessions_spawn({
  task: 'Generate comprehensive 50-page report',
  stream: true,
});
```

---

### sessions_orchestrate (New v2.0)

**Schema:**

```typescript
{
  steps: WorkflowStep[];     // Required: Array of workflow steps
  label?: string;            // Optional: Workflow label
  continueOnFailure?: boolean;  // Optional: Continue if step fails (default: false)
}

interface WorkflowStep {
  id: string;                // Required: Unique step ID
  task: string;              // Required: Task description
  dependsOn?: string[];      // Optional: Array of step IDs this depends on
  model?: string;            // Optional: Model for this step
  modelHint?: 'fast' | 'balanced' | 'thorough';  // Optional: Model hint
  stream?: boolean;          // Optional: Enable streaming for this step
}
```

**Response:**

```json
{
  "status": "accepted",
  "workflowId": "workflow-xyz789",
  "stepCount": 5,
  "batches": [["step1"], ["step2", "step3"], ["step4"], ["step5"]]
}
```

**Example:**

```typescript
await sessions_orchestrate({
  steps: [
    {
      id: 'fetch',
      task: 'Fetch data from API',
      model: 'haiku', // Fast model for simple task
    },
    {
      id: 'validate',
      task: 'Validate data schema',
      dependsOn: ['fetch'],
      model: 'haiku',
    },
    {
      id: 'analyze',
      task: 'Deep analysis of trends',
      dependsOn: ['validate'],
      modelHint: 'thorough', // Complex analysis → Opus
    },
    {
      id: 'report',
      task: 'Generate comprehensive report',
      dependsOn: ['analyze'],
      model: 'sonnet',
      stream: true, // Stream the report as it's written
    },
  ],
  label: 'data-analysis-workflow',
  continueOnFailure: false,
});
```

---

### subagent_progress (New v2.0)

**Schema:**

```typescript
{
  status: string;            // Required: Human-readable status
  percentage?: number;       // Optional: Progress percentage (0-100)
  metadata?: Record<string, unknown>;  // Optional: Structured data
}
```

**Usage (from within subagent):**

```typescript
// Report progress
await subagent_progress({
  status: 'Analyzing file 23 of 50',
  percentage: 46,
  metadata: {
    filesProcessed: 23,
    totalFiles: 50,
    issuesFound: 3,
  },
});
```

**Response:**

```json
{
  "success": true,
  "message": "Progress updated"
}
```

**Notes:**

- Only available to running subagents (checked via session.metadata.subagent)
- Throttled to min 1 second between updates
- Progress stored in run.progress[] array
- Accessible via `subagents` tool (info action)

---

### subagents (Updated v2.0)

**Actions:**

- `list` - List all runs for current session
- `info` - Get detailed info for a specific run (**updated: includes progress
  and streamChunks**)
- `log` - Retrieve conversation log (last N messages)
- `stop` - Stop a queued run
- `steer` - Send message to running subagent
- `files_list` - List files in subagent workspace
- `files_get` - Read file from subagent workspace
- `workflow_list` - List all workflows (**new v2.0**)
- `workflow_info` - Get workflow status and step results (**new v2.0**)

**Updated `info` response (v2.0):**

```json
{
  "runId": "run-abc123",
  "status": "running",
  "task": "Analyze codebase",
  "model": "anthropic.claude-opus-4-6-v1", // NEW
  "stream": true, // NEW
  "progress": [
    // NEW
    {
      "timestamp": "2026-02-24T14:30:00Z",
      "status": "Starting analysis",
      "percentage": 0
    },
    {
      "timestamp": "2026-02-24T14:32:00Z",
      "status": "Analyzing file 23 of 50",
      "percentage": 46,
      "metadata": { "filesProcessed": 23, "totalFiles": 50 }
    }
  ],
  "streamChunks": [
    // NEW
    "# Analysis Report\n\n",
    "## Overview\n",
    "Found 3 critical issues...\n"
  ]
}
```

**New `workflow_list` action:**

```typescript
await subagents({ action: 'workflow_list' });
```

**Response:**

```json
{
  "workflows": [
    {
      "workflowId": "workflow-xyz789",
      "status": "running",
      "label": "data-analysis-workflow",
      "stepCount": 4,
      "currentBatch": 2,
      "totalBatches": 3,
      "startedAt": "2026-02-24T14:00:00Z"
    }
  ]
}
```

**New `workflow_info` action:**

```typescript
await subagents({
  action: 'workflow_info',
  workflowId: 'workflow-xyz789',
});
```

**Response:**

```json
{
  "workflowId": "workflow-xyz789",
  "status": "running",
  "label": "data-analysis-workflow",
  "currentBatch": 2,
  "totalBatches": 3,
  "stepResults": {
    "fetch": {
      "stepId": "fetch",
      "runId": "run-001",
      "status": "completed",
      "result": "Fetched 150 records from API",
      "durationMs": 2500
    },
    "validate": {
      "stepId": "validate",
      "runId": "run-002",
      "status": "completed",
      "result": "All records valid",
      "durationMs": 1200
    },
    "analyze": {
      "stepId": "analyze",
      "runId": "run-003",
      "status": "running"
    },
    "report": {
      "stepId": "report",
      "status": "queued"
    }
  },
  "createdAt": "2026-02-24T14:00:00Z",
  "startedAt": "2026-02-24T14:00:05Z"
}
```

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
SUBAGENT_TOPICS.spawned(runId);
SUBAGENT_TOPICS.progress(runId);
SUBAGENT_TOPICS.complete(runId);
SUBAGENT_TOPICS.error(runId);
SUBAGENT_TOPICS.killed(runId);
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
if (
  session.id !== run.requester.sessionId &&
  session.userId !== run.requester.userId
) {
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

## Implemented Features (v2.0)

### ✅ 1. Progress Updates (Implemented)

Subagents can report progress via `subagent_progress` tool:

```typescript
await subagent_progress({
  status: 'Processing file 23 of 50',
  percentage: 46,
  metadata: { filesProcessed: 23, totalFiles: 50 },
});
```

Stored in `run.progress[]` and accessible via `subagents info` action.

### ✅ 2. Model Selection (Implemented)

Three approaches:

- **Explicit:** `model: "opus"`
- **Hints:** `modelHint: "thorough"`
- **Auto-select:** Analyzes task complexity → selects appropriate model

Configurable aliases and auto-selection heuristics.

### ✅ 3. Streaming Results (Implemented)

Enable with `stream: true` parameter:

```typescript
await sessions_spawn({
  task: 'Generate 50-page report',
  stream: true,
});
```

Chunks streamed via NATS topic `nachos.llm.stream.{sessionId}`, accumulated in
`run.streamChunks[]`.

Optional real-time delivery to requester.

### ✅ 4. Dependency Graphs (Implemented)

Multi-step workflows with explicit dependencies:

```typescript
await sessions_orchestrate({
  steps: [
    { id: 'fetch', task: '...' },
    { id: 'analyze', task: '...', dependsOn: ['fetch'] },
    { id: 'report', task: '...', dependsOn: ['analyze'] },
  ],
});
```

DAG validation (cycle detection), topological sort, parallel execution of
independent steps, result passing between steps.

---

## Future Enhancements

### 1. Subagent-to-Subagent Communication

Allow subagents to spawn child subagents:

```typescript
// Subagent A spawns Subagent B
const run = await spawnSubagent({
  task: 'Analyze results from previous step',
  parent: runIdA,
});
```

**Use case:** Recursive problem decomposition

### 2. Cost Tracking

Track LLM usage per subagent and workflow:

```typescript
{
  runId: 'run-abc123',
  cost: {
    inputTokens: 1500,
    outputTokens: 800,
    totalCost: 0.025,  // USD
    model: 'opus',
    costMultiplier: 5.0
  },

  // Workflow-level aggregation
  workflowCost: {
    totalCost: 0.125,  // Sum of all steps
    stepCosts: {
      'fetch': 0.005,  // Haiku
      'analyze': 0.100, // Opus
      'report': 0.020   // Sonnet
    }
  }
}
```

**Rationale:** Budget tracking, cost optimization insights

### 3. Nested Workflows

Workflows as steps in parent workflows:

```typescript
{
  steps: [
    { id: 'data-pipeline', workflow: dataPipelineWorkflow }, // Nested workflow
    { id: 'analysis', task: '...', dependsOn: ['data-pipeline'] },
  ];
}
```

**Max depth:** Configurable (default: 5 levels)

### 4. Admin UI Integration

Visual monitoring dashboard:

- Active subagents/workflows graph
- Queue length and concurrency usage
- Average execution time by model
- Success/failure rates
- Cost breakdown (when cost tracking implemented)
- Model selection distribution (Haiku vs Sonnet vs Opus usage)

### 5. Workflow Templates

Pre-defined workflow patterns:

```typescript
// Template library
const WORKFLOW_TEMPLATES = {
  'bug-fix': {
    steps: [
      { id: 'investigate', agent: 'issue-investigator' },
      { id: 'fix', agent: 'dev-coder', dependsOn: ['investigate'] },
      { id: 'test', agent: 'validation-agent', dependsOn: ['fix'] },
      { id: 'review', agent: 'code-reviewer', dependsOn: ['test'] },
    ],
  },
  'research-synthesis': {
    steps: [
      { id: 'web', task: 'Search web' },
      { id: 'docs', task: 'Search docs' },
      { id: 'code', task: 'Search codebase' },
      {
        id: 'synthesis',
        task: 'Combine findings',
        dependsOn: ['web', 'docs', 'code'],
      },
    ],
  },
};

// Usage
await sessions_orchestrate({
  template: 'bug-fix',
  context: { issue: '#123' },
});
```

### 6. Conditional Steps

Steps with conditional execution:

```typescript
{
  steps: [
    { id: 'test', task: 'Run tests' },
    {
      id: 'fix',
      task: 'Fix failing tests',
      dependsOn: ['test'],
      condition: "steps.test.result.includes('FAILED')", // Only run if tests failed
    },
  ];
}
```

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
- [ADR-004](decisions/004-subagent-orchestration-enhancements.md) - Design
  decisions for v2.0 features
- [Configuration Reference](../config/gateway.md) - Full config options
- [Tool Reference](../tools/README.md) - API docs

**Related ADRs:**

- ADR-002 - Shell Tool Security Model
- ADR-003 - Skill Structure
- **ADR-004 - Subagent Orchestration Enhancements** (model selection, progress,
  streaming, workflows)

**Key source files:**

- `packages/core/gateway/src/subagents/subagent-orchestrator.ts` - Main
  orchestrator
- `packages/core/gateway/src/subagents/model-selection.ts` - Model routing logic
- `packages/core/gateway/src/subagents/dependency-graph.ts` - Workflow DAG
  validation
- `packages/core/gateway/src/subagents/types.ts` - Type definitions

---

**Contributing:** Found a bug or want to improve subagents? Open an issue on
[GitHub](https://github.com/Nacho-Labs-LLC/nachos).
