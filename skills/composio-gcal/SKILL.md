---
name: composio-gcal
description:
  Create, list, update, and manage Google Calendar events via Composio
  integration. Use for scheduling and calendar operations.
---

# Google Calendar Integration via Composio

This skill enables AI agents to interact with Google Calendar through the
Composio platform.

## Prerequisites

1. **Composio Account**: Sign up at [composio.dev](https://composio.dev)
2. **API Key**: Set `COMPOSIO_API_KEY` environment variable
3. **Calendar Connection**: Connect your Google account via Composio dashboard
4. **Enable in Config**: Add to `nachos.toml`:
   ```toml
   [tools.composio]
   enabled = true
   allowed_apps = ["googlecalendar", ...]
   ```

## Common Actions

### Create Event

```typescript
{
  "action": "GOOGLECALENDAR_CREATE_EVENT",
  "app": "googlecalendar",
  "params": {
    "calendar_id": "primary",
    "summary": "Team Meeting",
    "start": {"dateTime": "2026-03-01T10:00:00-05:00"},
    "end": {"dateTime": "2026-03-01T11:00:00-05:00"}
  }
}
```

### List Events

```typescript
{
  "action": "GOOGLECALENDAR_LIST_EVENTS",
  "app": "googlecalendar",
  "params": {
    "calendar_id": "primary",
    "timeMin": "2026-03-01T00:00:00Z",
    "timeMax": "2026-03-31T23:59:59Z"
  }
}
```

## Available Actions

- GOOGLECALENDAR_CREATE_EVENT - Create a new calendar event
- GOOGLECALENDAR_QUICK_ADD_EVENT - Parse natural language to create event
- GOOGLECALENDAR_LIST_EVENTS - List events in date range
- GOOGLECALENDAR_FIND_EVENT - Search events by query
- GOOGLECALENDAR_UPDATE_GOOGLE_EVENT - Full update of event
- GOOGLECALENDAR_DELETE_EVENT - Delete an event
- GOOGLECALENDAR_FIND_FREE_SLOTS - Find available time slots

## See Also

- [Composio Google Calendar Toolkit](https://composio.dev/toolkits/googlecalendar)
