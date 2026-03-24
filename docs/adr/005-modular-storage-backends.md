# ADR-005: Modular Storage Backends

**Status:** Proposed  
**Date:** 2026-02-25  
**Author:** Nachos Team

> **Note:** This ADR is a stub. It was referenced by ADR-006 but not yet written. Fill in when the storage migration work begins.

## Context

Nachos currently uses SQLite as the only storage backend for session state, messages, and configuration. As deployments grow, operators need options:

- **SQLite** — simple, zero-infra, sufficient for single-node deployments
- **PostgreSQL** — multi-instance, production-grade, concurrent access
- **Redis** — session caching, pub/sub for distributed message bus (future)

The storage layer needs to be abstracted so backends can be swapped via config without code changes.

## Decision

_[To be written]_

Placeholder: implement a `StateStorage` interface that SQLite and Postgres backends satisfy. Config key: `storage.backend = "sqlite" | "postgres"`.

## Consequences

_[To be written]_

## References

- ADR-006: Session Viewing and Continuation (references this ADR for Postgres migration path)
- `packages/shared/src/storage/` (implementation location, TBD)
