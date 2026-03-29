# Onboarding Customization

Nachos includes a built-in first-run onboarding flow that guides new users through setting up their assistant's identity, persona, and preferences. This guide explains how to customize or replace that flow.

## How the default onboarding works

On first boot, Nachos checks whether identity setup has been completed. If not, it injects a `BOOTSTRAP` block into the system prompt that instructs the LLM to run an interactive onboarding conversation.

The default flow asks the user four questions, one at a time:

1. **What should I call myself?** — Sets the assistant name and persona/vibe
2. **Who am I talking to?** — Sets the user's name, preferred address, and timezone
3. **What are my core values?** — Sets the soul (working style, tone, privacy preferences)
4. **Any tools or credentials to note?** — Seeds the TOOLS block with local context

When the user is done, the LLM calls `bootstrap(action: set, identityCompleted: true)` which saves all blocks and clears the bootstrap flow for future sessions.

---

## Customizing the onboarding prompt

### Option 1: Inline prompt in nachos.toml

Provide the full onboarding instructions directly in your config:

```toml
[assistant]
bootstrap_prompt = """
Welcome! I'm your new assistant. Let's get set up quickly.

What would you like to name me, and what should I call you?
After you tell me, I'll ask one more question about your preferences,
then we'll be ready to go.

When setup is complete, call bootstrap(action: set, identityCompleted: true).
"""
```

### Option 2: File path in nachos.toml

Store your onboarding prompt in a separate file for easier editing:

```toml
[assistant]
bootstrap_prompt = "./my-bootstrap.md"
```

The path is resolved relative to your `nachos.toml` file. Absolute paths are also accepted.

**Example `my-bootstrap.md`:**

```markdown
Welcome to AcmeCorp Assistant! I'm here to help your team.

Let's get set up. I'll ask a few quick questions:

1. What's your name and what should I call you?
2. What team are you on? (Engineering, Product, etc.)
3. Any tools or systems I should know about?

When done, call bootstrap(action: set, identityCompleted: true).
```

### Option 3: Skip interactive onboarding (ops/team deployments)

For automated deployments where you don't want interactive setup, write the identity, soul, user, and tools blocks directly into your state store at provisioning time and mark `identityCompleted: true`. This skips the onboarding conversation entirely.

This is the recommended approach for:
- Docker deployments with pre-configured personas
- Team environments where the assistant configuration is managed centrally
- CI/CD pipelines spinning up short-lived instances

---

## What the custom prompt should do

If you provide a custom bootstrap prompt, it replaces only the `BOOTSTRAP` block in the system prompt. The other blocks (AGENTS, SOUL, IDENTITY, USER, TOOLS) retain their default placeholder values.

Your custom prompt **must** instruct the LLM to:
1. Collect the information it needs from the user
2. Call `bootstrap(action: set, identityCompleted: true)` when setup is complete

The `bootstrap` tool call saves all block values and clears the bootstrap flow.

**Minimum viable custom prompt:**

```
Ask the user their name and how they want the assistant to behave.
When you have enough to proceed, call bootstrap(action: set, identityCompleted: true).
```

---

## Default bootstrap block reference

If you want to modify the default rather than replace it, here's what the default block guides the LLM to do:

- Greet the user and explain the setup flow
- Step 1: Ask for the assistant's name and persona/vibe → fills IDENTITY
- Step 2: Ask for the user's name, address, and timezone → fills USER
- Step 3: Ask for working style and tone preferences → fills SOUL
- Step 4: Ask for tools, credentials, or local conventions → fills TOOLS
- Complete: Call `bootstrap(action: set, identityCompleted: true)` with all blocks populated

---

## Nachos.toml example

```toml
[nachos]
name = "AcmeCorp Assistant"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"

[assistant]
name = "Acme Bot"
bootstrap_prompt = "./onboarding/acme-bootstrap.md"

[security]
mode = "standard"
```
