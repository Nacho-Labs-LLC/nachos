# Session: Full Project Audit — 2026-03-04

## Objective

Comprehensive audit of the Nachos project covering security, code quality, test
coverage, architecture, dependencies, and a feature comparison against OpenClaw.

## Audit Findings Summary

### Security (2 High, 6 Medium, 3 Low)

- **High**: Admin port bound to 0.0.0.0, webchat X-User-Id header trusted
- **Medium**: Symlink traversal in filesystem, missing SSRF IPv4-mapped IPv6,
  incomplete ReDoS, missing security headers, config PUT without semantic
  validation, no resource limits on core containers
- **Low**: Unauthenticated test services, unsanitized channelId, unbounded
  session map

### Code Quality (Grade: B+)

- Zero `any` types (ESLint enforcing)
- 43 bare `throw new Error` (34 migrated this session)
- 7 stale Phase 6 warnings (removed this session)
- 4 silent catch blocks in Telegram/NATS

### Test Coverage (Grade: D+ → improved)

- ~35 critical files had zero tests
- 4 security-critical files completely untested
- No coverage thresholds enforced

### Architecture (Grade: B+)

- Clean package DAG, no circular dependencies
- Gateway still 2,633 lines (god object)
- 4 utility methods duplicated between gateway and tool-executor
- Legacy state.ts/session.ts (1,026 lines) duplicating @nachos/state

### Dependencies (Grade: C+)

- LLM SDKs critically outdated (anthropic 0.32, openai v4)
- 7 duplicate package versions
- No license compliance checking

### Nachos vs OpenClaw

- OpenClaw: 14 channels, 55+ skills, voice/mobile, production-ready personal
  assistant
- Nachos: Better security defaults, architecture, context management — a
  platform for building assistants
- Biggest gaps: channel count, skill count, voice/mobile/companion apps

## Changes Made

### 1. LLM SDK Migration

- `@anthropic-ai/sdk` 0.32.1 → 0.78.0
- `openai` v4 (^4.83.0) → v6 (^6.25.0)
- `max_tokens` → `max_completion_tokens` in OpenAI adapter
- Eliminated dual openai v4/v6 installation
- TypeScript compiles clean

### 2. Symlink Traversal Fix (worktree — needs merge)

- `packages/tools/filesystem/src/path-validator.ts`: Added `fs.realpathSync()`
  resolution
- Fixed path separator boundary collision (`startsWith` prefix attack)
- 13 new tests covering symlink escape, nested symlinks, non-existent write
  targets
- All 50 filesystem tests pass

### 3. Security Fixes (6 items)

- `docker-compose.dev.yml`: Admin + gateway ports bound to 127.0.0.1, resource
  limits on gateway/llm-proxy/admin
- `admin/routes/webchat.ts`: X-User-Id replaced with SHA-256 hash of admin token
- `admin/server.ts`: Security headers middleware (CSP, X-Frame-Options,
  X-Content-Type-Options)
- `admin/routes/config.ts`: Semantic validation blocks permissive mode and DLP
  allow via API
- Both `ssrf-protection.ts` files: IPv4-mapped IPv6 patterns added

### 4. New Tests (188 tests)

- `coordinator.test.ts`: 46 tests (was 0) — tool dispatch, NATS execution,
  cache, security tiers
- `ssrf-protection.test.ts`: 55 tests (was 0) — private ranges, DNS rebinding,
  domain allowlist, edge cases
- `web-fetch-tools.test.ts`: 48 tests (was 0) — schema, SSRF, rate limiting,
  HTML parsing, redirects
- `tool-executor.test.ts`: +27 tests (12→39) — local dispatch, DLP edge cases,
  subagent policy, build definitions

### 5. Code Cleanup

- 34 bare `throw new Error` → NachosError factories across 16 files
- 7 stale Phase 6 "not yet implemented" warnings removed from compose-generator
- `@types/uuid` removed from 2 package.json files (uuid ships own types)
- `pino-pretty` moved from dependencies to devDependencies
- ESLint overrides added for CLI and admin frontend `no-console`

### 6. Architecture Cleanup

- 4 duplicated methods extracted to `gateway/src/utils/session-utils.ts`
- `ToolExecutorDeps` narrowed from 27 flat members to 5 grouped sub-interfaces
  (core, policy, audit, state, security)
- All ~123 `this.deps.X` references updated to `this.deps.category.X`
- TypeScript compiles clean

## Remaining Work

### Must Do (Next Session)

- [ ] Merge symlink fix worktree branch
- [ ] Verify full test suite passes with all changes together
- [ ] Run `pnpm install` after lockfile changes

### Should Do (Soon)

- [ ] Complete session storage migration (remove legacy state.ts/session.ts —
      1,026 lines)
- [ ] Add vitest coverage thresholds
- [ ] Add license compliance checking to CI
- [ ] Align vitest versions across workspace (v2 vs v3 split)
- [ ] Make AWS SDK a lazy import

### Backlog

- [ ] Admin routes — 7/10 still untested
- [ ] CLI commands — 5/24+ tested
- [ ] Further gateway decomposition (context commands, LLM request building)
- [ ] Further tool-executor decomposition (browser defs, memory tools, subagent
      tools)

## Methodology

- 6 parallel audit agents (security-engineer, general-purpose, system-architect)
- 6 parallel implementation agents with file-ownership scoping to avoid
  conflicts
- Risky items (SDK migration, symlink fix) ran in isolated git worktrees
- Safe items (security fixes, tests, cleanup, architecture) ran on main branch
  with explicit DO NOT TOUCH lists
