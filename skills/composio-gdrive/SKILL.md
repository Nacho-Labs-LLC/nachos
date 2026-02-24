---
name: composio-gdrive
description: Upload, download, search, share, and manage files in Google Drive via Composio.
---

# Google Drive Integration via Composio

## Prerequisites

1. **Composio Account**: Sign up at [composio.dev](https://composio.dev)
2. **API Key**: Set `COMPOSIO_API_KEY` environment variable
3. **Enable in Config**: Add `"googledrive"` to `allowed_apps`

## Common Actions

### Upload File
```typescript
{
  "action": "GOOGLEDRIVE_UPLOAD_FILE",
  "app": "googledrive",
  "params": {
    "name": "document.pdf",
    "content": "base64EncodedContent==",
    "mimeType": "application/pdf"
  }
}
```

### Search Files
```typescript
{
  "action": "GOOGLEDRIVE_FIND_FILE",
  "app": "googledrive",
  "params": {
    "query": "name contains 'report'",
    "pageSize": 10
  }
}
```

## Available Actions

- GOOGLEDRIVE_UPLOAD_FILE - Upload file (max 5MB)
- GOOGLEDRIVE_CREATE_A_FILE_FROM_TEXT - Create text file
- GOOGLEDRIVE_DOWNLOAD_A_FILE_FROM_GOOGLE_DRIVE - Download file
- GOOGLEDRIVE_FIND_FILE - Search with query
- GOOGLEDRIVE_CREATE_A_FOLDER - Create new folder
- GOOGLEDRIVE_MOVE_FILE - Move file to folder
- GOOGLEDRIVE_ADD_FILE_SHARING_PREFERENCE - Share file/folder
- GOOGLEDRIVE_DELETE_FOLDER_OR_FILE - Delete file/folder

## See Also

- [Composio Google Drive Toolkit](https://composio.dev/toolkits/googledrive)
