# Web Chat Implementation - Quick Start Guide

## 📋 Overview

This guide provides step-by-step instructions for implementing the hybrid RPC-based web chat with session management.

## 🎯 Prerequisites

- PostgreSQL database running and accessible
- NATS server running
- Nachos gateway and admin services running
- Node.js and pnpm installed

## 🚀 Implementation Checklist

### Phase 1: Database Schema (1-2 hours)

**Tasks:**
- [ ] Add session metadata columns to PostgreSQL
- [ ] Create indexes for active/archived queries
- [ ] Update TypeScript Session interface
- [ ] Update PostgresSessionsStore methods
- [ ] Write unit tests for new store methods

**Commands:**
```bash
# Run migration script (to be created)
pnpm run db:migrate:webchat

# Test
pnpm test packages/core/gateway/src/state-layer/sessions
```

**Files to modify:**
- `packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.ts`
- `packages/shared/types/src/schemas.ts`

### Phase 2: Backend RPC Service (2-3 hours)

**Tasks:**
- [ ] Create WebChatRPCService class
- [ ] Implement RPC handlers for session management
- [ ] Register RPC handlers with NATS
- [ ] Wire up service in admin server
- [ ] Write integration tests

**Commands:**
```bash
# Create new files
mkdir -p packages/core/admin/src/rpc
touch packages/core/admin/src/rpc/webchat-rpc-service.ts
touch packages/core/admin/src/rpc/webchat-rpc-service.test.ts

# Test
pnpm test packages/core/admin/src/rpc
```

**Files to create:**
- `packages/core/admin/src/rpc/webchat-rpc-service.ts`
- `packages/core/admin/src/rpc/webchat-rpc-service.test.ts`

**Files to modify:**
- `packages/core/admin/src/server.ts`

### Phase 3: HTTP → RPC Bridge (1-2 hours)

**Tasks:**
- [ ] Update chat routes to use RPC client
- [ ] Keep SSE wrapper for message streaming
- [ ] Add error handling
- [ ] Write integration tests

**Commands:**
```bash
# Test
pnpm test packages/core/admin/src/routes/chat.test.ts
```

**Files to modify:**
- `packages/core/admin/src/routes/chat.ts`

### Phase 4: Frontend API Client (1-2 hours)

**Tasks:**
- [ ] Create webchat API client
- [ ] Implement session management functions
- [ ] Implement message streaming wrapper
- [ ] Write mock API tests

**Commands:**
```bash
# Create new file
touch packages/core/admin/frontend/src/api/webchat.ts

# Test
pnpm test:frontend
```

**Files to create:**
- `packages/core/admin/frontend/src/api/webchat.ts`

### Phase 5: Frontend UI Components (2-3 hours)

**Tasks:**
- [ ] Create SessionDropdown component
- [ ] Create SessionHistoryModal component
- [ ] Update ChatPage to use new components
- [ ] Add multi-tab session sync
- [ ] Write component tests

**Commands:**
```bash
# Create new components
mkdir -p packages/core/admin/frontend/src/components
touch packages/core/admin/frontend/src/components/SessionDropdown.vue
touch packages/core/admin/frontend/src/components/SessionHistoryModal.vue

# Test
pnpm test:frontend
```

**Files to create:**
- `packages/core/admin/frontend/src/components/SessionDropdown.vue`
- `packages/core/admin/frontend/src/components/SessionHistoryModal.vue`
- `packages/core/admin/frontend/src/composables/useSessionSync.ts`

**Files to modify:**
- `packages/core/admin/frontend/src/pages/ChatPage.vue`

### Phase 6: Multi-Tab Sync (1 hour)

**Tasks:**
- [ ] Implement BroadcastChannel for tab sync
- [ ] Add session change broadcasting
- [ ] Test multi-tab behavior

**Files to create:**
- `packages/core/admin/frontend/src/composables/useSessionSync.ts`

### Phase 7: Testing & Documentation (2 hours)

**Tasks:**
- [ ] Write integration tests
- [ ] Write E2E tests
- [ ] Update README
- [ ] Finalize ADR document

**Commands:**
```bash
# Run all tests
pnpm test

# Run E2E tests
pnpm test:e2e

# Generate coverage
pnpm test:coverage
```

## 📝 Database Migration

### SQL Migration Script

Create `migrations/005_webchat_session_metadata.sql`:

```sql
-- Add session metadata columns
ALTER TABLE public.sessions 
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create index for active sessions query
CREATE INDEX IF NOT EXISTS idx_sessions_active 
ON public.sessions(channel, is_archived, last_activity) 
WHERE is_archived = false;

-- Create index for archived sessions query
CREATE INDEX IF NOT EXISTS idx_sessions_archived 
ON public.sessions(channel, is_archived, updated_at) 
WHERE is_archived = true;

-- Update last_activity for existing sessions
UPDATE public.sessions 
SET last_activity = updated_at 
WHERE last_activity IS NULL;
```

### Run Migration

```bash
# Development
psql $DATABASE_URL -f migrations/005_webchat_session_metadata.sql

# Production (use your migration tool)
# e.g., flyway, liquibase, or custom script
```

## 🧪 Testing

### Unit Tests

```bash
# Test session store
pnpm test packages/core/gateway/src/state-layer/sessions

# Test RPC service
pnpm test packages/core/admin/src/rpc

# Test frontend components
pnpm test:frontend
```

### Integration Tests

```bash
# Test full RPC flow
pnpm test:integration packages/core/admin

# Test with live NATS
NATS_URL=nats://localhost:4222 pnpm test:integration
```

### E2E Tests

```bash
# Test user flows
pnpm test:e2e --grep "web chat"
```

## 🐛 Debugging

### Check NATS Connection

```bash
# Test NATS connectivity
nats-cli pub test.subject "Hello NATS"

# Subscribe to webchat topics
nats-cli sub "nachos.webchat.>"
```

### Check Database

```bash
# Connect to PostgreSQL
psql $DATABASE_URL

# Check sessions table
SELECT id, channel, is_pinned, is_archived, last_activity 
FROM sessions 
ORDER BY last_activity DESC 
LIMIT 10;
```

### Check Logs

```bash
# Admin service logs
docker logs nachos-admin -f

# Gateway logs
docker logs nachos-gateway -f

# NATS logs
docker logs nachos-nats -f
```

## 🔧 Development Tips

### Hot Reload

```bash
# Frontend hot reload
cd packages/core/admin/frontend
pnpm dev

# Backend watch mode
cd packages/core/admin
pnpm dev
```

### Mock RPC Responses

For frontend development, mock RPC responses:

```typescript
// packages/core/admin/frontend/src/api/webchat.ts
const MOCK_MODE = import.meta.env.VITE_MOCK_API === 'true';

export const listActiveSessions = async () => {
  if (MOCK_MODE) {
    return {
      sessions: [
        { id: '1', name: 'Test Session', lastActivity: '2026-02-26T12:00:00Z', messageCount: 5, isPinned: false },
      ],
    };
  }
  return request<{ sessions: ActiveSession[] }>('/api/webchat/sessions/active');
};
```

### Local NATS Setup

```bash
# Start NATS server
docker run -d --name nats -p 4222:4222 nats:latest

# Or use existing docker-compose
docker-compose up -d nats
```

## 📚 Reference

### RPC Topic Format

```
nachos.webchat.sessions.{action}
nachos.webchat.messages.{sessionId}
```

### HTTP Endpoints

```
GET    /api/webchat/sessions/active
GET    /api/webchat/sessions/archived?search=query
POST   /api/webchat/sessions/create
POST   /api/webchat/sessions/:id/archive
POST   /api/webchat/sessions/:id/restore
DELETE /api/webchat/sessions/:id
POST   /api/webchat/sessions/:id/pin
POST   /api/webchat/messages/send
GET    /api/webchat/messages/stream/:sessionId (SSE)
```

### Environment Variables

```bash
# .env
NATS_URL=nats://localhost:4222
NATS_TOKEN=your_token_here
DATABASE_URL=postgresql://user:pass@localhost:5432/nachos
```

## ✅ Verification Checklist

After implementation, verify:

- [ ] Can create new session
- [ ] Can send and receive messages
- [ ] Messages appear in real-time
- [ ] Can switch between sessions
- [ ] Session dropdown shows active sessions
- [ ] Can archive a session
- [ ] Archived sessions appear in history
- [ ] Can restore archived session
- [ ] Can pin/unpin sessions
- [ ] Pinned sessions stay in active list
- [ ] Multi-tab session sync works
- [ ] All tests passing
- [ ] No console errors
- [ ] ADR document complete

## 🎉 Success!

Once all checkboxes are complete, you have successfully implemented the hybrid RPC-based web chat with session management!

## 📞 Support

- Technical questions: Check ADR document
- Implementation details: See WEBCHAT_IMPLEMENTATION_PLAN.md
- Bug reports: Create GitHub issue
