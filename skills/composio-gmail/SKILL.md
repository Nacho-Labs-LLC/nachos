---
name: composio-gmail
description:
  Send, read, search, and manage Gmail via Composio integration. Use when
  working with email operations.
---

# Gmail Integration via Composio

This skill enables AI agents to interact with Gmail through the Composio
platform, providing comprehensive email management capabilities.

## Prerequisites

1. **Composio Account**: Sign up at [composio.dev](https://composio.dev)
2. **API Key**: Set `COMPOSIO_API_KEY` environment variable
3. **Gmail Connection**: Connect your Gmail account via Composio dashboard
4. **Enable in Config**: Add to `nachos.toml`:
   ```toml
   [tools.composio]
   enabled = true
   api_key_env = "COMPOSIO_API_KEY"
   entity_id = "default"
   allowed_apps = ["gmail", ...]
   ```

## Common Actions

### Send Email

```typescript
{
  "action": "GMAIL_SEND_EMAIL",
  "app": "gmail",
  "params": {
    "to": "recipient@example.com",
    "subject": "Subject line",
    "body": "Email content",
    "is_html": false
  }
}
```

### Search Emails

```typescript
{
  "action": "GMAIL_FETCH_EMAILS",
  "app": "gmail",
  "params": {
    "query": "from:sender@example.com subject:important",
    "max_results": 10
  }
}
```

## Available Actions

- GMAIL_SEND_EMAIL - Send a new email
- GMAIL_FETCH_EMAILS - Search and fetch emails
- GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID - Get specific message
- GMAIL_CREATE_EMAIL_DRAFT - Create draft email
- GMAIL_SEND_DRAFT - Send existing draft
- GMAIL_LIST_GMAIL_LABELS - List labels
- GMAIL_CREATE_LABEL - Create new label
- GMAIL_MODIFY_EMAIL_LABELS - Add/remove labels from message
- GMAIL_REPLY_TO_EMAIL_THREAD - Reply within thread
- GMAIL_MOVE_TO_TRASH - Move message to trash

## Authentication

Gmail access uses OAuth 2.0 via Composio:

1. Navigate to Composio dashboard
2. Add Gmail integration
3. Click "Connect" and authorize
4. Composio handles token refresh automatically

## See Also

- [Composio Gmail Toolkit](https://composio.dev/toolkits/gmail)
- [Gmail API Search Syntax](https://support.google.com/mail/answer/7190)
