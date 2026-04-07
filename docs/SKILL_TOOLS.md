# Skill Tools Reference

Skills are Markdown documents (`SKILL.md`) that give Nachos specialized
knowledge for external tools, APIs, and services. They are discovered
automatically from the `/workspace/skills/` directory and referenced in the
system prompt.

> **Architecture note**: See [ADR-003](adr/003-skill-structure.md) for the full
> rationale behind the SKILL.md format.

---

## Available Skills

### Productivity & Communication

| Skill               | Directory                   | What It Enables                                     |
| ------------------- | --------------------------- | --------------------------------------------------- |
| `composio-gmail`    | `skills/composio-gmail/`    | Read, send, search, and organize Gmail via Composio |
| `composio-gcal`     | `skills/composio-gcal/`     | Create, read, and manage Google Calendar events     |
| `composio-gdrive`   | `skills/composio-gdrive/`   | Browse, read, and upload files in Google Drive      |
| `composio-gdocs`    | `skills/composio-gdocs/`    | Create and edit Google Docs                         |
| `composio-gmeet`    | `skills/composio-gmeet/`    | Schedule and manage Google Meet calls               |
| `composio-linkedin` | `skills/composio-linkedin/` | Post and read LinkedIn content (org/personal)       |
| `jira`              | `skills/jira/`              | Create, search, and update Jira issues and sprints  |

### Developer Tools

| Skill           | Directory               | What It Enables                                       |
| --------------- | ----------------------- | ----------------------------------------------------- |
| `figma`         | `skills/figma/`         | Fetch files, components, and design tokens from Figma |
| `agent-browser` | `skills/agent-browser/` | Control a headless browser for web automation         |

### Media & Data

| Skill       | Directory           | What It Enables                                       |
| ----------- | ------------------- | ----------------------------------------------------- |
| `gifgrep`   | `skills/gifgrep/`   | Search and retrieve GIFs                              |
| `gog`       | `skills/gog/`       | Search and retrieve information from GOG game library |
| `goplaces`  | `skills/goplaces/`  | Search for places, businesses, and local info         |
| `summarize` | `skills/summarize/` | Summarize long documents or web pages                 |

---

## How Skills Work

1. At startup, Nachos scans `/workspace/skills/*/SKILL.md` and extracts
   names/descriptions from frontmatter.
2. A summary of available skills is injected into the system prompt.
3. When a skill is needed, the LLM uses the `read` tool to load the full
   `SKILL.md` on-demand.
4. The skill doc provides working examples, auth details, and common error
   fixes.

**Skills are loaded on-demand** — only when the LLM decides it needs them. This
keeps context usage low.

---

## Installing a Skill

Skills are just directories with a `SKILL.md` file:

```bash
# Create skill directory
mkdir -p /workspace/skills/my-skill

# Add the SKILL.md
cat > /workspace/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: Brief description for tool summaries
---

# My Skill

What this skill does...

## Authentication

How to authenticate...

## Common Operations

### Example Operation

\`\`\`bash
# Working example here
\`\`\`
EOF
```

The skill is automatically discovered on next session start.

---

## Skill Format

See [ADR-003](adr/003-skill-structure.md) for the full format spec. Quick
reference:

```markdown
---
name: skill-name
description: One-line summary shown in tool listing
---

# Skill Name

Brief overview.

## Authentication

[Auth setup steps with concrete commands]

## Common Operations

### Task Name

[Working example with expected output]

## Troubleshooting

[Common errors + fixes]
```

**Principles:**

- Include working, copy-paste examples — not just API references
- Show expected response structure (JSON snippets help)
- Document common errors with fixes
- Link to full API docs for edge cases, don't try to replicate them

---

## Composio Skills

Most external service integrations use [Composio](https://composio.dev) for auth
management. Composio connection IDs are stored in the gateway config (or
`TOOLS.md` in agent workspaces).

To check available Composio connections:

```bash
# Via Composio CLI
composio apps connected
```

---

## Further Reading

- [ADR-003: Skill Structure](adr/003-skill-structure.md) — format rationale and
  design principles
- [Architecture Overview](architecture.md) — how skills fit into the Nachos
  stack
- [Creating Custom Modules](custom-modules.md) — build your own channels and
  tools
