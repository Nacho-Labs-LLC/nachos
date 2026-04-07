# ADR-003: Skill Structure (SKILL.md Format)

## Status

Accepted (2026-02-24)

## Context

Nachos needs a way to provide the LLM with specialized knowledge for external
tools and APIs. We needed to decide how to structure, store, and inject this
knowledge.

### Options Considered

1. **Executable Code (Python/TypeScript modules)**
   - Pros: Type-safe, testable, runtime validation
   - Cons: Adds execution layer, security risk, version management complexity

2. **JSON Schema Only**
   - Pros: Machine-readable, validatable
   - Cons: Not human-readable, lacks examples/context, verbose

3. **Markdown Documentation (SKILL.md)**
   - Pros: Human-readable, example-rich, LLM-friendly, version-controlled
   - Cons: No runtime validation, requires LLM interpretation

4. **Hybrid (JSON + Markdown)**
   - Pros: Best of both worlds
   - Cons: Duplication, sync issues

## Decision

Use **Markdown Documentation (SKILL.md)** as the canonical skill format, with
optional metadata frontmatter.

### Structure

```markdown
---
name: skill-name
description: One-line summary for tool summaries
metadata:
  openclaw:
    emoji: 🔧
    requires: { bins: ['cli-tool'] }
    install: [...]
---

# Skill Name

Brief overview of what this skill enables.

## Authentication

[How to authenticate if needed]

## Common Operations

### Task 1

[Example with real code]

### Task 2

[Another example]

## Advanced Usage

[Complex scenarios]

## Troubleshooting

[Common errors and fixes]
```

### Injection

Skills are injected into the LLM system prompt at session start:

```
Your workspace contains the following skills:
- skill-name (emoji) — description
  Path: /workspace/skills/skill-name/SKILL.md

To use a skill, read its SKILL.md file for complete documentation.
```

The LLM then uses the `read` tool to load skill documentation on-demand.

## Consequences

### Positive

1. **LLM-Native**: Markdown is the best format for LLM comprehension
   - Rich examples with code blocks
   - Natural language explanations
   - Context and rationale included

2. **Human-Readable**: Same docs serve users and LLM
   - Single source of truth
   - Easy to review and maintain
   - Git-friendly (clean diffs)

3. **Version Control**: Skills evolve with codebase
   - Skills live in `/skills` directory
   - Tracked in git alongside code
   - PRs can update both code and skills

4. **No Execution Layer**: Documentation only, no runtime code
   - Security: Skills can't execute arbitrary code
   - Simplicity: No module loading, dependency hell
   - Portability: Works across any LLM/framework

5. **Extensible**: Users can add custom skills
   - Drop SKILL.md in `/workspace/skills/my-skill/`
   - Automatically discovered and loaded
   - No code changes required

### Negative

1. **No Type Safety**: LLM might misinterpret documentation
   - Mitigation: Include working examples that LLM can copy/modify
   - Mitigation: Skill tests validate examples (future)

2. **No Runtime Validation**: Can't enforce correct API usage
   - Example: LLM might use wrong Figma API endpoint
   - Mitigation: Tool execution still validated (e.g., HTTP errors caught)
   - Mitigation: Include common error patterns in docs

3. **Duplication Risk**: Same info might exist in OpenAPI specs, READMEs
   - Mitigation: SKILL.md is curated for LLM use, not comprehensive API docs
   - Mitigation: Link to authoritative docs rather than duplicate

4. **Discovery Overhead**: LLM must read file before use
   - Context tokens spent on skill loading
   - Mitigation: Skill summaries in system prompt (one-line descriptions)
   - Mitigation: Skills read on-demand, not all upfront

### Design Principles

**Skills are reference guides, not executable code**

- Think: cookbook, not library
- Provide working examples, not abstractions
- Include real-world scenarios, not just API reference

**Skills target LLM comprehension, not humans first**

- Optimize for copy-paste examples
- Include common error messages and fixes
- Provide context that LLM would otherwise need to infer

**Skills are curated, not comprehensive**

- 80/20 rule: Cover common use cases deeply
- Link to full API docs for edge cases
- Avoid overwhelming with every possible option

## Real-World Examples

### Good: Figma Skill (PR #113)

```markdown
## Get File Metadata

\`\`\`bash curl "https://api.figma.com/v1/files/FILE_KEY" \
 -H "X-Figma-Token: $FIGMA_TOKEN" \`\`\`

**Response**: \`\`\`json { "name": "My Design", "lastModified":
"2024-01-15T10:30:00Z", "thumbnailUrl": "https://...", "document": { ... } }
\`\`\`

**Common Error**:
```

403 Forbidden - Invalid token or insufficient permissions

```
→ Verify FIGMA_TOKEN has read access to this file.
```

**Why it works**:

- Complete working example
- Shows expected response structure
- Includes common error + fix
- LLM can copy/modify/execute

### Bad (Hypothetical)

```markdown
## API Reference

- `GET /v1/files/:key` — Retrieve file metadata
- Parameters: None
- Returns: File object
```

**Why it fails**:

- No working example
- No authentication shown
- No response structure
- No error handling

## Implementation Details

### Skill Discovery

```typescript
// Scan /workspace/skills/ for SKILL.md files
const skillPaths = await glob('/workspace/skills/*/SKILL.md');

// Parse frontmatter for metadata
const skills = skillPaths.map(parseSKILL);

// Inject into system prompt
const toolSummaries = skills
  .map((s) => `- ${s.name} (${s.emoji}) — ${s.description}`)
  .join('\n');
```

### On-Demand Loading

LLM decides when to load:

```
Human: "Search for coffee shops near me"
LLM: I'll use the goplaces skill for this.
     <read file=/workspace/skills/goplaces/SKILL.md>
     [Skill content loaded]
     <exec command="goplaces search 'coffee' --near 'current location'">
```

### Skill Testing (Future)

Skills should be testable:

```typescript
// Extract code blocks from SKILL.md
const examples = extractCodeBlocks(skillPath);

// Execute and verify they work
for (const ex of examples) {
  const result = await exec(ex.code);
  expect(result.exitCode).toBe(0);
}
```

## Alternatives Revisited

If skills need more structure:

1. **Add JSON Schema**: Validate frontmatter against schema
2. **Tool Definition Files**: Separate `.json` for API contracts
3. **Skill Tests**: Executable tests that verify examples work
4. **Skill Versioning**: Semantic versions in frontmatter

## Migration Path

Existing skills follow this pattern:

- `skills/figma/SKILL.md` ✅
- `skills/jira/SKILL.md` ✅
- `skills/github/SKILL.md` ✅
- `skills/openhue/SKILL.md` ✅

No migration needed — format established.

## References

- PR #113: Figma and Jira skills (exemplary format)
- `skills/figma/SKILL.md`: 385 lines, comprehensive API guide
- `skills/jira/SKILL.md`: 644 lines, includes ADF formatting examples
- Skill discovery: `packages/core/gateway/src/skills/loader.ts`
