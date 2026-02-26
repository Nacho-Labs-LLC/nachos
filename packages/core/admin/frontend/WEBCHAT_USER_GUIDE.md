# WebChat User Guide

## Overview

The Nachos WebChat provides a browser-based interface for conversing with your AI agent. It includes session management, message history, and real-time streaming.

## Features

### 🗂️ Session Management

**Active Sessions**
- Sessions active in the last 24 hours OR pinned
- Displayed in the session dropdown
- Sorted by: Pinned sessions first, then most recent activity

**Archived Sessions**
- Sessions older than 24 hours (unless pinned)
- Accessible via the "History" modal
- Can be restored to make them active again
- Can be permanently deleted

**Pinned Sessions**
- Stay in the active list regardless of age
- Marked with a 📌 icon
- Perfect for important ongoing conversations

### 💬 Real-Time Messaging

**Message Display**
- User messages appear on the right (blue)
- Assistant messages appear on the left (gray)
- System messages appear on the left (muted)
- Timestamps show when each message was sent

**Status Indicators**
- **Thinking...** - Assistant is processing your message
- **Using tool: [name]** - Assistant is using a tool
- **Done** - Processing complete

**Message Pagination**
- Click "Load older messages" to see earlier history
- Automatically loads when scrolling to top
- Prevents loading entire history at once (faster)

### 🔄 Multi-Tab Sync

Open the chat in multiple browser tabs:
- Creating a session in one tab updates all tabs
- Archiving in one tab clears it from others
- Only one real-time connection per session (efficient)

## How to Use

### Starting a New Conversation

1. Click **"New Session"** or select **Session Dropdown** → **"+ New"**
2. A new session is created with an auto-generated name
3. Type your message in the input box
4. Press **Enter** to send (or **Shift+Enter** for new line)

### Switching Sessions

1. Click the **Session Dropdown** (shows current session name)
2. Select a session from the list
3. Messages load automatically
4. Real-time updates begin

### Pinning a Session

1. Open the **Session Dropdown**
2. Click the **📌** icon next to a session
3. Pinned sessions stay in the active list forever
4. Click again to unpin

### Archiving a Session

1. Open the session you want to archive
2. Click **"Archive"** in the top-right
3. Confirm the action
4. Session moves to "History"

### Viewing History

1. Click **"📁 History"** in the top-right
2. Browse archived sessions
3. Use the search box to find specific conversations
4. Navigate with pagination buttons

### Restoring a Session

1. Open **"📁 History"**
2. Find the archived session
3. Click **"↺ Restore"** button
4. Confirm the action
5. Session returns to the active list

### Deleting a Session

⚠️ **Permanent action!**

1. Open **"📁 History"**
2. Find the session to delete
3. Click **"🗑️ Delete"** button
4. Confirm the action (cannot be undone)
5. Session and all messages are permanently deleted

## Keyboard Shortcuts

- **Enter** - Send message
- **Shift+Enter** - New line in message input
- **Esc** - Close history modal (when open)

## Tips & Best Practices

### Organization

- **Pin important sessions** to keep them easily accessible
- **Archive old sessions** to keep your active list clean
- **Use search** in history to find past conversations quickly

### Performance

- Message pagination prevents loading thousands of messages at once
- Only the active session has a real-time connection
- Multi-tab sync ensures efficient resource usage

### Multi-Tab Usage

- Open chat in multiple tabs for different workflows
- All tabs stay synchronized automatically
- Only one real-time stream per session (shared across tabs)

## Troubleshooting

### "Connection lost. Reconnecting..."

**Cause**: Network interruption or server restart

**Solution**:
1. Wait for automatic reconnection (max 8 seconds)
2. Click **"Reconnect"** button if shown
3. Check your internet connection

### Messages not appearing

**Possible causes**:
- Connection error (check for error banner)
- Not subscribed to correct session

**Solution**:
1. Switch to another session and back
2. Refresh the page if issue persists
3. Check browser console for errors

### Session not in dropdown

**Possible causes**:
- Session was archived
- Session is older than 24 hours and not pinned

**Solution**:
1. Check **"📁 History"** for archived sessions
2. Pin the session to keep it in the active list

### Can't send messages

**Possible causes**:
- No active session
- Input is empty or whitespace-only
- Connection error

**Solution**:
1. Create a new session or select an existing one
2. Type a message (not just spaces)
3. Check for connection errors at the top

## Technical Details

### Session Naming

Sessions are auto-generated with timestamps:
- Format: `"Session YYYY-MM-DD HH:MM"`
- Example: `"Session 2026-02-26 07:15"`

### Active Session Criteria

A session is "active" if:
- It has activity in the last 24 hours, OR
- It is pinned (📌)

### Message Pagination

- Default load: 50 most recent messages
- "Load more" fetches 50 older messages
- Scroll to top auto-loads more

### Real-Time Streaming

- Uses Server-Sent Events (SSE)
- Auto-reconnects on disconnect
- Exponential backoff: 1s → 2s → 4s → 8s

### Multi-Tab Sync

- Uses BroadcastChannel API
- Supported in modern browsers (Chrome, Firefox, Safari)
- Falls back gracefully if not supported

## Browser Compatibility

✅ **Fully Supported:**
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

⚠️ **Limited Support:**
- Older browsers: No multi-tab sync (BroadcastChannel)
- IE11: Not supported

## Privacy & Security

- Messages are stored in the database
- Sessions are isolated by user ID
- Multi-tab sync stays in your browser (never sent to server)
- Deleting a session permanently removes all data

## Support

For issues or feature requests:
1. Check the browser console for errors
2. Report issues to your Nachos administrator
3. Include browser version and error messages

---

**Version**: 1.0  
**Last Updated**: 2026-02-26  
**Component**: Nachos WebChat Frontend
