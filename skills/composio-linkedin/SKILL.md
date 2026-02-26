---
name: composio-linkedin
description: Post updates and manage LinkedIn via Composio integration.
---

# LinkedIn Integration via Composio

## Prerequisites

1. **Composio Account**: Sign up at [composio.dev](https://composio.dev)
2. **API Key**: Set `COMPOSIO_API_KEY` environment variable
3. **Enable in Config**: Add `"linkedin"` to `allowed_apps`

## Common Actions

### Create LinkedIn Post
```typescript
{
  "action": "LINKEDIN_CREATE_A_LINKEDIN_POST",
  "app": "linkedin",
  "params": {
    "text": "Excited to announce our new product launch! 🚀",
    "author": "urn:li:person:abc123"
  }
}
```

### Get Profile Info
```typescript
{
  "action": "LINKEDIN_GET_MY_INFO",
  "app": "linkedin",
  "params": {}
}
```

## Available Actions

- LINKEDIN_CREATE_A_LINKEDIN_POST - Create personal or company post
- LINKEDIN_DELETE_LINKEDIN_POST - Delete existing post
- LINKEDIN_GET_MY_INFO - Get authenticated user's profile
- LINKEDIN_GET_COMPANY_INFO - Get managed organizations/companies

## Best Practices

- Get author URN from `GET_MY_INFO` first
- Use `\n` for line breaks in posts
- Include relevant hashtags (#keyword)
- Post 1-2 times per day max for personal accounts

## See Also

- [Composio LinkedIn Toolkit](https://composio.dev/toolkits/linkedin)
