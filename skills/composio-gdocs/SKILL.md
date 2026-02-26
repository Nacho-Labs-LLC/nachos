---
name: composio-gdocs
description: Create, read, and edit Google Docs via Composio integration.
---

# Google Docs Integration via Composio

## Prerequisites

1. **Composio Account**: Sign up at [composio.dev](https://composio.dev)
2. **API Key**: Set `COMPOSIO_API_KEY` environment variable
3. **Enable in Config**: Add `"googledocs"` to `allowed_apps`

## Common Actions

### Create Document
```typescript
{
  "action": "GOOGLEDOCS_CREATE_A_DOCUMENT",
  "app": "googledocs",
  "params": {
    "title": "Project Proposal",
    "initial_text": "# Project Overview\n\nThis document outlines..."
  }
}
```

### Get Document
```typescript
{
  "action": "GOOGLEDOCS_GET_DOCUMENT_BY_ID",
  "app": "googledocs",
  "params": {
    "document_id": "doc123abc"
  }
}
```

## Available Actions

- GOOGLEDOCS_CREATE_A_DOCUMENT - Create new document with text
- GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN - Create from markdown
- GOOGLEDOCS_GET_DOCUMENT_BY_ID - Retrieve document content
- GOOGLEDOCS_INSERT_TEXT_INTO_DOCUMENT - Insert text at position
- GOOGLEDOCS_REPLACE_ALL_TEXT_IN_DOCUMENT - Find and replace
- GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN - Replace content with markdown
- GOOGLEDOCS_INSERT_TABLE_IN_GOOGLE_DOC - Create table

## See Also

- [Composio Google Docs Toolkit](https://composio.dev/toolkits/googledocs)
