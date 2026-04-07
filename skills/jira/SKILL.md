---
name: jira
description:
  Jira Cloud REST API v3 integration for issue tracking, project management, and
  agile workflows. Use for creating/updating issues, searching tickets, managing
  sprints, tracking progress, handling comments, managing workflows, and
  automating project tasks. Supports issues, projects, boards, sprints,
  comments, transitions, and JQL queries.
---

# Jira Cloud API Integration

Interact with Jira programmatically for issue management, project tracking,
sprint planning, and workflow automation.

## When to Use

- **Issue management**: Create, update, search, assign issues
- **Project tracking**: Monitor progress, check sprint status
- **Workflow**: Transition issues, update status
- **Collaboration**: Add comments, @ mentions, watch issues
- **Reporting**: Generate reports, extract metrics, analyze velocity
- **Automation**: Bulk operations, integrate with CI/CD

## Authentication

### API Token (Recommended)

1. Generate API token:
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Click "Create API token"
   - Copy token (shown only once)

2. Set environment variables:

   ```bash
   export JIRA_EMAIL="your-email@company.com"
   export JIRA_API_TOKEN="your_token_here"
   export JIRA_DOMAIN="your-company.atlassian.net"
   ```

3. Use Basic Auth:

   ```bash
   # Encode credentials
   echo -n "email@company.com:api_token" | base64

   # Use in requests
   curl -H "Authorization: Basic {base64_credentials}" \
     "https://your-company.atlassian.net/rest/api/3/myself"
   ```

### API Base URL

```
https://{your-domain}.atlassian.net/rest/api/3
```

## Common Workflows

### 1. Search Issues (JQL)

Use Jira Query Language to find issues:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=assignee=currentUser()+AND+status=Open&fields=summary,status,assignee"
```

**Common JQL queries**:

- My open issues: `assignee = currentUser() AND status != Done`
- Sprint issues: `sprint = "Sprint 23"`
- Recent updates: `updated >= -7d`
- High priority bugs: `type = Bug AND priority = High`
- Unassigned: `assignee is EMPTY AND status != Done`

### 2. Get Issue Details

Fetch complete issue information:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123"
```

**Include specific fields**:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123?fields=summary,status,assignee,description,comment"
```

### 3. Create Issue

Create a new issue/ticket:

```bash
curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "project": {"key": "PROJ"},
      "summary": "Issue summary",
      "description": {
        "type": "doc",
        "version": 1,
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Issue description"
              }
            ]
          }
        ]
      },
      "issuetype": {"name": "Task"},
      "priority": {"name": "High"}
    }
  }' \
  "https://$JIRA_DOMAIN/rest/api/3/issue"
```

### 4. Update Issue

Update existing issue fields:

```bash
curl -X PUT \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "summary": "Updated summary",
      "assignee": {"accountId": "5b10ac8d82e05b22cc7d4ef5"}
    }
  }' \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123"
```

### 5. Transition Issue

Move issue through workflow (e.g., To Do → In Progress → Done):

```bash
# Get available transitions
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123/transitions"

# Perform transition
curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transition": {"id": "31"},
    "fields": {
      "resolution": {"name": "Done"}
    }
  }' \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123/transitions"
```

### 6. Add Comment

Post comment on an issue:

```bash
curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "body": {
      "type": "doc",
      "version": 1,
      "content": [
        {
          "type": "paragraph",
          "content": [
            {
              "type": "text",
              "text": "This is a comment"
            }
          ]
        }
      ]
    }
  }' \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123/comment"
```

### 7. Assign Issue

Assign issue to a user:

```bash
curl -X PUT \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId": "5b10ac8d82e05b22cc7d4ef5"}' \
  "https://$JIRA_DOMAIN/rest/api/3/issue/PROJ-123/assignee"
```

### 8. Get Board

Fetch board information:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/agile/1.0/board/42"
```

### 9. Get Active Sprint

Get current sprint for a board:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/agile/1.0/board/42/sprint?state=active"
```

### 10. Get Sprint Issues

List issues in a sprint:

```bash
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/agile/1.0/sprint/123/issue"
```

## Key Endpoints

| Endpoint                                   | Method | Purpose             |
| ------------------------------------------ | ------ | ------------------- |
| `/rest/api/3/search`                       | POST   | Search issues (JQL) |
| `/rest/api/3/issue/{issueKey}`             | GET    | Get issue           |
| `/rest/api/3/issue`                        | POST   | Create issue        |
| `/rest/api/3/issue/{issueKey}`             | PUT    | Update issue        |
| `/rest/api/3/issue/{issueKey}/transitions` | POST   | Transition issue    |
| `/rest/api/3/issue/{issueKey}/comment`     | POST   | Add comment         |
| `/rest/api/3/issue/{issueKey}/assignee`    | PUT    | Assign issue        |
| `/rest/api/3/myself`                       | GET    | Current user info   |
| `/rest/api/3/project`                      | GET    | List projects       |
| `/rest/agile/1.0/board`                    | GET    | List boards         |
| `/rest/agile/1.0/sprint/{id}/issue`        | GET    | Sprint issues       |

## JQL (Jira Query Language)

### Common Operators

- `=`: Equals
- `!=`: Not equals
- `>`, `<`, `>=`, `<=`: Comparison
- `IN`: Match any value in list
- `NOT IN`: Not in list
- `~`: Contains text
- `!~`: Does not contain text
- `IS EMPTY`: Field is empty
- `IS NOT EMPTY`: Field is not empty

### Common Fields

- `project`: Project key
- `type` / `issuetype`: Issue type
- `status`: Current status
- `priority`: Priority level
- `assignee`: Assigned user
- `reporter`: Issue creator
- `created`: Creation date
- `updated`: Last update
- `resolved`: Resolution date
- `sprint`: Sprint name
- `labels`: Issue labels
- `component`: Component name
- `fixVersion`: Target version

### Useful JQL Examples

**My tickets this sprint:**

```
assignee = currentUser() AND sprint in openSprints()
```

**Bugs needing triage:**

```
type = Bug AND status = "To Do" AND priority is EMPTY
```

**Recently updated high priority:**

```
priority in (High, Highest) AND updated >= -3d
```

**Blocked issues:**

```
status = Blocked OR labels = blocked
```

**Unassigned in current sprint:**

```
sprint in openSprints() AND assignee is EMPTY
```

**Overdue issues:**

```
duedate < now() AND status != Done
```

## Atlassian Document Format (ADF)

Jira uses ADF for rich text (descriptions, comments).

### Simple Text

```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "Simple text content"
        }
      ]
    }
  ]
}
```

### With Formatting

```json
{
  "type": "doc",
  "version": 1,
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "Bold text",
          "marks": [{ "type": "strong" }]
        },
        {
          "type": "text",
          "text": " and "
        },
        {
          "type": "text",
          "text": "italic text",
          "marks": [{ "type": "em" }]
        }
      ]
    }
  ]
}
```

### Mentions

```json
{
  "type": "mention",
  "attrs": {
    "id": "5b10ac8d82e05b22cc7d4ef5",
    "text": "@John Doe"
  }
}
```

### Code Block

```json
{
  "type": "codeBlock",
  "attrs": { "language": "javascript" },
  "content": [
    {
      "type": "text",
      "text": "console.log('hello');"
    }
  ]
}
```

## Common Use Cases

### Daily Standup Report

Get your updates since yesterday:

```bash
# Issues you worked on
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=assignee=currentUser()+AND+updated>=-1d&fields=summary,status"
```

### Sprint Planning

1. Get sprint capacity
2. List unassigned stories
3. Estimate and assign

```bash
# Unassigned stories in backlog
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=project=PROJ+AND+type=Story+AND+assignee+is+EMPTY+AND+status='To+Do'"
```

### Bug Triage

Identify and prioritize bugs:

```bash
# New bugs without priority
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=type=Bug+AND+priority+is+EMPTY+AND+status='To+Do'&fields=summary,reporter,created"
```

### Release Checklist

Track release progress:

```bash
# Issues for version
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=fixVersion='v2.0'+AND+status!=Done&fields=summary,status,assignee"
```

### Blocked Work

Find and resolve blockers:

```bash
# All blocked issues
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=status=Blocked+OR+labels=blocked&fields=summary,assignee,updated"
```

## Bulk Operations

### Bulk Create Issues

```bash
curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "issueUpdates": [
      {
        "fields": {
          "project": {"key": "PROJ"},
          "summary": "Issue 1",
          "issuetype": {"name": "Task"}
        }
      },
      {
        "fields": {
          "project": {"key": "PROJ"},
          "summary": "Issue 2",
          "issuetype": {"name": "Task"}
        }
      }
    ]
  }' \
  "https://$JIRA_DOMAIN/rest/api/3/issue/bulk"
```

### Bulk Update Issues

Use JQL to filter, then update:

```bash
# Get issues
ISSUES=$(curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=labels=needs-update&fields=key" | \
  jq -r '.issues[].key')

# Update each
for issue in $ISSUES; do
  curl -X PUT \
    -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"fields":{"labels":["updated"]}}' \
    "https://$JIRA_DOMAIN/rest/api/3/issue/$issue"
done
```

## Tips & Best Practices

### Rate Limits

- **Cloud**: No hard limit, but throttling applies
- **Recommendation**: Max 300 requests/minute
- Use pagination for large result sets
- Implement exponential backoff

### Pagination

```bash
# Paginate through results
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=project=PROJ&startAt=0&maxResults=50"
```

- `startAt`: Starting index (0-based)
- `maxResults`: Results per page (max 100)
- Check `total` in response

### Field Names

- Custom fields use IDs: `customfield_10000`
- Find field IDs: `/rest/api/3/field`
- Use field names in JQL: `"Epic Link" = PROJ-123`

### Account IDs

- Jira Cloud uses account IDs, not usernames
- Get your account ID: `/rest/api/3/myself`
- Search users: `/rest/api/3/user/search?query=email`

### Performance

- Request only needed fields: `?fields=summary,status`
- Use JQL filters to reduce dataset
- Cache frequently accessed data
- Use webhooks instead of polling

## Error Handling

| Code | Meaning           | Solution                               |
| ---- | ----------------- | -------------------------------------- |
| 400  | Bad request       | Check request body syntax              |
| 401  | Unauthorized      | Verify credentials, check token expiry |
| 403  | Forbidden         | Check permissions for resource         |
| 404  | Not found         | Verify issue key/project exists        |
| 429  | Too many requests | Implement rate limiting                |
| 500  | Server error      | Retry with exponential backoff         |

## Useful Scripts

### Create Issue from CLI

```bash
#!/bin/bash
SUMMARY="$1"
DESCRIPTION="$2"

curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"project\": {\"key\": \"PROJ\"},
      \"summary\": \"$SUMMARY\",
      \"description\": {
        \"type\": \"doc\",
        \"version\": 1,
        \"content\": [{
          \"type\": \"paragraph\",
          \"content\": [{\"type\": \"text\", \"text\": \"$DESCRIPTION\"}]
        }]
      },
      \"issuetype\": {\"name\": \"Task\"}
    }
  }" \
  "https://$JIRA_DOMAIN/rest/api/3/issue" | jq -r '.key'
```

### My Issues Today

```bash
#!/bin/bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/api/3/search?jql=assignee=currentUser()+AND+status!=Done&fields=summary,status" | \
  jq -r '.issues[] | "\(.key): \(.fields.summary) [\(.fields.status.name)]"'
```

### Sprint Velocity

```bash
#!/bin/bash
SPRINT_ID="$1"
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_DOMAIN/rest/agile/1.0/sprint/$SPRINT_ID/issue?fields=customfield_10016" | \
  jq '[.issues[].fields.customfield_10016 // 0] | add'
```

## Integration Examples

### CI/CD Integration

**Transition on deployment:**

```bash
# Get issue from commit message
ISSUE_KEY=$(git log -1 --pretty=%B | grep -oE '[A-Z]+-[0-9]+')

# Transition to Done
curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"transition":{"id":"31"}}' \
  "https://$JIRA_DOMAIN/rest/api/3/issue/$ISSUE_KEY/transitions"
```

### Slack → Jira

**Create issue from Slack message:**

```bash
curl -X POST \
  -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"project\": {\"key\": \"SUP\"},
      \"summary\": \"$SLACK_MESSAGE\",
      \"issuetype\": {\"name\": \"Bug\"}
    }
  }" \
  "https://$JIRA_DOMAIN/rest/api/3/issue"
```

## Resources

- **Official Docs**:
  https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- **JQL Reference**:
  https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/
- **ADF Spec**:
  https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
- **Status Page**: https://status.atlassian.com

## Troubleshooting

**Problem**: "Field does not exist" error **Solution**: Check field availability
for issue type. Use `/rest/api/3/issue/createmeta` to get valid fields.

**Problem**: Can't find custom field **Solution**: List all fields with
`/rest/api/3/field`. Custom fields use `customfield_XXXXX` format.

**Problem**: ADF format errors **Solution**: Use simple ADF structure. Test with
Jira's ADF builder or validate against spec.

**Problem**: Transitions not working **Solution**: Get valid transitions for
issue: `/rest/api/3/issue/{key}/transitions`. Use returned ID.

---

**Pro tip**: Use Jira Automation rules (in UI) for complex workflows. Reserve
API for integrations and bulk operations.
