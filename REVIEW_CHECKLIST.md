# Review Checklist: Modular Storage Architecture

Use this checklist to review the implementation.

## ✅ Code Quality

- [ ] **TypeScript Strict Mode**: All new files use strict TypeScript
- [ ] **Error Handling**: Proper try/catch blocks in async operations
- [ ] **Type Safety**: No `any` types (except in legacy interfaces)
- [ ] **Documentation**: All public methods have JSDoc comments
- [ ] **Naming Conventions**: Consistent with existing codebase
- [ ] **Code Formatting**: Matches project style (Prettier)

## ✅ Configuration

- [ ] **Schema Validation**: New config types added to `packages/shared/config/src/schema.ts`
- [ ] **Defaults**: Sensible defaults defined (sqlite, local)
- [ ] **Example Config**: `nachos.toml.example` updated with commented examples
- [ ] **Backwards Compatibility**: Existing configs still work
- [ ] **Config Loading**: `buildStateLayerConfig()` updated in `main.ts`

## ✅ Implementation

### PostgreSQL Sessions Store

- [ ] **File Created**: `packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.ts`
- [ ] **Full API**: Implements all SessionsStore interface methods
- [ ] **Connection Pooling**: Uses `pg.Pool` correctly
- [ ] **Transactions**: Atomic operations use BEGIN/COMMIT/ROLLBACK
- [ ] **Schema Creation**: Auto-creates tables if missing
- [ ] **Race Condition Safe**: `getOrCreateSessionAtomic()` uses SELECT FOR UPDATE
- [ ] **JSONB Handling**: Config/metadata stored as JSONB
- [ ] **Error Handling**: Proper error propagation

### Qdrant Memory Store

- [ ] **File Created**: `packages/core/gateway/src/state-layer/memory/qdrant-memory-store.ts`
- [ ] **MemoryStore Interface**: Implements all methods
- [ ] **HTTP Client**: Uses fetch() for Qdrant API
- [ ] **Collection Init**: Auto-creates collection with proper schema
- [ ] **Payload Indexes**: Creates indexes for filtering
- [ ] **Hybrid Search**: Supports vector + metadata filtering
- [ ] **Embedding Placeholder**: Documented as TODO

### Sessions Store Interface

- [ ] **File Created**: `packages/core/gateway/src/state-layer/sessions/sessions-store-interface.ts`
- [ ] **Complete Interface**: All methods from StateStorage included
- [ ] **Type Definitions**: CreateSessionData, UpdateSessionData, CreateMessageData
- [ ] **Sync/Async Support**: Union types support both patterns

## ✅ Tests

### Postgres Tests

- [ ] **File Created**: `postgres-sessions-store.test.ts`
- [ ] **Test Coverage**: 11 comprehensive test cases
- [ ] **Environment Check**: Skips if POSTGRES_TEST_URL not set
- [ ] **Cleanup**: beforeEach/afterAll cleanup hooks
- [ ] **Concurrent Safety**: Tests race conditions
- [ ] **All CRUD**: Tests all operations (create, read, update, delete)
- [ ] **Edge Cases**: Tests filtering, pagination, JSONB, etc.

### Test Execution

- [ ] **Run Tests**: `pnpm test -- postgres-sessions-store.test.ts` passes
- [ ] **No Console Errors**: No unexpected warnings or errors
- [ ] **Schema Cleanup**: Test schema dropped after run

## ✅ Documentation

### ADR (Architecture Decision Record)

- [ ] **File Created**: `docs/architecture/decisions/005-modular-storage-backends.md`
- [ ] **Complete Sections**: Context, Decision, Architecture, When to Use, Performance, Migration, Consequences
- [ ] **Tables**: Comparison tables for SQLite vs Postgres, Local vs Qdrant
- [ ] **Migration Guide**: Step-by-step migration instructions
- [ ] **References**: Links to external documentation
- [ ] **Status**: Marked as "Accepted" with date

### Developer README

- [ ] **File Created**: `state-layer/sessions/README.md`
- [ ] **Architecture Diagram**: Clear overview of storage layer
- [ ] **API Reference**: Documents all interface methods
- [ ] **Configuration Examples**: Both SQLite and Postgres
- [ ] **Schema Documentation**: SQL schema for both backends
- [ ] **Testing Instructions**: How to run tests
- [ ] **Future Work**: Lists pending tasks

### Quick Start Guide

- [ ] **File Created**: `state-layer/sessions/QUICKSTART.md`
- [ ] **Prerequisites**: Clear requirements (Docker, Node, etc.)
- [ ] **Step-by-Step**: Numbered steps from setup to cleanup
- [ ] **Docker Commands**: Copy-paste ready
- [ ] **Troubleshooting**: Common issues documented
- [ ] **Manual Testing**: Code examples provided

### Implementation Summary

- [ ] **File Created**: `MODULAR_STORAGE_IMPLEMENTATION.md`
- [ ] **Status Overview**: Clear summary of what's done vs pending
- [ ] **Success Criteria**: Each criterion evaluated
- [ ] **Files Listed**: All created/modified files documented
- [ ] **Next Steps**: Roadmap for completion

### Completion Summary

- [ ] **File Created**: `IMPLEMENTATION_COMPLETE.md`
- [ ] **Deliverables**: All deliverables listed with evidence
- [ ] **Success Criteria Table**: Visual status overview
- [ ] **Usage Instructions**: How to use each component
- [ ] **Next Steps**: Clear roadmap
- [ ] **Lessons Learned**: Retrospective included

## ✅ Integration

- [ ] **Gateway Config**: `buildStateLayerConfig()` reads sessions config
- [ ] **State Layer Config**: `StateLayerConfig` includes sessions + semantic
- [ ] **Backwards Compatibility**: Existing deployments unaffected
- [ ] **Default Behavior**: SQLite remains default
- [ ] **Config Validation**: Invalid configs rejected gracefully

## ✅ Constraints Met

- [ ] **SQLite Default**: No changes to default behavior
- [ ] **Postgres Opt-in**: Requires explicit config change
- [ ] **No Breaking Changes**: All existing APIs preserved
- [ ] **Schema Compatibility**: SQLite and Postgres schemas match
- [ ] **TypeScript Strict**: All code uses strict mode
- [ ] **Existing Patterns**: Follows StateLayer patterns (connection pools, async/await)

## ⚠️ Known Limitations

- [ ] **Documented**: ADR section on "Constraints and Limitations"
- [ ] **SessionManager Sync**: Async refactor needed (documented)
- [ ] **Scheduler SQLite**: Still uses SQLite (documented)
- [ ] **Qdrant Embeddings**: Placeholder implementation (documented)
- [ ] **Integration Tests**: Pending async refactor (documented)

## 📋 Files to Review

### New Files (8)
1. [ ] `packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.ts` (642 lines)
2. [ ] `packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.test.ts` (384 lines)
3. [ ] `packages/core/gateway/src/state-layer/sessions/sessions-store-interface.ts` (121 lines)
4. [ ] `packages/core/gateway/src/state-layer/sessions/README.md` (175 lines)
5. [ ] `packages/core/gateway/src/state-layer/sessions/QUICKSTART.md` (217 lines)
6. [ ] `packages/core/gateway/src/state-layer/memory/qdrant-memory-store.ts` (389 lines)
7. [ ] `packages/core/gateway/docs/architecture/decisions/005-modular-storage-backends.md` (448 lines)
8. [ ] `MODULAR_STORAGE_IMPLEMENTATION.md` (441 lines)

### Modified Files (3)
1. [ ] `packages/shared/config/src/schema.ts` (+80 lines)
2. [ ] `packages/core/gateway/src/main.ts` (+30 lines)
3. [ ] `nachos.toml.example` (+20 lines)

### Summary Files (2)
1. [ ] `IMPLEMENTATION_COMPLETE.md` (469 lines)
2. [ ] `REVIEW_CHECKLIST.md` (this file)

**Total Lines**: ~3,300 lines of code + documentation

## 🔍 Code Review Focus Areas

### 1. PostgresSessionsStore

**Focus**: Transaction safety, connection pooling, error handling

```typescript
// Key methods to review:
- getOrCreateSessionAtomic() // Race condition safety
- replaceMessages()           // Transaction atomicity
- ensureSchema()              // Idempotency
```

**Questions**:
- [ ] Does SELECT FOR UPDATE prevent race conditions?
- [ ] Are transactions properly rolled back on error?
- [ ] Is the connection pool properly configured?

### 2. QdrantMemoryStore

**Focus**: HTTP client usage, collection management, placeholder embeddings

```typescript
// Key methods to review:
- initCollection()  // Collection schema
- query()           // Hybrid search
- embed()           // Placeholder (needs integration)
```

**Questions**:
- [ ] Is the HTTP client error handling robust?
- [ ] Are payload indexes created correctly?
- [ ] Is the embedding placeholder clearly documented?

### 3. Configuration

**Focus**: Defaults, validation, backwards compatibility

```typescript
// Key sections to review:
- SessionsStorageConfig    // Schema definition
- buildStateLayerConfig()  // Config loading
```

**Questions**:
- [ ] Are defaults sensible?
- [ ] Is the config validated?
- [ ] Does it break existing deployments?

## 🧪 Testing Recommendations

### Unit Tests
```bash
# Run Postgres tests
export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
pnpm test -- postgres-sessions-store.test.ts
```

### Manual Testing
```bash
# Start Postgres
docker run -d --name nachos-postgres-test \
  -e POSTGRES_USER=nachos \
  -e POSTGRES_PASSWORD=nachos \
  -p 5432:5432 \
  postgres:15-alpine

# Run Gateway with Postgres config
# (Note: Currently limited by sync SessionManager)

# Cleanup
docker stop nachos-postgres-test && docker rm nachos-postgres-test
```

### Integration Testing (Future)
- [ ] Gateway with Postgres backend
- [ ] Multi-instance deployment
- [ ] Concurrent session access
- [ ] Message compaction
- [ ] Qdrant semantic search

## ✅ Approval Checklist

- [ ] **Code Review**: At least one team member reviewed
- [ ] **Tests Pass**: All unit tests green
- [ ] **Documentation Complete**: All sections filled
- [ ] **Backwards Compatible**: Existing configs work
- [ ] **No Breaking Changes**: APIs unchanged
- [ ] **Performance**: No degradation for SQLite path
- [ ] **Security**: No SQL injection vulnerabilities
- [ ] **Follow-up Tickets**: Created for pending work

## 📝 Review Notes

**Reviewer**: ___________________  
**Date**: ___________________

### Strengths

(List positive aspects)

### Areas for Improvement

(List concerns or suggestions)

### Blockers

(List any issues that prevent merge)

### Recommendation

- [ ] **Approve**: Merge as-is
- [ ] **Approve with Comments**: Merge after minor changes
- [ ] **Request Changes**: Need revisions before merge
- [ ] **Reject**: Does not meet requirements

---

**Signature**: ___________________ **Date**: ___________________
