---
name: figma
description:
  Figma API integration for design files, prototypes, and collaboration. Use
  when working with Figma designs, extracting assets, checking file metadata,
  getting component information, exporting images, or collaborating on designs.
  Supports file access, node inspection, image exports, comments, and version
  management.
---

# Figma API Integration

Interact with Figma design files programmatically for asset extraction, design
inspection, collaboration, and automation.

## When to Use

- **File operations**: Get file metadata, inspect designs, export assets
- **Asset extraction**: Download images, export design tokens, get icons
- **Collaboration**: Read/post comments, check version history
- **Automation**: Extract design specs, generate code from designs
- **Integration**: Connect designs to development workflows

## Authentication

### Setup

1. Get your Figma personal access token:
   - Go to https://www.figma.com/settings
   - Navigate to "Personal Access Tokens"
   - Click "Create new token"
   - Copy the token (it's shown only once)

2. Set environment variable:
   ```bash
   export FIGMA_ACCESS_TOKEN="figd_your_token_here"
   ```

### API Base URL

```
https://api.figma.com/v1
```

All requests require header:

```
X-Figma-Token: {your_token}
```

## Common Workflows

### 1. Get File Information

Retrieve complete file structure and metadata:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}"
```

**File Key**: Extract from Figma URL:
`https://www.figma.com/file/{FILE_KEY}/{file_name}`

**Response includes**:

- `name`: File name
- `lastModified`: Last modification timestamp
- `thumbnailUrl`: File thumbnail
- `document`: Complete node tree
- `components`: Component library
- `styles`: Design tokens/styles

### 2. Get Specific Nodes

Fetch specific frames or components:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}/nodes?ids=1:2,1:3"
```

**Node ID**: Extract from Figma URL:
`https://www.figma.com/file/{file_key}?node-id={NODE_ID}`

### 3. Export Images

Render and download design assets:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/{file_key}?ids=1:2&format=png&scale=2"
```

**Parameters**:

- `ids`: Comma-separated node IDs to export
- `format`: `png`, `jpg`, `svg`, `pdf`
- `scale`: 0.01 to 4 (for raster formats)
- `svg_outline_text`: `true` (default) or `false`

**Returns**: Map of node IDs to download URLs (expire after 30 days)

### 4. Get Comments

Read comments on a file:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}/comments"
```

### 5. Post Comment

Add a comment to a file:

```bash
curl -X POST \
  -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Great design!","client_meta":{"x":100,"y":200,"node_id":"1:2"}}' \
  "https://api.figma.com/v1/files/{file_key}/comments"
```

### 6. Get File Versions

List version history:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}/versions"
```

### 7. Get Team Projects

List projects in a team:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/teams/{team_id}/projects"
```

### 8. Get Project Files

List files in a project:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/projects/{project_id}/files"
```

## Key Endpoints

| Endpoint                         | Method | Purpose             |
| -------------------------------- | ------ | ------------------- |
| `/v1/files/:key`                 | GET    | Get complete file   |
| `/v1/files/:key/nodes`           | GET    | Get specific nodes  |
| `/v1/images/:key`                | GET    | Export images       |
| `/v1/files/:key/comments`        | GET    | Get comments        |
| `/v1/files/:key/comments`        | POST   | Post comment        |
| `/v1/files/:key/versions`        | GET    | Get version history |
| `/v1/teams/:team_id/projects`    | GET    | List team projects  |
| `/v1/projects/:project_id/files` | GET    | List project files  |
| `/v1/me`                         | GET    | Get current user    |

## Useful Queries

### Extract Design Tokens

Get all color and text styles:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}" | jq '.styles'
```

### Get Component Library

Extract all components:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}" | jq '.components'
```

### Export All Icons (SVG)

1. Get file structure to find icon frame
2. List all icon node IDs
3. Export as SVG:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/{file_key}?ids=1:2,1:3,1:4&format=svg&svg_include_id=true"
```

### Check File Metadata

Quick file info without full document:

```bash
curl -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/{file_key}/meta"
```

## Node Types

Common node types you'll encounter:

- `DOCUMENT`: Root node
- `CANVAS`: Top-level page
- `FRAME`: Container/frame
- `GROUP`: Grouped elements
- `VECTOR`: Vector shape
- `TEXT`: Text layer
- `RECTANGLE`, `ELLIPSE`, `LINE`: Basic shapes
- `COMPONENT`: Master component
- `INSTANCE`: Component instance
- `BOOLEAN_OPERATION`: Combined shapes

## Response Parsing

### File Structure

```json
{
  "name": "Design System",
  "lastModified": "2024-02-20T10:30:00Z",
  "document": {
    "type": "DOCUMENT",
    "children": [
      {
        "type": "CANVAS",
        "name": "Page 1",
        "children": [...]
      }
    ]
  },
  "components": {
    "1:2": {
      "name": "Button/Primary",
      "description": "Primary action button"
    }
  }
}
```

### Node Properties

Key properties on nodes:

- `id`: Unique node identifier
- `name`: Layer name
- `type`: Node type (see above)
- `children`: Child nodes
- `absoluteBoundingBox`: Position and size
- `fills`: Colors/gradients
- `strokes`: Borders
- `effects`: Shadows, blurs
- `characters`: Text content (TEXT nodes)

## Tips & Best Practices

### Rate Limits

- **Standard**: 60 requests per minute
- **Burst**: Up to 120 requests in short bursts
- Use exponential backoff on 429 errors

### Performance

- Use `depth` parameter to limit tree traversal
- Use `ids` parameter to fetch specific nodes only
- Request `geometry=paths` only when needed (vector data is large)
- Cache file structure when possible

### File Keys vs Branch Keys

- **File Key**: Main file identifier
- **Branch Key**: Branch-specific identifier
- Use `branch_data=true` to get branch metadata

### Working with Large Files

1. Start with `/files/:key/meta` for metadata
2. Use `/files/:key?depth=1` for page list
3. Fetch specific pages with `/files/:key/nodes?ids=...`

### SVG Export Options

- `svg_outline_text=true`: Text as paths (exact visual match)
- `svg_outline_text=false`: Text as `<text>` elements (editable)
- `svg_include_id=true`: Add id attributes for layer names
- `svg_simplify_stroke=true`: Cleaner SVG output

## Common Use Cases

### Design → Dev Handoff

1. Get file structure
2. Export assets at correct scales (@1x, @2x, @3x)
3. Extract color/typography tokens
4. Generate component specs

### Asset Pipeline

1. Monitor file versions
2. Export changed assets automatically
3. Optimize images
4. Push to CDN/repository

### Design QA

1. Get file comments
2. Check for missing descriptions
3. Verify naming conventions
4. Validate component usage

### Documentation

1. Extract component library
2. Generate design system docs
3. Create changelog from versions
4. Link designs to code

## Error Handling

Common errors:

| Code | Meaning               | Solution                           |
| ---- | --------------------- | ---------------------------------- |
| 403  | Invalid/expired token | Check `FIGMA_ACCESS_TOKEN`         |
| 404  | File not found        | Verify file key and access         |
| 429  | Rate limit exceeded   | Implement backoff, reduce requests |
| 500  | Figma server error    | Retry with exponential backoff     |

## Integration Examples

### Extract Colors Script

```bash
#!/bin/bash
curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY" | \
  jq '.styles | to_entries[] | select(.value.styleType == "FILL") | {name: .value.name, key: .key}'
```

### Export Component Library

```bash
#!/bin/bash
curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY" | \
  jq '.components | to_entries[] | {name: .value.name, description: .value.description, id: .key}' > components.json
```

### Download All Images

```bash
#!/bin/bash
# Get file structure and extract all image node IDs
NODE_IDS=$(curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY" | \
  jq -r '[.. | select(.type? == "FRAME") | .id] | join(",")')

# Export images
curl -s -H "X-Figma-Token: $FIGMA_ACCESS_TOKEN" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$NODE_IDS&format=png&scale=2" | \
  jq '.images'
```

## Resources

- **Official Docs**: https://www.figma.com/developers/api
- **REST API Spec**: https://github.com/figma/rest-api-spec
- **Community Plugins**: https://www.figma.com/community/plugins
- **Status Page**: https://status.figma.com

## Troubleshooting

**Problem**: "File not found" error **Solution**: Ensure you have view access to
the file. Private files require explicit sharing.

**Problem**: Exported images missing **Solution**: Check if nodes are visible
and have non-zero size. Invisible or 0-size nodes can't render.

**Problem**: Rate limit errors **Solution**: Reduce request frequency. Consider
caching file structure and only fetching changes.

**Problem**: Large response times **Solution**: Use `depth` and `ids` parameters
to limit data. Avoid fetching entire large files.

---

**Pro tip**: Use Figma's webhooks (via plugins) for real-time updates instead of
polling the API.
