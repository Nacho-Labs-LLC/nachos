---
name: composio-gmeet
description: Create meetings and manage Google Meet spaces via Composio integration.
---

# Google Meet Integration via Composio

## Prerequisites

1. **Composio Account**: Sign up at [composio.dev](https://composio.dev)
2. **API Key**: Set `COMPOSIO_API_KEY` environment variable
3. **Enable in Config**: Add `"googlemeet"` to `allowed_apps`

## Common Actions

### Create Meeting Space
```typescript
{
  "action": "GOOGLEMEET_CREATE_A_MEET",
  "app": "googlemeet",
  "params": {
    "config": {
      "accessType": "OPEN"
    }
  }
}
```

### List Conference Records
```typescript
{
  "action": "GOOGLEMEET_LIST_CONFERENCE_RECORDS",
  "app": "googlemeet",
  "params": {
    "pageSize": 10
  }
}
```

## Available Actions

- GOOGLEMEET_CREATE_A_MEET - Create new meeting space
- GOOGLEMEET_GET_MEET_DETAILS - Retrieve space details
- GOOGLEMEET_UPDATE_GOOGLE_MEET_SPACE - Update meeting configuration
- GOOGLEMEET_LIST_CONFERENCE_RECORDS - List past conferences
- GOOGLEMEET_GET_RECORDINGS_BY_CONFERENCE_RECORD_ID - Get meeting recordings
- GOOGLEMEET_LIST_PARTICIPANT_SESSIONS - List participants in conference

## See Also

- [Composio Google Meet Toolkit](https://composio.dev/toolkits/googlemeet)
