# ADR: Hybrid RPC-Based Web Chat Architecture

**Status**: Proposed  
**Date**: 2026-02-26  
**Authors**: Nachos Team  
**Deciders**: [To be filled]

## Context

Nachos needs a web-based chat interface that allows users to interact with the AI agent through a browser. The current implementation uses Server-Sent Events (SSE) for message streaming with an in-memory session store, which has limitations:

1. **Session persistence**: In-memory sessions are lost on server restart
2. **Session management**: No UI for managing multiple sessions
3. **Session history**: No ability to archive/restore conversations
4. **Multi-instance deployment**: Cannot share session state across multiple gateway instances
5. **Scalability**: SSE connections are stateful and limit horizontal scaling

## Decision

We will implement a **hybrid RPC-based architecture** using NATS for both request/reply (RPC) and publish/subscribe (message streaming):

### Hybrid Model Components

1. **PULL (RPC)**: Session management operations
   - List active sessions
   - List archived sessions  
   - Create/archive/restore/delete sessions
   - Pin/unpin sessions

2. **PUSH (Subscribe)**: Real-time message streaming
   - Subscribe to messages for the currently active session only
   - Auto-unsubscribe when switching sessions
   - Use NATS pub/sub for message delivery

### Key Design Decisions

#### Why RPC for Session Management?

**RPC (Request/Reply)** is optimal for session operations because:

- **Synchronous operations**: Session CRUD requires immediate confirmation
- **Consistency**: Need to ensure session state is updated before returning to client
- **Error handling**: Easier to propagate errors back to the caller
- **Atomicity**: Operations like "create session" need to be atomic
- **Caching friendly**: Clients can cache session lists and refresh on-demand

**Alternative considered**: Pure pub/sub for everything
- ❌ Complex state synchronization
- ❌ Race conditions on session creation
- ❌ Difficult error handling
- ❌ Over-notification (every client gets updates for all sessions)

#### Why Pub/Sub for Message Streaming?

**Pub/Sub** is optimal for message streaming because:

- **Real-time delivery**: Messages appear instantly as they're generated
- **Decoupled architecture**: Gateway can publish messages without knowing who's listening
- **Multi-consumer**: Multiple clients can listen to the same session (e.g., monitoring)
- **Efficient**: Only active subscribers receive messages
- **Natural fit**: Message streaming is inherently event-driven

**Alternative considered**: Long polling with RPC
- ❌ Higher latency (polling interval)
- ❌ More network overhead (repeated requests)
- ❌ Server load from constant polling
- ❌ Complexity in tracking what messages are "new"

#### Why NATS (Not WebSockets)?

**NATS** provides:

- ✅ **Existing infrastructure**: Already used throughout Nachos
- ✅ **Request/reply built-in**: Native RPC pattern with correlation IDs
- ✅ **Pub/sub built-in**: Native message streaming
- ✅ **Persistent streams**: Can use JetStream for message history if needed
- ✅ **Horizontal scaling**: Easily add more gateway instances
- ✅ **Security**: Token-based authentication already configured

**Alternative considered**: Direct WebSocket connections
- ❌ Requires separate WebSocket server
- ❌ Stateful connections limit scaling
- ❌ Need to implement reconnection logic
- ❌ Need to implement message acknowledgment
- ❌ Duplicates infrastructure (already have NATS)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vue.js)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────┐  ┌───────────────────────┐   │
│  │    Session Management     │  │   Message Streaming   │   │
│  │         (PULL/RPC)        │  │      (PUSH/Sub)       │   │
│  ├──────────────────────────┤  ├───────────────────────┤   │
│  │ • List active (lazy)     │  │ • EventSource wrapper │   │
│  │ • List archived          │  │ • Session-specific    │   │
│  │ • Create/Archive         │  │ • Auto-unsubscribe    │   │
│  │ • Restore/Delete/Pin     │  │   on switch           │   │
│  └────────────┬─────────────┘  └────────────┬──────────┘   │
│               │                              │              │
└───────────────┼──────────────────────────────┼──────────────┘
                │                              │
                │ HTTP/JSON                    │ HTTP (SSE wrapper)
                ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Admin API Server (Hono)                         │
├─────────────────────────────────────────────────────────────┤
│  HTTP Endpoints:                                             │
│  • /api/webchat/sessions/active      → RPC bridge           │
│  • /api/webchat/sessions/archived    → RPC bridge           │
│  • /api/webchat/sessions/create      → RPC bridge           │
│  • /api/webchat/messages/stream/:id  → SSE wrapper          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ NATS Client
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                        NATS Bus                              │
├─────────────────────────────────────────────────────────────┤
│  RPC Topics (Request/Reply):                                 │
│  • nachos.webchat.sessions.list                             │
│  • nachos.webchat.sessions.listArchived                     │
│  • nachos.webchat.sessions.create                           │
│  • nachos.webchat.sessions.{archive|restore|delete|pin}     │
│                                                              │
│  Pub/Sub Topics:                                            │
│  • nachos.webchat.messages.{sessionId}                      │
│  • nachos.channel.outbound.webchat                          │
└────────────────────────┬───────────────────────────────────┘
                         │
                         │ RPC Service Handler
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              WebChat RPC Service                             │
│  • Handles RPC requests                                      │
│  • Publishes messages to session-specific topics            │
│  • Updates session last_activity                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ PostgresSessionsStore
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      PostgreSQL                              │
│  • sessions (id, channel, status, is_pinned, is_archived,   │
│              last_activity, ...)                             │
│  • messages (id, session_id, role, content, ...)            │
└─────────────────────────────────────────────────────────────┘
```

## Session Lifecycle

### Active Sessions
A session is considered "active" if:
- `is_archived = false` AND
- (`last_activity` within last 24 hours OR `is_pinned = true`)

Active sessions appear in the dropdown.

### Archived Sessions
- Manual archive action moves session to archived state
- `is_archived = true`
- **No auto-archiving by time** (explicit user action only)
- Browsable via "Session History" modal
- Any interaction (restore) returns session to active list

### Pinned Sessions
- Manual pin action keeps session in active list indefinitely
- `is_pinned = true`
- Remains in active list even if `last_activity` > 24 hours
- User can unpin to allow normal lifecycle

## Data Flow Examples

### Create Session and Send Message

```
1. User clicks "New Session"
   Frontend → HTTP POST /api/webchat/sessions/create
   ↓
2. Admin API → NATS Request nachos.webchat.sessions.create
   ↓
3. RPC Service:
   - Creates session in DB
   - Returns session ID
   ↓
4. Frontend receives session ID
   - Switches to new session
   - Subscribes to messages via EventSource
   ↓
5. User types message
   Frontend → HTTP POST /api/webchat/messages/send
   ↓
6. Admin API → NATS Publish nachos.channel.inbound.webchat
   ↓
7. Gateway processes message
   ↓
8. Gateway → NATS Publish nachos.webchat.messages.{sessionId}
   ↓
9. RPC Service subscribes to messages, forwards to SSE stream
   ↓
10. Frontend EventSource receives message
    - Displays in chat UI
```

### Switch Sessions

```
1. User clicks session dropdown
   Frontend → HTTP GET /api/webchat/sessions/active
   (Lazy load on dropdown open)
   ↓
2. Admin API → NATS Request nachos.webchat.sessions.list
   ↓
3. RPC Service queries DB for active sessions
   ↓
4. Frontend displays list
   ↓
5. User selects different session
   Frontend:
   - Closes existing EventSource (unsubscribe)
   - Opens new EventSource for selected session
   - Loads message history
```

## Trade-offs

### Benefits

✅ **Scalability**: Multiple gateway instances can handle different sessions  
✅ **Persistence**: Sessions survive server restarts  
✅ **Real-time**: Message streaming is instant via pub/sub  
✅ **Efficient**: Only subscribe to active session messages  
✅ **Consistency**: RPC ensures session operations are atomic  
✅ **Familiar**: Uses existing NATS infrastructure  
✅ **Testable**: RPC calls are easy to mock and test  
✅ **Decoupled**: Frontend doesn't need to know about NATS topology  

### Drawbacks

❌ **Complexity**: Two communication patterns (RPC + pub/sub)  
❌ **Latency**: HTTP → NATS → HTTP adds small overhead  
❌ **SSE wrapper**: Need to wrap NATS pub/sub in SSE for browser  
❌ **Connection management**: Need to handle SSE reconnection  

### Mitigations

- **Complexity**: Well-documented patterns, clear separation of concerns
- **Latency**: NATS is extremely fast (<1ms), acceptable trade-off
- **SSE wrapper**: Simple abstraction, can be reused for other features
- **Reconnection**: Standard EventSource API handles this automatically

## Alternatives Considered

### 1. Pure WebSockets

**Approach**: Direct WebSocket connection for everything

**Pros**:
- Single connection for all communication
- Native browser support
- Bidirectional messaging

**Cons**:
- Stateful connections limit scaling
- Need to implement custom protocol
- Requires separate WebSocket server
- Duplicates NATS infrastructure
- Complex reconnection logic

**Decision**: ❌ Rejected - doesn't leverage existing NATS infrastructure

### 2. Long Polling

**Approach**: Periodic HTTP requests for new messages

**Pros**:
- Simple to implement
- Works everywhere (no special browser features)
- Stateless

**Cons**:
- Higher latency (polling interval)
- Inefficient (many empty responses)
- Server load from constant requests
- Battery drain on mobile

**Decision**: ❌ Rejected - poor UX due to latency

### 3. GraphQL Subscriptions

**Approach**: GraphQL subscriptions over WebSockets

**Pros**:
- Type-safe schema
- Unified API (queries + subscriptions)
- Good tooling

**Cons**:
- Requires GraphQL server setup
- WebSocket overhead (same as alternative 1)
- Adds another layer of abstraction
- Still need NATS underneath for multi-instance

**Decision**: ❌ Rejected - over-engineering for this use case

### 4. NATS JetStream for Everything

**Approach**: Use JetStream for persistent message storage and replay

**Pros**:
- Built-in message history
- Message replay capabilities
- Guaranteed delivery

**Cons**:
- Overkill for chat messages (already in PostgreSQL)
- Higher complexity
- Storage duplication

**Decision**: ❌ Rejected - PostgreSQL already provides persistence

## Implementation Notes

### Frontend Considerations

1. **Lazy loading**: Session list only loads when dropdown opens
2. **Optimistic updates**: Show message immediately, don't wait for confirmation
3. **Reconnection**: EventSource automatically reconnects on disconnect
4. **Error handling**: Show toast notifications for RPC errors

### Backend Considerations

1. **RPC handler registration**: Use consistent naming convention
2. **Error responses**: Always include error message in envelope
3. **Rate limiting**: Consider rate limits on session creation
4. **Validation**: Validate all RPC request payloads

### Database Considerations

1. **Indexes**: Add indexes for active session queries
2. **Transactions**: Use transactions for archive/restore operations
3. **Cleanup**: Consider background job to clean up old archived sessions
4. **Migration**: Add schema migration for new columns

## Testing Strategy

1. **Unit tests**: Test RPC handlers in isolation
2. **Integration tests**: Test full RPC round-trip
3. **E2E tests**: Test user flows (create → message → archive → restore)
4. **Load tests**: Test multiple concurrent sessions
5. **Multi-tab tests**: Test session sync across browser tabs

## Migration Path

### Phase 1: Parallel Implementation
- Implement new RPC endpoints alongside existing SSE
- Add feature flag to toggle between implementations
- Test with small subset of users

### Phase 2: Frontend Migration
- Update frontend to use RPC by default
- Keep SSE as fallback for compatibility

### Phase 3: Deprecation
- Remove SSE endpoints after stable period
- Clean up old code

## Success Metrics

- [ ] All RPC endpoints functional
- [ ] Message latency < 100ms (p95)
- [ ] Session operations < 200ms (p95)
- [ ] Support 100+ concurrent sessions per gateway
- [ ] Zero session data loss on restart
- [ ] Multi-tab sync working
- [ ] All tests passing (unit, integration, E2E)

## References

- [NATS Request/Reply Pattern](https://docs.nats.io/nats-concepts/core-nats/reqreply)
- [NATS Pub/Sub](https://docs.nats.io/nats-concepts/core-nats/pubsub)
- [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [PostgreSQL Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-26 | Use hybrid RPC + Pub/Sub | Best fit for requirements |
| 2026-02-26 | No auto-archive by time | Explicit user control preferred |
| 2026-02-26 | 24-hour active threshold | Balance between recency and clutter |
| 2026-02-26 | SSE wrapper for browser | Browser-native, no custom protocol |

## Approval

- [ ] Technical Lead
- [ ] Product Owner
- [ ] Security Team
- [ ] DevOps Team
