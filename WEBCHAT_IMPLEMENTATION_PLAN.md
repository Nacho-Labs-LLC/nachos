# Hybrid RPC-Based Web Chat Implementation Plan

## Executive Summary

This document outlines the implementation plan for a hybrid RPC-based web chat with session management for the Nachos framework. The design uses NATS request/reply for RPC-style operations (session management) and NATS subscriptions for push-based message streaming.

## Current State Analysis

### Existing Infrastructure
1. **Message Bus**: NATS-based pub/sub with request/reply RPC pattern
   - `NachosBusClient` provides `request()`, `subscribe()`, and `publish()` methods
   - Message envelopes with correlation IDs for request/reply tracking
   - Topics organized by component (channel, gateway, etc.)

2. **Session Storage**: PostgreSQL-based session store
   - `PostgresSessionsStore` with full CRUD operations
   - Session schema: `id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at`
   - Message schema: `id, session_id, role, content, tool_calls, created_at`
   - Atomic operations using PostgreSQL transactions

3. **Current Chat Implementation**: SSE-based (to be replaced)
   - `/api/chat/send` - POST endpoint for sending messages
   - `/api/chat/stream` - SSE endpoint for receiving messages
   - In-memory session store (Map-based)

### Requirements Alignment
- ✅ RPC infrastructure exists (NATS request/reply)
- ✅ Database schema supports sessions
- ❌ Session archiving/pinning not implemented
- ❌ RPC endpoints for session management don't exist
- ❌ Frontend session management UI doesn't exist
- ❌ Hybrid push/pull model needs implementation

## Architecture Design

### Hybrid Push/Pull Model

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Vue.js)                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  PULL (RPC):                    PUSH (Subscribe):            │
│  ┌─────────────────────┐       ┌──────────────────────┐    │
│  │ Session Management  │       │ Message Stream       │    │
│  │ • List active       │       │ • Real-time messages │    │
│  │ • List archived     │       │ • For active session │    │
│  │ • Create            │       │ • Auto-unsubscribe   │    │
│  │ • Archive/Restore   │       │   on session switch  │    │
│  │ • Pin/Delete        │       └──────────────────────┘    │
│  └─────────────────────┘                                    │
│          │                              │                   │
└──────────┼──────────────────────────────┼───────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│             Backend (Hono + NATS Bus Client)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  RPC Endpoints (Request/Reply):                              │
│  • nachos.webchat.sessions.list                             │
│  • nachos.webchat.sessions.listArchived                     │
│  • nachos.webchat.sessions.create                           │
│  • nachos.webchat.sessions.archive                          │
│  • nachos.webchat.sessions.restore                          │
│  • nachos.webchat.sessions.delete                           │
│  • nachos.webchat.sessions.pin                              │
│  • nachos.webchat.messages.send                             │
│                                                              │
│  Pub/Sub Topics (Subscribe):                                │
│  • nachos.channel.outbound.webchat                          │
│  • nachos.webchat.messages.{sessionId}                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      NATS Bus                                │
│  • Request/Reply for RPC                                     │
│  • Pub/Sub for message streaming                            │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL Session Store                        │
│  • sessions table (with is_pinned, is_archived)             │
│  • messages table                                            │
└─────────────────────────────────────────────────────────────┘
```

### Session Lifecycle

```
┌──────────────┐
│   Created    │ (New session)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    Active    │ (last_activity < 24h OR is_pinned = true)
└──┬────────┬──┘
   │        │
   │        │ Manual archive
   │        ▼
   │   ┌──────────────┐
   │   │   Archived   │ (Manual action, no auto-archive)
   │   └──┬───────────┘
   │      │
   │      │ Restore (any interaction)
   │      │
   │      └──────────┐
   │                 │
   │                 ▼
   │          ┌──────────────┐
   └──────────│    Active    │
              └──────┬───────┘
                     │
                     │ Manual delete
                     ▼
              ┌──────────────┐
              │   Deleted    │ (Permanent removal)
              └──────────────┘
```

## Database Schema Changes

### Add Session Metadata Columns

```sql
-- Add columns to existing sessions table
ALTER TABLE sessions ADD COLUMN is_pinned BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN is_archived BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create index for active sessions query
CREATE INDEX idx_sessions_active 
ON sessions(channel, is_archived, last_activity) 
WHERE is_archived = false;

-- Create index for archived sessions query
CREATE INDEX idx_sessions_archived 
ON sessions(channel, is_archived, updated_at) 
WHERE is_archived = true;
```

### Update Session Type

```typescript
// packages/shared/types/src/schemas.ts
interface Session {
  id: string;
  channel: string;
  conversationId: string;
  userId: string;
  status: SessionStatus;
  systemPrompt?: string;
  config: SessionConfig;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  
  // NEW FIELDS
  isPinned: boolean;
  isArchived: boolean;
  lastActivity: string;
}
```

## Implementation Plan

### Phase 1: Database Schema & Store Updates (1-2 hours)

**Files to modify:**
1. `packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.ts`
   - Add schema migration in `runSchema()`
   - Update `rowToSession()` to map new fields
   - Add `pinSession()`, `archiveSession()`, `restoreSession()` methods
   - Update `listSessions()` to filter by active/archived status
   - Update `addMessage()` to update `last_activity` timestamp

2. `packages/shared/types/src/schemas.ts`
   - Add `isPinned`, `isArchived`, `lastActivity` to Session interface

**Tests:**
- Unit tests for new session store methods
- Migration test to ensure schema changes work

### Phase 2: Backend RPC Service (2-3 hours)

**Files to create:**
1. `packages/core/admin/src/rpc/webchat-rpc-service.ts`
   - RPC handler class that listens to NATS topics
   - Implements all RPC methods using request/reply pattern
   - Uses PostgresSessionsStore for data operations

```typescript
export class WebChatRPCService {
  constructor(
    private bus: NachosBusClient,
    private store: PostgresSessionsStore
  ) {}

  async start() {
    // Register RPC handlers
    await this.bus.subscribe(
      'nachos.webchat.sessions.list',
      this.handleListSessions.bind(this)
    );
    // ... other handlers
  }

  private async handleListSessions(envelope, rawMsg) {
    const { userId } = envelope.payload;
    
    // Get active sessions (last 24h OR pinned)
    const sessions = await this.store.listActiveSessions(userId);
    
    rawMsg.respond({ sessions });
  }
  
  // ... other RPC handlers
}
```

**Files to modify:**
1. `packages/core/admin/src/server.ts`
   - Initialize and start WebChatRPCService
   - Wire up NATS bus client

**Tests:**
- Integration tests for each RPC endpoint
- Test session lifecycle transitions

### Phase 3: Backend HTTP → RPC Bridge (1-2 hours)

**Files to modify:**
1. `packages/core/admin/src/routes/chat.ts`
   - Replace SSE with RPC client calls
   - Keep HTTP endpoints but use RPC internally
   - Implement polling or long-polling for message retrieval

```typescript
// Example: Replace SSE with polling
chatRouter.get('/messages/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const since = c.req.query('since') || '0';
  
  const bus = await getBusClient();
  
  // Subscribe to session-specific message topic
  const messages = await bus.request(
    'nachos.webchat.messages.get',
    { sessionId, since }
  );
  
  return c.json(messages.payload);
});

// Or use Server-Sent Events as a wrapper over NATS subscription
chatRouter.get('/messages/stream/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  
  return streamSSE(c, async (stream) => {
    const bus = await getBusClient();
    
    // Subscribe to session-specific NATS topic
    await bus.subscribe(
      `nachos.webchat.messages.${sessionId}`,
      async (envelope) => {
        await stream.writeSSE({
          data: JSON.stringify(envelope.payload),
          event: 'message',
        });
      }
    );
    
    // Wait for disconnect
    await new Promise(() => {
      stream.onAbort(() => {
        // Unsubscribe handled by stream cleanup
      });
    });
  });
});
```

**Tests:**
- HTTP endpoint tests
- Integration tests with RPC service

### Phase 4: Frontend API Client (1-2 hours)

**Files to create:**
1. `packages/core/admin/frontend/src/api/webchat.ts`
   - Session management functions
   - Message sending/receiving
   - EventSource wrapper for message streaming

```typescript
export interface ActiveSession {
  id: string;
  name: string;
  lastActivity: string;
  messageCount: number;
  isPinned: boolean;
}

export interface ArchivedSession {
  id: string;
  name: string;
  archivedAt: string;
  messageCount: number;
}

export const listActiveSessions = () =>
  request<{ sessions: ActiveSession[] }>('/api/webchat/sessions/active');

export const listArchivedSessions = (options?: { search?: string }) =>
  request<{ sessions: ArchivedSession[] }>('/api/webchat/sessions/archived', {
    method: 'POST',
    body: JSON.stringify(options),
  });

export const createSession = (name: string) =>
  request<{ session: ActiveSession }>('/api/webchat/sessions/create', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const archiveSession = (sessionId: string) =>
  request<{ ok: boolean }>(`/api/webchat/sessions/${sessionId}/archive`, {
    method: 'POST',
  });

export const restoreSession = (sessionId: string) =>
  request<{ ok: boolean }>(`/api/webchat/sessions/${sessionId}/restore`, {
    method: 'POST',
  });

export const deleteSession = (sessionId: string) =>
  request<{ ok: boolean }>(`/api/webchat/sessions/${sessionId}/delete`, {
    method: 'DELETE',
  });

export const pinSession = (sessionId: string, pinned: boolean) =>
  request<{ ok: boolean }>(`/api/webchat/sessions/${sessionId}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });

// Message streaming using EventSource (SSE wrapper over NATS)
export function subscribeToMessages(
  sessionId: string,
  onMessage: (msg: Message) => void,
  onError?: (err: Error) => void
): () => void {
  const eventSource = new EventSource(`/api/webchat/messages/stream/${sessionId}`);
  
  eventSource.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    onMessage(msg);
  });
  
  eventSource.addEventListener('error', (e) => {
    onError?.(new Error('Stream error'));
  });
  
  return () => eventSource.close();
}
```

**Tests:**
- Mock API tests for each function

### Phase 5: Frontend UI Components (2-3 hours)

**Files to create:**
1. `packages/core/admin/frontend/src/components/SessionDropdown.vue`
   - Dropdown showing active sessions
   - Lazy-load on open
   - Sort by most recent activity
   - Show pin indicator

2. `packages/core/admin/frontend/src/components/SessionHistoryModal.vue`
   - Modal for browsing archived sessions
   - Search functionality
   - Restore/delete actions

**Files to modify:**
1. `packages/core/admin/frontend/src/pages/ChatPage.vue`
   - Add SessionDropdown component
   - Add "New Session" button
   - Add "History" button
   - Update message display to sync with active session
   - Handle session switching (unsubscribe old, subscribe new)

```vue
<template>
  <div class="page chat-page">
    <header class="page-header">
      <div class="session-controls">
        <SessionDropdown 
          v-model="activeSessionId"
          :sessions="activeSessions"
          @refresh="loadActiveSessions"
        />
        <button class="btn-icon" @click="createNewSession">
          + New Session
        </button>
        <button class="btn-icon" @click="showHistory = true">
          📁 History
        </button>
      </div>
    </header>

    <!-- ... existing chat UI ... -->

    <SessionHistoryModal
      v-if="showHistory"
      @close="showHistory = false"
      @restore="handleRestoreSession"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { 
  listActiveSessions, 
  createSession, 
  subscribeToMessages 
} from '../api/webchat';
import SessionDropdown from '../components/SessionDropdown.vue';
import SessionHistoryModal from '../components/SessionHistoryModal.vue';

const activeSessionId = ref<string | null>(null);
const activeSessions = ref([]);
const showHistory = ref(false);
let unsubscribe: (() => void) | null = null;

// Watch for session changes
watch(activeSessionId, (newSessionId, oldSessionId) => {
  if (oldSessionId && unsubscribe) {
    unsubscribe();
  }
  
  if (newSessionId) {
    unsubscribe = subscribeToMessages(
      newSessionId,
      (msg) => messages.value.push(msg)
    );
  }
});

async function loadActiveSessions() {
  const response = await listActiveSessions();
  activeSessions.value = response.sessions;
}

onMounted(() => {
  loadActiveSessions();
});
</script>
```

**Tests:**
- Component tests for each UI element
- E2E tests for user flows

### Phase 6: Multi-Tab Session Sync (1 hour)

**Files to create:**
1. `packages/core/admin/frontend/src/composables/useSessionSync.ts`
   - Use BroadcastChannel API for cross-tab communication
   - Sync active session ID across tabs
   - Trigger session list refresh when dropdown opens

```typescript
import { ref, watch } from 'vue';

const CHANNEL_NAME = 'nachos-webchat-sync';

export function useSessionSync() {
  const activeSessionId = ref<string | null>(null);
  const channel = new BroadcastChannel(CHANNEL_NAME);

  // Listen for session changes from other tabs
  channel.onmessage = (event) => {
    if (event.data.type === 'session-changed') {
      activeSessionId.value = event.data.sessionId;
    } else if (event.data.type === 'refresh-sessions') {
      // Trigger session list refresh
      loadActiveSessions();
    }
  };

  // Broadcast session changes to other tabs
  watch(activeSessionId, (newSessionId) => {
    channel.postMessage({
      type: 'session-changed',
      sessionId: newSessionId,
    });
  });

  function broadcastRefresh() {
    channel.postMessage({ type: 'refresh-sessions' });
  }

  return {
    activeSessionId,
    broadcastRefresh,
  };
}
```

**Tests:**
- Multi-tab sync tests using Playwright

### Phase 7: Testing & Documentation (2 hours)

**Files to create:**
1. `docs/adr/WEBCHAT_HYBRID_RPC_ARCHITECTURE.md`
   - Document the hybrid push/pull decision
   - Explain why RPC for session management
   - Explain why pub/sub for message streaming
   - Trade-offs and alternatives considered

2. `packages/core/admin/README.md` (update)
   - Add webchat usage documentation
   - API endpoint reference
   - Frontend component usage

**Tests to add:**
- Integration test: Full session lifecycle
- Integration test: Message streaming
- E2E test: Create session → send messages → archive → restore
- Load test: Multiple sessions, concurrent message streams

## RPC Topic Naming Convention

```
nachos.webchat.sessions.list          -> GET active sessions
nachos.webchat.sessions.listArchived  -> GET archived sessions
nachos.webchat.sessions.create        -> POST create session
nachos.webchat.sessions.archive       -> POST archive session
nachos.webchat.sessions.restore       -> POST restore session
nachos.webchat.sessions.delete        -> DELETE session
nachos.webchat.sessions.pin           -> POST pin/unpin session
nachos.webchat.messages.send          -> POST send message
nachos.webchat.messages.{sessionId}   -> SUB message stream (pub/sub)
```

## Request/Response Payloads

### List Active Sessions
```typescript
// Request
{ userId: string }

// Response
{
  sessions: Array<{
    id: string;
    name: string;
    lastActivity: string;
    messageCount: number;
    isPinned: boolean;
  }>
}
```

### List Archived Sessions
```typescript
// Request
{ userId: string, search?: string, limit?: number, offset?: number }

// Response
{
  sessions: Array<{
    id: string;
    name: string;
    archivedAt: string;
    messageCount: number;
  }>,
  total: number
}
```

### Create Session
```typescript
// Request
{ userId: string, name?: string }

// Response
{
  session: {
    id: string;
    name: string;
    createdAt: string;
  }
}
```

### Archive Session
```typescript
// Request
{ sessionId: string }

// Response
{ ok: boolean }
```

### Send Message
```typescript
// Request
{
  sessionId: string;
  userId: string;
  text: string;
}

// Response
{
  messageId: string;
  timestamp: string;
}
```

### Message Stream (Pub/Sub)
```typescript
// Published to: nachos.webchat.messages.{sessionId}
{
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
```

## Migration Strategy

### Phase 1: Add RPC alongside existing SSE
- Keep existing `/api/chat/*` endpoints
- Add new RPC service in parallel
- Frontend can use either (feature flag)

### Phase 2: Migrate frontend to RPC
- Update frontend to use new API
- Keep SSE as fallback

### Phase 3: Deprecate SSE
- Remove SSE endpoints
- Clean up old code

## Success Criteria

✅ All RPC endpoints implemented and tested  
✅ Session lifecycle (create → active → archive → restore → delete) works  
✅ Message streaming works in real-time  
✅ Session dropdown shows active sessions (last 24h OR pinned)  
✅ Session history modal shows archived sessions with search  
✅ Multi-tab session sync works  
✅ ADR document published  
✅ All tests passing (unit, integration, E2E)  
✅ Documentation complete  

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Database & Store | 1-2 hours | - |
| Phase 2: Backend RPC Service | 2-3 hours | Phase 1 |
| Phase 3: HTTP → RPC Bridge | 1-2 hours | Phase 2 |
| Phase 4: Frontend API Client | 1-2 hours | Phase 3 |
| Phase 5: Frontend UI | 2-3 hours | Phase 4 |
| Phase 6: Multi-Tab Sync | 1 hour | Phase 5 |
| Phase 7: Testing & Docs | 2 hours | All phases |
| **Total** | **10-15 hours** | |

## Next Steps

1. ✅ Review implementation plan
2. ⬜ Get approval from stakeholders
3. ⬜ Create feature branch
4. ⬜ Start Phase 1 implementation
5. ⬜ Progressive implementation through phases
6. ⬜ Code review
7. ⬜ Merge to main

## Questions / Decisions Needed

1. **Session naming**: Should sessions have user-provided names or auto-generated names (e.g., "Chat 1", "Chat 2")?
2. **Active threshold**: Confirm 24-hour threshold for active sessions?
3. **Auto-archive**: Explicitly no auto-archiving, correct?
4. **Message pagination**: Should we paginate message history or load all messages?
5. **Thinking/tool status**: Should we keep the thinking/tool status indicators from current implementation?
6. **Model selection**: Should sessions support per-session model selection?
