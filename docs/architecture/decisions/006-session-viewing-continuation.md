# ADR-006: Session Viewing and Continuation in Admin UI

**Status:** Draft (Research in Progress)  
**Date:** 2026-02-25  
**Author:** Claw (with research subagent assistance)  
**Research SubAgent:** runId `3a5fdaf8-5888-4355-bd2c-fa98247930f7`

## Context

Users need the ability to view and continue conversations across all active sessions in the Nachos admin UI, similar to OpenClaw's functionality. Currently, Nachos has:

- **Sessions**: Managed by SessionManager, stored in StateStorage (SQLite currently, Postgres/Redis planned)
- **Admin UI**: Vue.js frontend with API endpoints for management tasks
- **Multiple session types**: Webchat, channel-based (Discord/Telegram/etc), subagent sessions

### Current Limitations

1. **No session browsing**: Admin UI cannot list active sessions
2. **No message history viewing**: Cannot see conversation history for a session
3. **No session continuation**: Cannot send new messages to an existing session
4. **No session switching**: Cannot navigate between different sessions
5. **Limited observability**: Hard to debug or monitor active conversations

### OpenClaw Reference Model

OpenClaw provides comprehensive session management:
- **"main" session**: Primary webchat UI session
- **Channel sessions**: One session per Discord channel/conversation
- **Subagent sessions**: Each subagent spawn creates a tracked session
- **Admin UI features**: Session list, history viewer, message continuation

> **Note**: Detailed OpenClaw research findings will be integrated below when subagent completes investigation.

---

## Research Findings

> 🔬 **Research in Progress**  
> SubAgent runId: `3a5fdaf8-5888-4355-bd2c-fa98247930f7`  
> Status: Investigating OpenClaw session architecture  
> ETA: ~10 minutes

### Session Types (Preliminary)

*[Subagent will document OpenClaw's session types, lifecycle, and data model]*

### Session Data Model (Preliminary)

*[Subagent will document session fields, relationships, and storage]*

### Admin UI Architecture (Preliminary)

*[Subagent will document UI components, API endpoints, and user flows]*

### Key Implementation Details (Preliminary)

*[Subagent will document code locations, patterns, and best practices]*

---

## Decision

**Implement session viewing and continuation in Nachos Admin UI** with the following components:

### 1. Backend API Enhancements

#### New REST Endpoints

```typescript
// List sessions with filtering
GET /api/sessions
Query params:
  - status?: 'active' | 'paused' | 'ended'
  - channel?: string
  - limit?: number
  - offset?: number
  - since?: ISO timestamp

Response: {
  sessions: SessionSummary[]
  total: number
  hasMore: boolean
}

// Get session details with messages
GET /api/sessions/:sessionId
Query params:
  - messageLimit?: number
  - messageOffset?: number

Response: {
  session: Session
  messages: Message[]
  messageCount: number
}

// Send message to session (continuation)
POST /api/sessions/:sessionId/messages
Body: {
  content: string
  role?: 'user' | 'assistant'
}

Response: {
  message: Message
  responseStarted: boolean
}

// Get session metadata
GET /api/sessions/:sessionId/metadata

Response: {
  metadata: Record<string, unknown>
  stats: {
    messageCount: number
    lastActivity: ISO timestamp
    duration: number
  }
}
```

#### WebSocket Support (Optional Phase 2)

```typescript
// Real-time session updates
WS /api/sessions/:sessionId/stream

Events:
  - message.created: New message added
  - session.updated: Session metadata changed
  - llm.chunk: Streaming response chunk
  - llm.complete: Response finished
```

### 2. Frontend Components

#### SessionList Component

```vue
<template>
  <div class="session-list">
    <!-- Filters -->
    <SessionFilters 
      v-model:status="filters.status"
      v-model:channel="filters.channel"
      @update="loadSessions"
    />
    
    <!-- Session cards -->
    <div class="sessions">
      <SessionCard
        v-for="session in sessions"
        :key="session.id"
        :session="session"
        :active="activeSessionId === session.id"
        @click="selectSession(session.id)"
      />
    </div>
    
    <!-- Pagination -->
    <Pagination
      :total="totalSessions"
      :page-size="pageSize"
      @change="loadPage"
    />
  </div>
</template>
```

#### SessionViewer Component

```vue
<template>
  <div class="session-viewer">
    <!-- Session header -->
    <SessionHeader 
      :session="currentSession"
      @refresh="loadMessages"
      @export="exportSession"
    />
    
    <!-- Message history -->
    <MessageList
      :messages="messages"
      :loading="loading"
      @load-more="loadMoreMessages"
    />
    
    <!-- Message input (continuation) -->
    <MessageInput
      v-if="currentSession.status === 'active'"
      :disabled="sending"
      @send="sendMessage"
      placeholder="Continue conversation..."
    />
  </div>
</template>
```

#### SessionCard Component

```vue
<template>
  <div 
    class="session-card"
    :class="{ active, ended: session.status === 'ended' }"
  >
    <div class="header">
      <span class="channel-badge">{{ session.channel }}</span>
      <span class="status-badge" :class="session.status">
        {{ session.status }}
      </span>
    </div>
    
    <div class="info">
      <div class="title">{{ sessionTitle }}</div>
      <div class="meta">
        <span>{{ session.messageCount }} messages</span>
        <span>{{ formatRelativeTime(session.updatedAt) }}</span>
      </div>
    </div>
    
    <div class="preview">
      {{ lastMessagePreview }}
    </div>
  </div>
</template>
```

### 3. SessionManager Enhancements

Add session querying methods (already async from PR #123):

```typescript
// SessionManager additions
class SessionManager {
  /**
   * List sessions with rich filtering
   */
  async listSessionsWithDetails(options: {
    status?: SessionStatus;
    channel?: string;
    userId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
    includeMessageCount?: boolean;
    includeLastMessage?: boolean;
  }): Promise<SessionSummary[]>

  /**
   * Get session summary for UI display
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary | null>

  /**
   * Export session for debugging/archival
   */
  async exportSession(sessionId: string): Promise<SessionExport>
}

interface SessionSummary {
  id: string;
  channel: string;
  conversationId: string;
  userId: string;
  status: SessionStatus;
  messageCount: number;
  lastMessage?: {
    role: MessageRole;
    content: string;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

interface SessionExport {
  session: Session;
  messages: Message[];
  exportedAt: string;
  version: string;
}
```

### 4. Gateway Management Handlers

Add session viewing endpoints to Gateway management API:

```typescript
// In packages/core/gateway/src/management/management-handlers.ts

async handleListSessions(req: ManagementRequest): Promise<ManagementResponse> {
  const { status, channel, limit = 50, offset = 0 } = req.params;
  
  const sessions = await this.sessionManager.listSessionsWithDetails({
    status,
    channel,
    limit,
    offset,
    includeMessageCount: true,
    includeLastMessage: true,
  });
  
  return {
    status: 'success',
    data: {
      sessions,
      total: sessions.length,
      hasMore: sessions.length === limit,
    },
  };
}

async handleGetSession(req: ManagementRequest): Promise<ManagementResponse> {
  const { sessionId, messageLimit = 100, messageOffset = 0 } = req.params;
  
  const session = await this.sessionManager.getSessionWithMessages(sessionId);
  if (!session) {
    throw createSessionNotFoundError('Session not found', { sessionId });
  }
  
  const messages = await this.sessionManager.getMessages(sessionId, {
    limit: messageLimit,
    offset: messageOffset,
  });
  
  const messageCount = await this.sessionManager.getMessageCount(sessionId);
  
  return {
    status: 'success',
    data: {
      session,
      messages,
      messageCount,
    },
  };
}

async handleSendSessionMessage(req: ManagementRequest): Promise<ManagementResponse> {
  const { sessionId } = req.params;
  const { content, role = 'user' } = req.body;
  
  const session = await this.sessionManager.getSession(sessionId);
  if (!session) {
    throw createSessionNotFoundError('Session not found', { sessionId });
  }
  
  if (session.status !== 'active') {
    throw createInvalidStateError('Session is not active', { 
      sessionId, 
      status: session.status 
    });
  }
  
  // Add message to session
  const message = await this.sessionManager.addMessage(sessionId, {
    role,
    content,
  });
  
  // If role is 'user', trigger LLM response
  let responseStarted = false;
  if (role === 'user') {
    // Queue LLM request (async, don't await)
    this.processSessionMessage(sessionId, message).catch(err => {
      logger.error({ err, sessionId }, 'Failed to process session message');
    });
    responseStarted = true;
  }
  
  return {
    status: 'success',
    data: {
      message,
      responseStarted,
    },
  };
}
```

### 5. Admin UI Integration

#### New Routes

```typescript
// packages/admin/src/router/index.ts

{
  path: '/sessions',
  component: SessionsLayout,
  children: [
    {
      path: '',
      name: 'SessionList',
      component: () => import('@/views/SessionList.vue'),
    },
    {
      path: ':sessionId',
      name: 'SessionViewer',
      component: () => import('@/views/SessionViewer.vue'),
      props: true,
    },
  ],
}
```

#### Navigation

Add "Sessions" link to main navigation:
```vue
<nav>
  <router-link to="/dashboard">Dashboard</router-link>
  <router-link to="/sessions">Sessions</router-link>  <!-- NEW -->
  <router-link to="/config">Config</router-link>
  <router-link to="/logs">Logs</router-link>
</nav>
```

### 6. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Admin UI (Vue)                           │
│  ┌──────────────┐           ┌─────────────────┐                │
│  │ SessionList  │◄─────────►│ SessionViewer   │                │
│  │              │           │                 │                │
│  │ - Filter     │           │ - Message list  │                │
│  │ - Search     │           │ - Input box     │                │
│  │ - Pagination │           │ - Send message  │                │
│  └──────┬───────┘           └────────┬────────┘                │
│         │                             │                          │
└─────────┼─────────────────────────────┼──────────────────────────┘
          │                             │
          │ HTTP/REST                   │ HTTP/REST (+ optional WS)
          ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gateway Management API                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  GET  /api/sessions              → listSessions()        │  │
│  │  GET  /api/sessions/:id          → getSession()          │  │
│  │  POST /api/sessions/:id/messages → sendSessionMessage()  │  │
│  │  GET  /api/sessions/:id/metadata → getSessionMetadata()  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                               │                                  │
│                               ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              SessionManager (async)                       │  │
│  │  - listSessionsWithDetails()                             │  │
│  │  - getSessionWithMessages()                              │  │
│  │  - addMessage()                                          │  │
│  │  - getMessages()                                         │  │
│  └──────────────────┬───────────────────────────────────────┘  │
│                     │                                            │
│                     ▼                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         StateStorage (async, SQLite/Postgres)            │  │
│  │  - listSessions()                                        │  │
│  │  - getSession()                                          │  │
│  │  - getMessages()                                         │  │
│  │  - addMessage()                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Backend Foundation (Week 1)

1. **SessionManager enhancements** (2 days)
   - Add `listSessionsWithDetails()` method
   - Add `getSessionSummary()` method
   - Add rich filtering support (status, channel, date range)
   - Tests for new methods

2. **Gateway Management API** (2 days)
   - Add `/api/sessions` endpoint (list)
   - Add `/api/sessions/:id` endpoint (get)
   - Add `/api/sessions/:id/messages` endpoint (send)
   - Add `/api/sessions/:id/metadata` endpoint
   - Tests for all endpoints

3. **StateStorage optimizations** (1 day)
   - Add indexes for common queries (channel, status, updatedAt)
   - Optimize message pagination queries
   - Add session summary query (single SQL query with message count)

### Phase 2: Frontend Components (Week 2)

1. **SessionList view** (3 days)
   - Create SessionList.vue
   - Create SessionCard.vue
   - Create SessionFilters.vue
   - Add API client methods
   - Implement pagination
   - Add search/filtering

2. **SessionViewer view** (2 days)
   - Create SessionViewer.vue
   - Create MessageList.vue
   - Create MessageInput.vue
   - Handle message sending
   - Handle loading states
   - Add export functionality

### Phase 3: Polish & Testing (Week 3)

1. **UI/UX improvements** (2 days)
   - Real-time updates (polling or WebSocket)
   - Loading skeletons
   - Error handling
   - Responsive design
   - Keyboard shortcuts

2. **Integration testing** (2 days)
   - E2E tests for session viewing
   - E2E tests for message continuation
   - E2E tests for filtering/search
   - Performance testing (large session lists)

3. **Documentation** (1 day)
   - User guide for session management
   - API documentation
   - Architecture diagrams
   - Update README

### Phase 4: WebSocket Support (Optional, Week 4)

1. **Real-time updates** (3-4 days)
   - WebSocket endpoint for session streaming
   - Live message updates
   - Typing indicators
   - Session status changes

---

## Consequences

### Positive

1. **Better observability**: Can see all active conversations
2. **Improved debugging**: View session history without logs
3. **Enhanced UX**: Continue conversations from admin UI
4. **Multi-channel support**: Unified view across Discord, Telegram, etc.
5. **Subagent monitoring**: Track and debug subagent sessions
6. **Export capability**: Archive important sessions
7. **Performance**: Indexed queries for fast session listing

### Negative

1. **Added complexity**: More UI components and API endpoints
2. **Storage growth**: Sessions and messages accumulate over time
   - Mitigation: Implement session archival/cleanup
3. **Security considerations**: Admin UI has full session access
   - Mitigation: Proper authentication and authorization
4. **State sync**: UI must stay in sync with active sessions
   - Mitigation: WebSocket support or periodic polling

### Neutral

1. **Async SessionManager required**: Good thing we just implemented PR #123!
2. **Database performance**: May need to add indexes for fast queries
   - Already planned in implementation

---

## Alternatives Considered

### 1. Read-only Session Viewer

**Rejected**: Users need to test conversations, not just view them.

### 2. Separate Chat UI vs Admin UI

**Considered**: Have a dedicated chat UI instead of embedding in admin.  
**Decision**: Keep in admin UI for now, but design with separation in mind.

### 3. WebSocket-first vs REST-first

**Decision**: Start with REST (simpler), add WebSocket in Phase 4 if needed.

### 4. SQLite vs Postgres for Session Storage

**Decision**: SQLite for now (simpler), Postgres migration path already planned (ADR-005).

---

## Open Questions

1. **Session retention policy**: How long should inactive sessions be kept?
   - Proposed: 30 days for inactive, 90 days for ended, configurable

2. **WebSocket priority**: Is real-time streaming essential for v1?
   - Proposed: Phase 4 (optional), REST + polling sufficient for v1

3. **Search functionality**: Full-text search across message content?
   - Proposed: Phase 2 enhancement, start with metadata filtering

4. **Export format**: JSON? Markdown? Both?
   - Proposed: JSON for programmatic, Markdown for human-readable

5. **Session archival**: Automatic archival of old sessions?
   - Proposed: Phase 3 enhancement, manual export for now

---

## References

- [ADR-004: Subagent Orchestration](./004-subagent-orchestration-enhancements.md)
- [ADR-005: Modular Storage Backends](./005-modular-storage-backends.md) (if exists)
- [PR #123: Async SessionManager](https://github.com/Nacho-Labs-LLC/nachos/pull/123)
- OpenClaw session management (research findings above)
- Admin UI architecture (packages/admin/)

---

## Appendix: OpenClaw Research Details

> 🔬 **Subagent Research Status**  
> RunId: `3a5fdaf8-5888-4355-bd2c-fa98247930f7`  
> Started: 2026-02-26 01:03 UTC  
> Status: In Progress

*[Detailed research findings will be appended here when subagent completes]*

---

## Appendix: API Examples

### List Sessions

```bash
curl http://localhost:3000/api/sessions?status=active&limit=20
```

Response:
```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "channel": "discord",
      "conversationId": "channel:123456",
      "userId": "user:789",
      "status": "active",
      "messageCount": 42,
      "lastMessage": {
        "role": "assistant",
        "content": "I can help with that...",
        "createdAt": "2026-02-26T01:00:00.000Z"
      },
      "createdAt": "2026-02-25T12:00:00.000Z",
      "updatedAt": "2026-02-26T01:00:00.000Z"
    }
  ],
  "total": 15,
  "hasMore": false
}
```

### Get Session Details

```bash
curl http://localhost:3000/api/sessions/sess_abc123?messageLimit=50
```

Response:
```json
{
  "session": {
    "id": "sess_abc123",
    "channel": "discord",
    "conversationId": "channel:123456",
    "userId": "user:789",
    "status": "active",
    "config": {},
    "metadata": {
      "guildId": "guild:456",
      "channelName": "#general"
    },
    "createdAt": "2026-02-25T12:00:00.000Z",
    "updatedAt": "2026-02-26T01:00:00.000Z"
  },
  "messages": [
    {
      "id": "msg_001",
      "sessionId": "sess_abc123",
      "role": "user",
      "content": "Hello!",
      "createdAt": "2026-02-25T12:01:00.000Z"
    },
    {
      "id": "msg_002",
      "sessionId": "sess_abc123",
      "role": "assistant",
      "content": "Hi! How can I help?",
      "createdAt": "2026-02-25T12:01:05.000Z"
    }
  ],
  "messageCount": 42
}
```

### Send Message to Session

```bash
curl -X POST http://localhost:3000/api/sessions/sess_abc123/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "What is the weather today?", "role": "user"}'
```

Response:
```json
{
  "message": {
    "id": "msg_043",
    "sessionId": "sess_abc123",
    "role": "user",
    "content": "What is the weather today?",
    "createdAt": "2026-02-26T01:05:00.000Z"
  },
  "responseStarted": true
}
```

---

**End of ADR-006 (Draft - Awaiting Research Completion)**
