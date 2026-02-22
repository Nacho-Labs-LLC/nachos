# Documentation Roadmap

**Date:** 2026-02-22  
**Status:** Track 4 Analysis  
**Goal:** Update docs for PR #85 features + establish consistent voice

---

## Current State

**Existing docs:**
- `README.md` (main project README)
- `packages/*/README.md` (per-package docs)
- API route files have JSDoc comments
- CLI commands have help text

**Quality:** ⭐⭐⭐☆☆ (3/5) - Functional but needs updates

---

## What Needs Documentation

### 1. New Features from PR #85

**Memory Tools:**
- `memory_search` tool usage
- `memory_get` tool usage  
- How to structure memory files (MEMORY.md, memory/YYYY-MM-DD.md)
- Best practices for memory organization
- Prompt gating rules (when to/not to use memory tools)

**System Prompt Builder:**
- How to use `SystemPromptBuilder` class
- Available prompt templates
- Creating custom templates
- Template frontmatter format
- Platform-specific hints

**Discord Status Reactions:**
- How to enable status emojis
- Custom emoji configuration
- Event bus integration (when completed)

**State Tools:**
- `user_profile` tool (newly enabled)
- `bootstrap` tool (newly enabled)
- When each tool is appropriate

### 2. Architecture Documentation

**High-level:**
- System architecture diagram
- Data flow (Channel → Bus → Gateway → LLM → Channel)
- Component responsibilities
- Security model (Cheese policy engine)

**For developers:**
- Adding a new channel adapter
- Adding a new tool
- Creating MCP tools
- Plugin architecture
- Testing strategies

### 3. Deployment & Operations

**Getting started:**
- Quick start (5 minutes to first message)
- Installation methods (Docker, npm, source)
- Configuration guide (nachos.toml)
- Environment variables reference

**Operations:**
- Monitoring and health checks
- Logging and debugging
- Backup and restore
- Scaling considerations
- Security hardening

### 4. User Guides

**For bot operators:**
- Configuring channels (Discord, Slack, etc.)
- Managing skills
- Memory management
- User profiles
- Audit log review

**For developers:**
- Writing custom skills
- Tool development
- MCP server integration
- Contributing guide

---

## Documentation Style Guide

### Voice & Tone

**Principles:**
- **Professional yet approachable** - Like a knowledgeable coworker, not a manual
- **Clear and concise** - No jargon unless necessary
- **Action-oriented** - Tell users what to DO, not just what things ARE
- **Honest about limitations** - Don't oversell, acknowledge known issues

**Examples:**

❌ **Too formal:**
> The Nachos framework provides a modular architecture for agentic AI orchestration, featuring a policy-driven security model and extensible tool ecosystem.

✅ **Better:**
> Nachos is a platform for running AI agents that can use tools, remember context, and talk on multiple channels. It's modular—add only what you need.

❌ **Too casual:**
> Yo, wanna spin up a bot? Just run `nachos up` and you're good fam! 🔥

✅ **Better:**
> To start your bot, run `nachos up`. The stack will be ready in about 30 seconds.

### Structure

**Every doc should have:**
1. **One-sentence summary** at the top
2. **Table of contents** (for docs >2 pages)
3. **Prerequisites** section (if applicable)
4. **Step-by-step examples** with code blocks
5. **Common issues** / troubleshooting at the end
6. **Related links** to other docs

**Code blocks:**
```bash
# Use comments to explain non-obvious steps
nachos add discord  # Opens interactive setup

# Show expected output when helpful
$ nachos status
✓ gateway (running)
✓ llm-proxy (running)
```

**Diagrams:**
Use ASCII diagrams for simple flows, Mermaid for complex.

```
User Message
     ↓
Discord Adapter
     ↓
NATS Bus (message.inbound)
     ↓
Gateway
     ↓
LLM Proxy
     ↓
Anthropic API
     ↓
(reverse flow for response)
```

---

## Priority Documentation Tasks

### 🔴 Immediate (For PR)

1. **Update main README.md** (2 hours)
   - Add PR #85 features to feature list
   - Update quick start with memory example
   - Add architecture diagram
   - Link to new guides

2. **Memory Tools Guide** (2 hours)
   - `docs/guides/memory-tools.md`
   - How to use memory_search and memory_get
   - File structure recommendations
   - Examples of good memory entries

3. **System Prompt Builder Guide** (1 hour)
   - `docs/guides/system-prompts.md`
   - How to use the prompt builder
   - Template examples
   - Creating custom templates

4. **Migration Guide for PR #85** (1 hour)
   - `docs/migration/pr-85-memory-tools.md`
   - Breaking changes (if any)
   - New configuration options
   - Upgrade steps

### 🟡 Short-term (Next 2 weeks)

5. **Architecture Documentation** (4 hours)
   - `docs/architecture/overview.md`
   - Component diagram
   - Data flow diagrams
   - Security model

6. **Deployment Guide** (3 hours)
   - `docs/guides/deployment.md`
   - Docker Compose setup
   - Environment variables
   - Production checklist

7. **Channel Setup Guides** (4 hours)
   - `docs/channels/discord.md`
   - `docs/channels/slack.md`
   - `docs/channels/telegram.md`
   - Step-by-step with screenshots

8. **Tool Development Guide** (3 hours)
   - `docs/development/custom-tools.md`
   - Tool schema design
   - Execution handlers
   - Testing tools

### 🟢 Long-term (Nice-to-have)

9. **API Reference** (auto-generated, 2 hours)
   - TypeDoc for TypeScript packages
   - OpenAPI spec for HTTP APIs
   - MCP tool schemas

10. **Video Tutorials** (8 hours)
    - Quick start (5 min)
    - Adding a Discord bot (10 min)
    - Custom tool development (15 min)

11. **Interactive Docs Site** (16 hours)
    - VitePress or Docusaurus
    - Search functionality
    - Code playground
    - Community examples

---

## Documentation Structure (Proposed)

```
docs/
├── README.md                    # Overview + navigation
├── getting-started/
│   ├── quick-start.md          # 5-minute tutorial
│   ├── installation.md
│   └── configuration.md
├── guides/
│   ├── memory-tools.md         # NEW
│   ├── system-prompts.md       # NEW
│   ├── deployment.md
│   ├── skills.md
│   └── security.md
├── channels/
│   ├── discord.md
│   ├── slack.md
│   ├── telegram.md
│   └── whatsapp.md
├── tools/
│   ├── overview.md
│   ├── filesystem.md
│   ├── web-search.md
│   └── custom-tools.md
├── development/
│   ├── architecture.md
│   ├── contributing.md
│   ├── custom-channels.md
│   ├── custom-tools.md
│   └── testing.md
├── migration/
│   ├── pr-85-memory-tools.md   # NEW
│   └── version-1-to-2.md
└── api/
    ├── gateway-api.md
    ├── state-layer.md
    └── tool-schemas.md
```

---

## Style Consistency Checklist

For every doc page:

- [ ] One-sentence summary at top
- [ ] Table of contents (if >500 words)
- [ ] Code examples with comments
- [ ] Expected output shown for CLI commands
- [ ] "What's next?" section at end with links
- [ ] Consistent heading levels (# → ## → ###)
- [ ] No broken internal links
- [ ] All code blocks specify language
- [ ] Screenshots compressed (<200KB each)

---

## Estimated Effort

| Priority | Hours |
|----------|-------|
| Immediate (for PR) | 6h |
| Short-term | 14h |
| Long-term | 26h |
| **Total** | **46h** |

**Recommended approach:**
- Include immediate tasks in PR #85 follow-up
- Schedule short-term for next sprint
- Long-term is ongoing

---

## Success Metrics

How we'll know docs are good:

1. **New users can start in <10 minutes** (measured by onboarding time)
2. **<20% of support questions are about things documented** (track support channels)
3. **Docs have <5% broken links** (automated link checker)
4. **Positive feedback** ("docs were helpful" in surveys)

---

## Related Work

This documentation work complements:
- **Track 2 (Admin UI)** - Admin UI will link to docs
- **Track 3 (CLI)** - CLI help text should reference full docs
- **Track 5 (Design)** - Docs site will use design system

---

## Next Steps

1. Create `docs/` directory structure
2. Write immediate priority docs (memory tools, system prompts)
3. Update main README.md
4. Add to PR #85 follow-up
5. Review with nebula before merging
