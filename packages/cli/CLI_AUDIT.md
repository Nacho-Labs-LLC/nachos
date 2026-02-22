# CLI Usability Audit

**Date:** 2026-02-22  
**Auditor:** Claw (Orchestrator)  
**Target:** Nachos CLI (`packages/cli`)

---

## Executive Summary

**Overall Quality:** ⭐⭐⭐⭐☆ (4/5) - Well-designed!

The Nachos CLI is **professional and well-structured**. It demonstrates:
- Modern CLI best practices (Commander.js)
- Consistent command patterns
- Good error handling with typed exceptions
- Support for both pretty output and JSON
- Docker integration for stack management

**Primary findings:**
1. ✅ **Strong architecture** - Commander.js, modular commands, good separation
2. ✅ **Output formatting** - Both human and machine-readable modes
3. ⚠️ **Help text could be richer** - Missing examples in most commands
4. ⚠️ **Autocomplete partial** - Completion command exists but no installation guide
5. 💡 **Missing convenience features** - Aliases, interactive modes, better discovery

**Recommendation:** Focus on discoverability, examples, and convenience features.

---

## Architecture Overview

```
packages/cli/
├── src/
│   ├── cli.ts              # Main program definition (Commander)
│   ├── index.ts            # Entry point
│   ├── commands/           # Command implementations
│   │   ├── auth/
│   │   ├── config/
│   │   ├── policy/
│   │   ├── add/
│   │   ├── doctor.ts
│   │   ├── status.ts
│   │   ├── up.ts
│   │   ├── down.ts
│   │   ├── logs.ts
│   │   ├── memory.ts
│   │   ├── user-profile.ts
│   │   └── ...
│   ├── core/               # Shared utilities
│   │   ├── docker-client.ts
│   │   ├── nats-client.ts
│   │   ├── state-layer.ts
│   │   ├── output.ts       # Pretty + JSON formatting
│   │   ├── config-discovery.ts
│   │   └── errors.ts       # Typed CLI exceptions
│   └── lib/
│       └── doctor/         # Health check framework
└── package.json
```

**Tech stack:**
- Commander.js (CLI framework)
- Chalk (colors)
- TypeScript
- TOML parser
- Docker SDK

---

## Command Categories

### 1. Stack Management
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos up` | Start stack | ⭐⭐⭐⭐☆ |
| `nachos down` | Stop stack | ⭐⭐⭐⭐☆ |
| `nachos restart` | Restart services | ⭐⭐⭐⭐☆ |
| `nachos status` | Show running services | ⭐⭐⭐⭐⭐ |
| `nachos logs` | Tail service logs | ⭐⭐⭐⭐☆ |

### 2. Configuration
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos init` | Initialize project | ⭐⭐⭐⭐☆ |
| `nachos config validate` | Validate TOML | ⭐⭐⭐⭐☆ |
| `nachos add <module>` | Add channel/tool | ⭐⭐⭐⭐☆ |
| `nachos remove <module>` | Remove module | ⭐⭐⭐⭐☆ |

### 3. State Management
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos memory <action>` | Manage memories | ⭐⭐⭐⭐☆ |
| `nachos user-profile <action>` | User profiles | ⭐⭐⭐⭐☆ |

### 4. Development
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos doctor` | Health checks | ⭐⭐⭐⭐⭐ |
| `nachos sandbox` | Test tool sandbox | ⭐⭐⭐⭐☆ |
| `nachos debug` | Debug tools | ⭐⭐⭐⭐☆ |

### 5. Authentication
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos auth setup-token` | Configure OAuth | ⭐⭐⭐⭐☆ |

### 6. Subagents
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos subagents <action>` | Manage subagents | ⭐⭐⭐⭐☆ |

### 7. UI
| Command | Description | Quality |
|---------|-------------|---------|
| `nachos ui` | Open admin UI | ⭐⭐⭐⭐☆ |

---

## Detailed Analysis

### ✅ Strengths

1. **Consistent command structure**
   ```bash
   nachos <noun> <verb> [options]
   nachos memory append-entry --kind preference --content "..."
   nachos config validate
   nachos doctor check-all
   ```

2. **Rich error handling**
   ```typescript
   // Typed errors with exit codes
   export class DockerNotAvailableError extends CLIError {
     constructor() {
       super(
         'Docker is not available or not running',
         'DOCKER_NOT_AVAILABLE',
         1,
         'Install Docker Desktop and ensure it is running.'
       );
     }
   }
   ```

3. **Flexible output modes**
   ```bash
   nachos status          # Pretty, colored output
   nachos status --json   # Machine-readable JSON
   nachos status --quiet  # Minimal output
   ```

4. **Good help system**
   ```bash
   nachos --help
   nachos config --help
   nachos memory --help
   ```

5. **Global options**
   ```bash
   --json          # JSON output
   --verbose       # Debug logging
   --quiet         # Suppress non-essential
   --config <path> # Custom config location
   --no-input      # Non-interactive mode
   --no-color      # Disable colors
   ```

6. **Doctor command** - Comprehensive health checks
   - Docker availability
   - Compose version
   - Port conflicts
   - Config validation
   - Dependency versions
   - Disk space
   - Environment variables

---

### ⚠️ Issues & Gaps

#### 1. **Help Text Missing Examples**

**Current:**
```bash
$ nachos memory --help
Usage: nachos memory [options] <action>

Manage memory entries

Options:
  -h, --help  display help for command
```

**Better:**
```bash
$ nachos memory --help
Usage: nachos memory [options] <action>

Manage memory entries and facts

Actions:
  append-entry      Add a new memory entry
  append-facts      Add memory facts (RDF triples)
  query             Search memory
  delete-entry      Remove a memory entry

Examples:
  # Add a preference
  nachos memory append-entry \\
    --agent-id my-bot \\
    --kind preference \\
    --content "User loves breakfast tacos"

  # Search memories
  nachos memory query \\
    --agent-id my-bot \\
    --text "breakfast" \\
    --limit 5

  # Add a fact
  nachos memory append-facts \\
    --agent-id my-bot \\
    --subject "User" \\
    --predicate "prefers" \\
    --object "tacos"

Options:
  -h, --help  display help for command

See also: nachos user-profile, nachos config
```

**Recommendation:** Add `.addHelpText('after', EXAMPLES)` to every command.

---

#### 2. **No Command Aliases**

**Missing convenient shortcuts:**
```bash
nachos s      # → status
nachos l      # → logs
nachos r      # → restart
nachos d      # → down
nachos cfg    # → config
nachos mem    # → memory
```

**Implementation:**
```typescript
program
  .command('status')
  .alias('s')
  .description('Show stack status')
  .action(statusCommand);
```

---

#### 3. **Autocomplete Not Documented**

**Current state:**
- `nachos completion` command exists
- Generates shell completion scripts
- BUT: No installation instructions in README or help

**Recommendation:**
```bash
$ nachos completion --help
Usage: nachos completion [shell]

Generate shell completion scripts

Shells:
  bash   Bash completion (Linux, macOS)
  zsh    Zsh completion (macOS default, Linux)
  fish   Fish shell completion

Installation:
  # Bash (Linux)
  nachos completion bash | sudo tee /etc/bash_completion.d/nachos

  # Bash (macOS with Homebrew)
  nachos completion bash > $(brew --prefix)/etc/bash_completion.d/nachos

  # Zsh
  nachos completion zsh > ~/.zsh/completion/_nachos
  echo 'fpath=(~/.zsh/completion $fpath)' >> ~/.zshrc

  # Fish
  nachos completion fish > ~/.config/fish/completions/nachos.fish

Then restart your shell or run: source ~/.bashrc

Examples:
  nachos completion zsh > ~/.zsh/completion/_nachos
```

---

#### 4. **Interactive Prompts Limited**

**Current:**
- `nachos init` asks basic questions
- `nachos add <module>` is CLI-only (no interactive selection)
- No guided wizards for complex tasks

**Recommendation:** Add interactive modes for common tasks

```bash
$ nachos add --interactive
? What would you like to add?
  ❯ Channel (Discord, Slack, Telegram...)
    Tool (filesystem, web-search, browser...)
    Skill (custom capabilities)
    LLM Provider (Anthropic, OpenAI...)

? Which channel?
  ❯ Discord
    Slack
    Telegram
    WhatsApp

? Enter your Discord bot token: ••••••••••••••••
✓ Discord channel configured!
✓ Added to nachos.toml
✓ Run 'nachos restart' to apply changes
```

Use `inquirer` or `prompts` library.

---

#### 5. **Missing Commands**

| Missing | Why Useful |
|---------|------------|
| `nachos validate` | Shortcut for `nachos doctor` + `nachos config validate` + `nachos policy validate` all-in-one |
| `nachos shell` | Interactive REPL for testing commands |
| `nachos export` | Export config/state for backup or migration |
| `nachos import` | Import exported data |
| `nachos version --check` | Check for CLI updates |
| `nachos open <service>` | Open admin/webchat/logs in browser |

---

#### 6. **Output Formatting Inconsistencies**

**Some commands use different styles:**

```bash
# status.ts uses prettyOutput
prettyOutput.brandedHeader('Nachos Status');
prettyOutput.header('Services:');
prettyOutput.keyValue('Gateway', url);

# doctor.ts uses custom formatting
console.log(chalk.cyan('\n🧀 Nachos Doctor'));
console.log(chalk.gray('━'.repeat(50)));

# logs.ts uses plain console.log
console.log(`[${container.Service}] ${line}`);
```

**Recommendation:** Standardize on `prettyOutput` utility everywhere.

---

#### 7. **No Progress Indicators**

**Long-running operations are silent:**

```bash
$ nachos up
Starting stack... (takes 30 seconds, no feedback)
✓ Stack started
```

**Better:**
```bash
$ nachos up
⠋ Pulling images...
⠙ Creating network...
⠹ Starting services...
  ✓ bus (nats)
  ✓ redis
  ✓ gateway
  ⠸ llm-proxy (waiting for health check)
✓ Stack started in 27s
```

Use `ora` or `cli-spinners` library.

---

#### 8. **Error Messages Could Be More Actionable**

**Current:**
```bash
Error: Config file not found: /path/to/nachos.toml
```

**Better:**
```bash
Error: Config file not found: /path/to/nachos.toml

Possible solutions:
  1. Run 'nachos init' to create a new configuration
  2. Specify a different location with --config <path>
  3. Check that you're in the project root directory

Current directory: /Users/nebula/projects
Looking for: nachos.toml, .nachos/config.toml, ~/.nachos/config.toml
```

---

## Prioritized Improvements

### 🔴 High Priority (Usability)

1. **Add examples to all help text** (4 hours)
   - Every command should show 2-3 usage examples
   - Common patterns documented

2. **Command aliases** (1 hour)
   - `s` → `status`
   - `l` → `logs`
   - `r` → `restart`
   - `cfg` → `config`
   - `mem` → `memory`

3. **Better error messages** (2 hours)
   - Actionable suggestions
   - Show what the CLI looked for
   - Link to docs when appropriate

4. **Autocomplete installation guide** (1 hour)
   - Update `nachos completion --help`
   - Add to README

### 🟡 Medium Priority (Convenience)

5. **Interactive modes** (4 hours)
   - `nachos add --interactive`
   - `nachos init` improvements (more questions)
   - Guided setup wizard

6. **Progress indicators** (2 hours)
   - Spinners for long operations
   - Progress bars for multi-step tasks

7. **New convenience commands** (3 hours)
   - `nachos validate` (all-in-one health check)
   - `nachos open <service>` (open in browser)
   - `nachos shell` (interactive REPL)

8. **Standardize output formatting** (2 hours)
   - Use `prettyOutput` everywhere
   - Consistent color scheme
   - Consistent heading styles

### 🟢 Low Priority (Nice-to-Have)

9. **Config migrations** (3 hours)
   - `nachos migrate` to update old configs
   - Version detection

10. **Export/import** (2 hours)
    - Backup and restore functionality

11. **Update checker** (1 hour)
    - `nachos version --check`
    - Auto-notify on outdated version

12. **Man pages** (2 hours)
    - Generate man pages from Commander metadata

---

## Testing Recommendations

### Unit Tests
```typescript
// Example: test error handling
describe('statusCommand', () => {
  it('throws DockerNotAvailableError when Docker is not running', async () => {
    mockDockerClient.isDockerAvailable.mockResolvedValue(false);
    
    await expect(statusCommand({}))
      .rejects
      .toThrow(DockerNotAvailableError);
  });
  
  it('outputs JSON when --json flag is set', async () => {
    const consoleSpy = jest.spyOn(console, 'log');
    await statusCommand({ json: true });
    
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveProperty('containers');
  });
});
```

### Integration Tests
```bash
# Test actual CLI invocations
./dist/cli.js status --json | jq .
./dist/cli.js doctor --quiet
./dist/cli.js config validate
```

### Smoke Tests
```bash
# Quick sanity check before release
nachos --version
nachos --help
nachos status --json
nachos doctor --quiet
```

---

## Code Quality Notes

**Strengths:**
- ✅ TypeScript throughout
- ✅ Modular command structure
- ✅ Good error typing
- ✅ Shared utilities (output, docker, nats clients)
- ✅ Some unit tests exist (`memory.test.ts`, `user-profile.test.ts`)

**Issues:**
- ⚠️ Test coverage is sparse
- ⚠️ Some commands have no tests
- ⚠️ Mock implementations needed for Docker/NATS clients

**Recommendations:**
- Increase test coverage to >80%
- Add integration tests
- Mock external dependencies consistently

---

## Documentation Gaps

### README.md
Should include:
- **Installation** (npm, brew, binary)
- **Quick start** (init → up → status)
- **Common commands** with examples
- **Autocomplete setup**
- **Troubleshooting** guide

### Man Pages
Generate from Commander:
```bash
nachos completion man > /usr/local/share/man/man1/nachos.1
man nachos
```

### Command Reference
Auto-generate from `--help` output:
```bash
mkdir -p docs/cli
for cmd in $(nachos --help | grep '  [a-z]' | awk '{print $1}'); do
  nachos $cmd --help > docs/cli/$cmd.md
done
```

---

## Estimated Effort

| Category | Hours |
|----------|-------|
| High priority (usability) | 8h |
| Medium priority (convenience) | 11h |
| Low priority (nice-to-have) | 8h |
| Testing improvements | 6h |
| Documentation | 4h |
| **Total** | **37h** |

**Recommended approach:**
- Sprint 1 (8h): High priority (help, aliases, errors, autocomplete)
- Sprint 2 (11h): Medium priority (interactive modes, progress, new commands)
- Sprint 3 (optional): Low priority + docs

---

## Comparison: Nachos vs. Industry Leaders

### vs. Docker CLI
| Feature | Docker | Nachos |
|---------|--------|--------|
| Help text with examples | ✅ | ⚠️ Partial |
| Command aliases | ✅ | ❌ Missing |
| Progress indicators | ✅ | ❌ Missing |
| Auto-update check | ✅ | ❌ Missing |
| Man pages | ✅ | ❌ Missing |

### vs. GitHub CLI (gh)
| Feature | gh | Nachos |
|---------|-----|--------|
| Interactive modes | ✅ | ⚠️ Limited |
| Autocomplete | ✅ | ⚠️ Undocumented |
| JSON output | ✅ | ✅ |
| Extensions | ✅ | ❌ |
| Beautiful TUI | ✅ | ❌ |

### vs. Homebrew
| Feature | brew | Nachos |
|---------|------|--------|
| Doctor command | ✅ | ✅ |
| Rich analytics | ✅ | ❌ |
| Update notifier | ✅ | ❌ |
| Tap/plugin system | ✅ | ❌ |

---

## Conclusion

The Nachos CLI is **well-architected and production-ready**, but could benefit from improved **discoverability and convenience**. Key improvements:

1. **Help text with examples** - Critical for onboarding
2. **Command aliases** - Boost daily productivity
3. **Interactive modes** - Lower barrier to entry
4. **Better errors** - Reduce frustration

**No major refactoring needed.** Focus on polish and user experience. 🧀
