# Migration Guide

If you're moving to Nachos from a file-based assistant setup (OpenClaw, a custom
workspace, or any setup that uses markdown identity files), the `nachos migrate`
command lets you import your existing context directly — no interactive
bootstrap flow needed.

## What it imports

| Source File   | Bootstrap Block | Identity Field        |
| ------------- | --------------- | --------------------- |
| `SOUL.md`     | `soul`          | `soul` (required)     |
| `IDENTITY.md` | `identity`      | `identity` (required) |
| `USER.md`     | `user`          | `userProfile`         |
| `AGENTS.md`   | `agents`        | _(bootstrap only)_    |
| `TOOLS.md`    | `tools`         | `toolsNotes`          |

Files that don't exist in the source directory are silently skipped. **SOUL.md
and IDENTITY.md are required** — the command will refuse to mark identity as
completed without both.

## Usage

```bash
# Import from a workspace directory
nachos migrate --from ./workspace --agent-id my-bot

# Preview what would be imported without writing
nachos migrate --from ./workspace --agent-id my-bot --dry-run

# Overwrite an existing completed identity
nachos migrate --from ./workspace --agent-id my-bot --force
```

## What happens after migration

- All present files are written as bootstrap blocks under the given agent ID.
- The identity is marked as **completed** — the interactive bootstrap flow is
  skipped on the next gateway boot.
- You can verify the result with `nachos status` or by inspecting the state
  directory.

## Notes

- Migration works with both the **filesystem** and **postgres** state providers
  — it respects whatever is configured in `nachos.toml`.
- The `--force` flag is required if the agent already has a completed identity.
  Without it, the command exits with an error to protect existing context.
- Content is passed through the bootstrap sanitizer before storage (same
  protection as the interactive flow).
- `--agent-id` must match the `[nachos] name` value in your `nachos.toml` if you
  want the running gateway to pick it up automatically.

## Example: migrating an OpenClaw workspace

```bash
# Your existing OpenClaw workspace lives at ~/workspace
nachos migrate --from ~/workspace --agent-id claw --dry-run

# Looks good? Remove --dry-run to apply
nachos migrate --from ~/workspace --agent-id claw
```
