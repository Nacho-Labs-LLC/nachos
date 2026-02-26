# WebChat Frontend Test Plan

## Overview
Test plan for the hybrid RPC-based web chat frontend implementation (Phases 4-7).

## Test Coverage

### Unit Tests

#### API Client (`src/api/webchat.ts`)
- ✓ **Session Management**
  - `listActiveSessions()` - returns active sessions
  - `listArchivedSessions()` - returns archived sessions with search
  - `createSession()` - creates new session and returns ID
  - `archiveSession()` - archives session by ID
  - `restoreSession()` - restores archived session
  - `deleteSession()` - permanently deletes session
  - `pinSession()` - pins/unpins session

- ✓ **Message Management**
  - `sendMessage()` - sends message to session
  - `getMessages()` - fetches paginated messages
  - `subscribeToMessages()` - returns subscription object

- ✓ **SSE Subscription**
  - Connection established
  - Messages received and parsed
  - Status events handled (thinking, tool, done, error)
  - Auto-reconnect with exponential backoff
  - Unsubscribe cleans up EventSource
  - Reconnect attempts are limited (max delay 8s)

#### Multi-Tab Sync (`src/utils/sync.ts`)
- ✓ **BroadcastChannel**
  - Channel initialized with correct name
  - Events broadcast to other tabs only (not self)
  - Handlers registered and invoked correctly
  - Subscription tracking prevents duplicates
  - Cleanup on unload

- ✓ **Event Types**
  - session-created
  - session-archived
  - session-restored
  - session-deleted
  - session-pinned
  - session-switched
  - session-list-updated

### Component Tests

#### SessionDropdown.vue
- ✓ **Rendering**
  - Shows current session name
  - Empty state when no session selected
  - Dropdown opens on click
  - Dropdown closes on outside click

- ✓ **Session List**
  - Lazy-loads sessions when dropdown opens
  - Shows pinned sessions first
  - Sorts by most recent activity
  - Displays message count and relative time
  - Pin button toggles state

- ✓ **Actions**
  - Selecting session emits `session-selected`
  - "New Session" button emits `new-session`
  - Pin/unpin sends API request

#### HistoryModal.vue
- ✓ **Rendering**
  - Modal opens/closes correctly
  - Search input filters sessions
  - Empty state when no archived sessions
  - Pagination controls visible when needed

- ✓ **Session Actions**
  - Restore button confirms and restores session
  - Delete button confirms and deletes permanently
  - Removed from list after action
  - Broadcasts sync events

- ✓ **Search & Pagination**
  - Search filters sessions by name
  - Pagination navigates pages correctly
  - Page info displays current/total pages

#### ChatPage.vue
- ✓ **Session Management**
  - Creates new session on first message
  - Switches sessions correctly
  - Archives current session
  - Handles session restoration

- ✓ **Message Display**
  - User messages align right
  - Assistant messages align left
  - Markdown rendered for assistant messages
  - Timestamps formatted correctly
  - Status indicators show (thinking, tool, done)

- ✓ **Message Input**
  - Enter sends message
  - Shift+Enter adds new line
  - Input disabled while loading
  - Optimistic update for user messages

- ✓ **Pagination**
  - "Load more" button when more messages exist
  - Scrolling to top triggers load
  - Older messages prepended correctly

- ✓ **Real-time**
  - Subscribes to active session
  - Unsubscribes when switching
  - Auto-reconnects on disconnect
  - Handles connection errors

- ✓ **Multi-Tab Sync**
  - Creates session broadcasts to other tabs
  - Archive in one tab clears in others
  - Restore updates all tabs
  - Subscription only in one tab per session

### Integration Tests

#### E2E Scenario: Complete User Flow
1. **Setup**: Clean database state
2. **Create Session**
   - Click "New Session"
   - Verify session created in dropdown
   - Verify empty message list
3. **Send Messages**
   - Type message and send
   - Verify user message appears
   - Verify assistant response arrives via SSE
   - Verify status indicators during processing
4. **Switch Sessions**
   - Create second session
   - Switch back to first session
   - Verify messages loaded correctly
   - Verify SSE reconnection
5. **Archive Session**
   - Click "Archive"
   - Verify session removed from dropdown
   - Verify session in history modal
6. **Restore Session**
   - Open history modal
   - Click restore
   - Verify session back in dropdown
   - Verify messages intact
7. **Cleanup**: Delete test sessions

#### Multi-Tab Scenario
1. **Setup**: Open two browser tabs
2. **Tab 1**: Create new session
3. **Tab 2**: Verify session appears in dropdown
4. **Tab 1**: Send message
5. **Tab 2**: Switch to that session
6. **Tab 1**: Archive session
7. **Tab 2**: Verify session cleared from UI
8. **Tab 1**: Restore session
9. **Tab 2**: Verify session reappears

### Manual Test Checklist

- [ ] Session dropdown lazy-loads on open
- [ ] Pin indicator shows correctly (📌)
- [ ] Relative timestamps update (just now, 5m ago, etc.)
- [ ] History modal search is case-insensitive
- [ ] Pagination buttons disable correctly
- [ ] Markdown rendering works (code blocks, lists, links)
- [ ] Status indicators animate (spinner)
- [ ] Input textarea grows with content
- [ ] Scroll position maintained on new messages
- [ ] SSE reconnects on network interruption
- [ ] Multi-tab sync doesn't duplicate messages
- [ ] Browser back/forward doesn't break state
- [ ] Mobile responsive (if applicable)

## Performance Tests

- [ ] **Large Message History**: Load session with 1000+ messages
- [ ] **Many Sessions**: 50+ active sessions in dropdown
- [ ] **Long Messages**: 10KB+ message rendering
- [ ] **Rapid Switching**: Switch between sessions quickly
- [ ] **Network Throttling**: Test reconnection behavior
- [ ] **Memory Leaks**: Open/close modal repeatedly

## Accessibility Tests

- [ ] Keyboard navigation (Tab, Enter, Escape)
- [ ] Screen reader compatibility
- [ ] Focus indicators visible
- [ ] ARIA labels present
- [ ] Color contrast meets WCAG AA

## Browser Compatibility

- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile browsers (if applicable)
- [ ] BroadcastChannel fallback (IE11 doesn't support)

## Known Limitations

1. **No Vitest setup**: Frontend unit tests require Vitest configuration
2. **No E2E framework**: Playwright/Cypress not configured
3. **User ID hardcoded**: Uses placeholder until auth is implemented
4. **No offline support**: Requires active backend connection
5. **BroadcastChannel**: Not supported in older browsers (no fallback)

## Next Steps

To implement these tests:

1. Add Vitest to `package.json`
2. Create `vitest.config.ts`
3. Add test files:
   - `src/api/webchat.test.ts`
   - `src/utils/sync.test.ts`
   - `src/components/__tests__/SessionDropdown.spec.ts`
   - `src/components/__tests__/HistoryModal.spec.ts`
   - `src/pages/__tests__/ChatPage.spec.ts`
4. Add Playwright for E2E tests
5. Run tests in CI/CD pipeline
