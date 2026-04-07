# Tool Reference

**Version:** 2.0  
**Last Updated:** 2026-02-24

---

This directory contains API documentation for Nachos tools.

## Subagent Tools (v2.0)

- [sessions_spawn](#sessions_spawn) - Spawn individual subagent tasks
- [sessions_orchestrate](#sessions_orchestrate) - Define multi-step workflows
  (**new in v2.0**)
- [subagents](#subagents) - Monitor and manage subagents/workflows
- [subagent_progress](#subagent_progress) - Report progress from within
  subagents (**new in v2.0**)

---

## sessions_spawn

Spawn an isolated subagent to handle a task independently.

### Schema

```typescript
{
  task: string;              // Required: Task description
  label?: string;            // Optional: Human-readable label
  profile?: string;          // Optional: Skill profile to use
  agentId?: string;          // Optional: Specialist agent ID
  model?: string;            // Optional: Model ID or alias (haiku/sonnet/opus) [v2.0]
  modelHint?: 'fast' | 'balanced' | 'thorough';  // Optional: Model hint [v2.0]
  thinking?: 'low' | 'medium' | 'high';  // Optional: Thinking level
  runTimeoutSeconds?: number;  // Optional: Max execution time (default: 300)
  cleanup?: 'delete' | 'keep';  // Optional: Workspace cleanup (default: 'keep')
  stream?: boolean;          // Optional: Enable streaming results [v2.0]
}
```

### Parameters

#### `task` (required)

**Type:** `string`

Task description for the subagent. Be specific and clear.

**Examples:**

```typescript
// ❌ Vague
task: 'Research stuff';

// ✅ Specific
task: 'Research renewable energy trends in 2025, focusing on solar and wind. Summarize key findings in 3 paragraphs with sources.';
```

#### `label` (optional)

**Type:** `string`

Human-readable label for easy identification.

**Examples:**

```typescript
label: 'security-audit-2026-02-24';
label: 'renewable-energy-research';
```

#### `model` (optional, v2.0)

**Type:** `string`

Model ID or alias to use for this subagent.

**Aliases:**

- `haiku` - Fast and economical (Claude Haiku 4.5)
- `sonnet` - Balanced (Claude Sonnet 4.6, default)
- `opus` - Most capable (Claude Opus 4.6)
- `fast` - Alias for `haiku`
- `balanced` - Alias for `sonnet`
- `thorough` - Alias for `opus`

**Full model IDs:**

- `anthropic.claude-haiku-4-5-20251001-v1:0`
- `anthropic.claude-sonnet-4-6`
- `anthropic.claude-opus-4-6-v1`

**Examples:**

```typescript
model: 'haiku'; // Fast, cheap
model: 'opus'; // Thorough, expensive
model: 'anthropic.claude-sonnet-4-6'; // Full ID
```

#### `modelHint` (optional, v2.0)

**Type:** `'fast' | 'balanced' | 'thorough'`

Convenience parameter for model selection. Use this instead of `model` when you
want to suggest capability level without specifying exact model.

**When to use:**

- `fast` - Simple, quick tasks (syntax checks, basic queries)
- `balanced` - Medium complexity (code reviews, summaries)
- `thorough` - Complex analysis (security audits, architectural reviews)

**Examples:**

```typescript
modelHint: 'fast'; // → Haiku
modelHint: 'thorough'; // → Opus
```

**Note:** If both `model` and `modelHint` are provided, `model` takes
precedence.

#### `stream` (optional, v2.0)

**Type:** `boolean`  
**Default:** `false`

Enable streaming results. When enabled:

- LLM response is streamed chunk-by-chunk
- Chunks accumulated in `run.streamChunks[]`
- Optionally delivered to requester in real-time (if configured)

**When to use:**

- Long-running reports or documentation
- User wants to see partial results early
- Output is >1000 words

**Examples:**

```typescript
stream: true; // Enable streaming
stream: false; // Wait for full completion (default)
```

#### `thinking` (optional)

**Type:** `'low' | 'medium' | 'high'`

Controls the thinking/reasoning level for the subagent.

#### `runTimeoutSeconds` (optional)

**Type:** `number`  
**Default:** `300` (5 minutes)

Maximum execution time in seconds. Subagent will be terminated if it exceeds
this.

**Examples:**

```typescript
runTimeoutSeconds: 120; // 2 minutes (quick tasks)
runTimeoutSeconds: 600; // 10 minutes (complex tasks)
runTimeoutSeconds: 1800; // 30 minutes (very long tasks)
```

#### `cleanup` (optional)

**Type:** `'delete' | 'keep'`  
**Default:** `'keep'`

Workspace cleanup behavior after subagent completes.

- `keep` - Preserve workspace files (can access later)
- `delete` - Remove workspace immediately after completion

**Examples:**

```typescript
cleanup: 'keep'; // Keep workspace (default)
cleanup: 'delete'; // Clean up immediately
```

### Response

```typescript
{
  status: 'accepted';
  runId: string;            // Unique run identifier
  childSessionId: string;   // Child session ID
  model?: string;           // Selected model (v2.0)
  stream?: boolean;         // Streaming enabled (v2.0)
}
```

**Example:**

```json
{
  "status": "accepted",
  "runId": "run-abc123",
  "childSessionId": "session-child-xyz789",
  "model": "anthropic.claude-opus-4-6-v1",
  "stream": true
}
```

### Examples

#### Basic Usage

```typescript
await sessions_spawn({
  task: 'Analyze main.py for security vulnerabilities',
});
```

#### With Model Selection

```typescript
// Quick syntax check (fast model)
await sessions_spawn({
  task: 'Check Python syntax in all .py files',
  model: 'haiku',
});

// Deep architectural review (thorough model)
await sessions_spawn({
  task: 'Review system architecture and identify scaling bottlenecks',
  modelHint: 'thorough',
});
```

#### With Streaming

```typescript
await sessions_spawn({
  task: 'Generate a comprehensive 50-page security audit report',
  model: 'opus',
  stream: true,
  runTimeoutSeconds: 1800, // 30 minutes
});
```

#### With All Options

```typescript
await sessions_spawn({
  task: 'Research quantum computing trends in 2025 and write a detailed report',
  label: 'quantum-computing-research',
  model: 'sonnet',
  thinking: 'high',
  runTimeoutSeconds: 600,
  cleanup: 'keep',
  stream: true,
});
```

### Auto-Selection Behavior

If neither `model` nor `modelHint` is specified, the system automatically
selects a model based on task complexity (when `auto_select` is enabled in
config):

**→ Opus (thorough):**

- Contains keywords: analyze, review, audit, investigate, comprehensive
- Code analysis: codebase, vulnerabilities, refactor, bugs
- Multi-step tasks: numbered lists, "then", "after"
- Long tasks: >40 words

**→ Haiku (fast):**

- Short tasks: <8 words
- No complexity keywords

**→ Sonnet (balanced):**

- Medium complexity
- Default fallback

**Examples:**

```typescript
// Auto-selects Opus (has "analyze" + "codebase")
await sessions_spawn({
  task: 'Analyze this codebase for security vulnerabilities',
});

// Auto-selects Haiku (short + simple)
await sessions_spawn({
  task: 'Fix typo in README',
});

// Auto-selects Sonnet (medium)
await sessions_spawn({
  task: 'Summarize this research paper in 3 paragraphs',
});
```

### Error Handling

**Invalid model:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_MODEL",
    "message": "Unknown model: gpt-4"
  }
}
```

**Timeout:**

```json
{
  "runId": "run-abc123",
  "status": "failed",
  "error": {
    "code": "TIMEOUT",
    "message": "Subagent exceeded timeout of 300 seconds"
  }
}
```

### See Also

- [Subagents User Guide](../guides/subagents.md)
- [Model Selection Architecture](../architecture/subagents.md#5-model-selection)

---

## sessions_orchestrate

**New in v2.0**

Define and execute multi-step workflows with explicit dependencies.

### Schema

```typescript
{
  steps: WorkflowStep[];     // Required: Array of workflow steps
  label?: string;            // Optional: Workflow label
  continueOnFailure?: boolean;  // Optional: Continue if step fails (default: false)
}

interface WorkflowStep {
  id: string;                // Required: Unique step ID
  task: string;              // Required: Task description
  dependsOn?: string[];      // Optional: Array of prerequisite step IDs
  model?: string;            // Optional: Model for this step
  modelHint?: 'fast' | 'balanced' | 'thorough';  // Optional: Model hint
  stream?: boolean;          // Optional: Enable streaming for this step
}
```

### Parameters

#### `steps` (required)

**Type:** `WorkflowStep[]`

Array of workflow steps. Each step is a subagent task with optional
dependencies.

**Step fields:**

**`id`** (required) - Unique identifier for this step

- Must be unique within the workflow
- Used for dependencies and result retrieval
- Example: `'fetch'`, `'analyze'`, `'report'`

**`task`** (required) - Task description for this step

- Same format as `sessions_spawn.task`
- Results from dependent steps are automatically appended

**`dependsOn`** (optional) - Array of step IDs this depends on

- Step waits for all dependencies to complete
- Dependency results are injected into task prompt
- Example: `['fetch', 'validate']`

**`model`** (optional) - Model for this step

- Same as `sessions_spawn.model`
- Different steps can use different models

**`modelHint`** (optional) - Model hint for this step

- Same as `sessions_spawn.modelHint`

**`stream`** (optional) - Enable streaming for this step

- Same as `sessions_spawn.stream`

#### `label` (optional)

**Type:** `string`

Human-readable label for the workflow.

**Examples:**

```typescript
label: 'data-analysis-workflow';
label: 'bug-fix-workflow-issue-123';
```

#### `continueOnFailure` (optional)

**Type:** `boolean`  
**Default:** `false`

Whether to continue workflow execution if a step fails.

- `false` (default) - Stop workflow on first failure
- `true` - Continue executing independent steps even if some fail

### Response

```typescript
{
  status: 'accepted';
  workflowId: string;       // Unique workflow identifier
  stepCount: number;        // Total number of steps
  batches: string[][];      // Execution plan (batches of step IDs)
}
```

**Example:**

```json
{
  "status": "accepted",
  "workflowId": "workflow-xyz789",
  "stepCount": 5,
  "batches": [
    ["fetch"],
    ["validate", "enrich"],
    ["merge"],
    ["analyze"],
    ["report"]
  ]
}
```

The `batches` field shows the execution plan:

- Batch 1: `fetch` (no dependencies)
- Batch 2: `validate` and `enrich` in parallel (both depend only on `fetch`)
- Batch 3: `merge` (depends on both `validate` and `enrich`)
- etc.

### Validation

The orchestrator validates your workflow before execution:

**✅ Valid workflows:**

```typescript
// Linear
{
  steps: [
    { id: 'a', task: '...' },
    { id: 'b', task: '...', dependsOn: ['a'] },
  ];
}

// Parallel
{
  steps: [
    { id: 'a', task: '...' },
    { id: 'b', task: '...' },
    { id: 'c', task: '...', dependsOn: ['a', 'b'] },
  ];
}

// Diamond
{
  steps: [
    { id: 'fetch', task: '...' },
    { id: 'left', task: '...', dependsOn: ['fetch'] },
    { id: 'right', task: '...', dependsOn: ['fetch'] },
    { id: 'merge', task: '...', dependsOn: ['left', 'right'] },
  ];
}
```

**❌ Invalid workflows:**

**Duplicate step IDs:**

```typescript
{
  steps: [
    { id: 'step1', task: '...' },
    { id: 'step1', task: '...' }, // ❌ Error: DUPLICATE_STEP_ID
  ];
}
```

**Missing dependencies:**

```typescript
{
  steps: [
    { id: 'step1', task: '...' },
    { id: 'step2', task: '...', dependsOn: ['step3'] }, // ❌ Error: MISSING_DEPENDENCY
  ];
}
```

**Cycles:**

```typescript
{
  steps: [
    { id: 'a', task: '...', dependsOn: ['b'] },
    { id: 'b', task: '...', dependsOn: ['a'] }, // ❌ Error: CYCLE_DETECTED
  ];
}
```

**Too many steps:**

```typescript
{
  steps: [
    /* 51 steps */
  ];
} // ❌ Error: Exceeds max_steps limit (50)
```

### Result Passing

Results from dependent steps are automatically injected into the task prompt:

**Workflow:**

```typescript
{
  steps: [
    {
      id: 'research',
      task: 'Research renewable energy trends in 2025',
    },
    {
      id: 'analyze',
      task: 'Analyze the research findings and identify key trends',
      dependsOn: ['research'],
    },
  ];
}
```

**Actual prompt received by 'analyze' step:**

```
Task: Analyze the research findings and identify key trends

**Results from 'research':**
Solar capacity grew 45%, wind 30%, battery storage 60%...
```

### Examples

#### Linear Workflow (Sequential)

```typescript
await sessions_orchestrate({
  steps: [
    {
      id: 'fetch',
      task: 'Fetch user data from API',
      model: 'haiku',
    },
    {
      id: 'validate',
      task: 'Validate data schema',
      dependsOn: ['fetch'],
      model: 'haiku',
    },
    {
      id: 'process',
      task: 'Process and transform data',
      dependsOn: ['validate'],
      model: 'sonnet',
    },
    {
      id: 'report',
      task: 'Generate summary report',
      dependsOn: ['process'],
      model: 'sonnet',
      stream: true,
    },
  ],
  label: 'data-pipeline',
});
```

**Execution:**

```
Batch 1: fetch
Batch 2: validate
Batch 3: process
Batch 4: report
```

#### Parallel Workflow

```typescript
await sessions_orchestrate({
  steps: [
    {
      id: 'web',
      task: 'Search web for information about quantum computing',
      model: 'sonnet',
    },
    {
      id: 'docs',
      task: 'Search internal documentation for quantum computing references',
      model: 'haiku',
    },
    {
      id: 'code',
      task: 'Search codebase for quantum computing implementations',
      model: 'haiku',
    },
    {
      id: 'synthesis',
      task: 'Combine all findings into a comprehensive report',
      dependsOn: ['web', 'docs', 'code'],
      modelHint: 'thorough',
      stream: true,
    },
  ],
  label: 'quantum-research',
});
```

**Execution:**

```
Batch 1 (parallel): web, docs, code
Batch 2: synthesis (waits for all 3)
```

#### Diamond Workflow

```typescript
await sessions_orchestrate({
  steps: [
    {
      id: 'fetch',
      task: 'Fetch customer data',
      model: 'haiku',
    },
    {
      id: 'validate',
      task: 'Validate data integrity',
      dependsOn: ['fetch'],
      model: 'haiku',
    },
    {
      id: 'enrich',
      task: 'Enrich with external data sources',
      dependsOn: ['fetch'],
      model: 'sonnet',
    },
    {
      id: 'merge',
      task: 'Merge validated and enriched datasets',
      dependsOn: ['validate', 'enrich'],
      model: 'sonnet',
    },
  ],
  label: 'customer-enrichment',
});
```

**Execution:**

```
Batch 1: fetch
Batch 2 (parallel): validate, enrich
Batch 3: merge (waits for both)
```

#### Bug Fix Workflow (Real-World)

```typescript
await sessions_orchestrate({
  steps: [
    {
      id: 'investigate',
      task: 'Find root cause of login bug in authentication service',
      modelHint: 'thorough', // Deep investigation
    },
    {
      id: 'fix',
      task: 'Implement the fix based on investigation findings',
      dependsOn: ['investigate'],
      model: 'sonnet',
    },
    {
      id: 'tests',
      task: 'Write comprehensive tests for the fix',
      dependsOn: ['fix'],
      model: 'haiku', // Test generation is straightforward
    },
    {
      id: 'review',
      task: 'Code review the changes and tests',
      dependsOn: ['fix', 'tests'],
      modelHint: 'thorough',
    },
    {
      id: 'document',
      task: 'Update documentation with fix details',
      dependsOn: ['review'],
      model: 'sonnet',
      stream: true,
    },
  ],
  label: 'fix-login-bug',
  continueOnFailure: false,
});
```

### Error Handling

**Validation errors:**

```json
{
  "success": false,
  "error": {
    "code": "CYCLE_DETECTED",
    "message": "Workflow contains a circular dependency"
  }
}
```

**Execution errors (step failure):**

```json
{
  "workflowId": "workflow-xyz789",
  "status": "failed",
  "error": {
    "code": "STEP_FAILED",
    "message": "Step 'validate' failed: Invalid data format"
  },
  "stepResults": {
    "fetch": { "status": "completed", "result": "..." },
    "validate": { "status": "failed", "error": { ... } }
  }
}
```

**Continue on failure:**

```typescript
await sessions_orchestrate({
  steps: [
    /* ... */
  ],
  continueOnFailure: true, // Keep going even if steps fail
});
```

### See Also

- [Workflow Orchestration Guide](../guides/subagents.md#workflow-orchestration)
- [Dependency Graph Architecture](../architecture/subagents.md#8-workflow-orchestration)
- [ADR-004](../architecture/decisions/004-subagent-orchestration-enhancements.md)

---

## subagents

Monitor and manage subagents and workflows.

### Actions

- `list` - List all runs for current session
- `info` - Get detailed info for a specific run
- `log` - Retrieve conversation log
- `stop` - Stop a queued run
- `steer` - Send message to running subagent
- `files_list` - List workspace files
- `files_get` - Read workspace file
- `workflow_list` - List all workflows (**new in v2.0**)
- `workflow_info` - Get workflow status (**new in v2.0**)

### list

List all subagent runs for the current session.

**Schema:**

```typescript
{
  action: 'list';
}
```

**Response:**

```json
{
  "runs": [
    {
      "runId": "run-abc123",
      "status": "running",
      "task": "Analyze codebase",
      "label": "security-audit",
      "model": "anthropic.claude-opus-4-6-v1",
      "stream": true,
      "createdAt": "2026-02-24T14:00:00Z",
      "startedAt": "2026-02-24T14:00:05Z",
      "progress": [
        {
          "timestamp": "2026-02-24T14:02:00Z",
          "status": "Analyzing file 23 of 50",
          "percentage": 46
        }
      ]
    }
  ]
}
```

### info

Get detailed information about a specific run.

**Schema:**

```typescript
{
  action: 'info',
  runId: string  // Required
}
```

**Response (v2.0):**

```json
{
  "runId": "run-abc123",
  "status": "running",
  "task": "Analyze codebase for security vulnerabilities",
  "label": "security-audit",
  "model": "anthropic.claude-opus-4-6-v1",
  "stream": true,
  "createdAt": "2026-02-24T14:00:00Z",
  "startedAt": "2026-02-24T14:00:05Z",
  "progress": [
    {
      "timestamp": "2026-02-24T14:00:30Z",
      "status": "Starting analysis",
      "percentage": 0
    },
    {
      "timestamp": "2026-02-24T14:02:00Z",
      "status": "Analyzing file 23 of 50",
      "percentage": 46,
      "metadata": {
        "filesProcessed": 23,
        "totalFiles": 50,
        "issuesFound": 3
      }
    }
  ],
  "streamChunks": [
    "# Security Analysis Report\n\n",
    "## Executive Summary\n\n",
    "Found 3 critical vulnerabilities:\n",
    "1. SQL injection in auth.py\n",
    "..."
  ],
  "workflowId": "workflow-xyz789",
  "stepId": "analyze"
}
```

**New fields in v2.0:**

- `model` - Selected model
- `stream` - Streaming enabled
- `progress` - Array of progress updates
- `streamChunks` - Accumulated stream chunks
- `workflowId` - Parent workflow (if part of workflow)
- `stepId` - Step ID (if part of workflow)

### log

Retrieve conversation log for a subagent.

**Schema:**

```typescript
{
  action: 'log',
  runId: string,    // Required
  limit?: number    // Optional: Max messages (default: 50)
}
```

### stop

Stop a queued subagent (cannot stop running subagents).

**Schema:**

```typescript
{
  action: 'stop',
  runId: string  // Required
}
```

### steer

Send a message to a running subagent.

**Schema:**

```typescript
{
  action: 'steer',
  runId: string,    // Required
  message: string   // Required: Steering message
}
```

**Example:**

```typescript
await subagents({
  action: 'steer',
  runId: 'run-abc123',
  message: 'Focus on OWASP Top 10 vulnerabilities only',
});
```

### files_list

List files in subagent workspace.

**Schema:**

```typescript
{
  action: 'files_list',
  runId: string  // Required
}
```

### files_get

Read a file from subagent workspace.

**Schema:**

```typescript
{
  action: 'files_get',
  runId: string,       // Required
  relativePath: string  // Required: Path relative to workspace
}
```

### workflow_list

**New in v2.0**

List all workflows for the current session.

**Schema:**

```typescript
{
  action: 'workflow_list';
}
```

**Response:**

```json
{
  "workflows": [
    {
      "workflowId": "workflow-xyz789",
      "status": "running",
      "label": "data-analysis-workflow",
      "stepCount": 5,
      "currentBatch": 2,
      "totalBatches": 4,
      "createdAt": "2026-02-24T14:00:00Z",
      "startedAt": "2026-02-24T14:00:05Z"
    }
  ]
}
```

### workflow_info

**New in v2.0**

Get detailed workflow status and step results.

**Schema:**

```typescript
{
  action: 'workflow_info',
  workflowId: string  // Required
}
```

**Response:**

```json
{
  "workflowId": "workflow-xyz789",
  "status": "running",
  "label": "data-analysis-workflow",
  "currentBatch": 2,
  "totalBatches": 4,
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

**Step statuses:**

- `queued` - Waiting for dependencies
- `running` - Currently executing
- `completed` - Successfully completed
- `failed` - Failed with error

### See Also

- [Monitoring Subagents Guide](../guides/subagents.md#monitoring-subagents)

---

## subagent_progress

**New in v2.0**

Report progress from within a running subagent.

**Important:** This tool is only available to subagents. Main sessions cannot
call this tool.

### Schema

```typescript
{
  status: string;            // Required: Human-readable status message
  percentage?: number;       // Optional: Progress percentage (0-100)
  metadata?: Record<string, unknown>;  // Optional: Structured data
}
```

### Parameters

#### `status` (required)

**Type:** `string`

Human-readable status message describing current progress.

**Examples:**

```typescript
status: 'Analyzing file 23 of 50';
status: 'Fetching data from API';
status: 'Running security scan (step 2/5)';
```

#### `percentage` (optional)

**Type:** `number` (0-100)

Progress percentage. Must be between 0 and 100.

**Examples:**

```typescript
percentage: 0; // Just started
percentage: 46; // 46% complete
percentage: 100; // Finished
```

#### `metadata` (optional)

**Type:** `Record<string, unknown>`

Structured data for programmatic tracking.

**Examples:**

```typescript
metadata: {
  filesProcessed: 23,
  totalFiles: 50,
  issuesFound: 3
}

metadata: {
  phase: "analysis",
  currentFile: "auth.py",
  linesScanned: 1523
}
```

### Response

```json
{
  "success": true,
  "message": "Progress updated"
}
```

### Throttling

Progress updates are automatically throttled to a minimum of **1 second**
between updates. If you call `subagent_progress` more frequently, extra calls
are silently ignored.

### Examples

#### Basic Progress

```typescript
// Subagent code
for (let i = 0; i < files.length; i++) {
  await analyzeFile(files[i]);

  await subagent_progress({
    status: `Analyzed ${i + 1} of ${files.length} files`,
    percentage: Math.floor(((i + 1) / files.length) * 100),
  });
}
```

#### With Metadata

```typescript
await subagent_progress({
  status: 'Security scan in progress',
  percentage: 46,
  metadata: {
    filesProcessed: 23,
    totalFiles: 50,
    criticalIssues: 2,
    warningsFound: 7,
    currentPhase: 'static-analysis',
  },
});
```

#### Phase Transitions

```typescript
await subagent_progress({
  status: 'Phase 1: Data collection complete',
  percentage: 25,
  metadata: { phase: 'collection', recordsCollected: 150 },
});

// ... work ...

await subagent_progress({
  status: 'Phase 2: Validation in progress',
  percentage: 50,
  metadata: { phase: 'validation', recordsValidated: 75 },
});

// ... work ...

await subagent_progress({
  status: 'Phase 3: Analysis complete',
  percentage: 100,
  metadata: { phase: 'analysis', findings: 12 },
});
```

### Best Practices

**✅ Do:**

- Report progress every 5-10% completion
- Use concrete numbers when possible
- Include phase transitions
- Add meaningful metadata for tracking
- Report at meaningful milestones (not arbitrary)

**❌ Don't:**

- Report more than once per second (throttled anyway)
- Report only at 0% and 100% (defeats purpose)
- Use vague messages like "Working..." (be specific)
- Spam progress updates on every loop iteration

**Example reporting strategy:**

```typescript
// ✅ Good: Report every 10 files
for (let i = 0; i < files.length; i++) {
  await processFile(files[i]);

  if (i % 10 === 0 || i === files.length - 1) {
    await subagent_progress({
      status: `Processed ${i} of ${files.length} files`,
      percentage: Math.floor((i / files.length) * 100)
    });
  }
}

// ❌ Bad: Report every file (too frequent, wasteful)
for (let i = 0; i < files.length; i++) {
  await processFile(files[i]);
  await subagent_progress({ status: `File ${i}`, percentage: ... });
}
```

### Error Handling

**Not a subagent:**

```json
{
  "success": false,
  "error": {
    "code": "NOT_ALLOWED",
    "message": "Only subagents can report progress"
  }
}
```

**Invalid percentage:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "Percentage must be between 0 and 100"
  }
}
```

**Run not running:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "Can only report progress for running subagents"
  }
}
```

### Viewing Progress

Users can view progress via the `subagents` tool:

```typescript
await subagents({
  action: 'info',
  runId: 'run-abc123',
});
```

**Response includes progress:**

```json
{
  "runId": "run-abc123",
  "status": "running",
  "progress": [
    {
      "timestamp": "2026-02-24T14:00:30Z",
      "status": "Starting analysis",
      "percentage": 0
    },
    {
      "timestamp": "2026-02-24T14:02:00Z",
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

### See Also

- [Progress Reporting Guide](../guides/subagents.md#progress-reporting)
- [Progress Architecture](../architecture/subagents.md#6-progress-reporting)

---

## Additional Resources

- [Subagents User Guide](../guides/subagents.md)
- [Subagent Architecture](../architecture/subagents.md)
- [ADR-004: Orchestration Enhancements](../architecture/decisions/004-subagent-orchestration-enhancements.md)
- [Configuration Reference](../config/gateway.md)

---

**Questions?** Join our Discord: https://discord.com/invite/nachos
