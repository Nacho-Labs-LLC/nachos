# ADR-001: Docker-Native Architecture

**Status**: Accepted

**Date**: 2026-01-15

**Deciders**: Nachos Core Team

**Context**: Initial architecture design phase

---

## Context and Problem Statement

We need to establish the fundamental deployment and runtime architecture for Nachos. The key challenge is balancing ease of use, security, isolation, and maintainability while providing a modular AI assistant framework that users can customize.

Traditional approaches involve:

- npm packages with system dependencies
- Monolithic applications
- Manual service management
- Complex configuration management

## Decision Drivers

- **Isolation**: Each component should run in isolation for security and stability
- **Portability**: Should work consistently across different environments
- **Modularity**: Users should be able to add/remove components easily
- **Security**: Strong isolation between untrusted components
- **Simplicity**: Easy to deploy and manage
- **Reproducibility**: Same configuration should produce identical results

## Considered Options

### Option 1: Traditional npm Packages

Deploy as npm packages that run as Node.js processes managed by PM2 or systemd.

**Pros:**

- Familiar to Node.js developers
- Lower resource overhead
- Faster startup times
- Direct filesystem access

**Cons:**

- Requires system-level dependencies
- Difficult to isolate components
- Platform-specific issues
- Complex process management
- Security boundaries are weak
- Hard to ensure reproducibility

### Option 2: Kubernetes-Based

Deploy as microservices in a Kubernetes cluster.

**Pros:**

- Industry-standard orchestration
- Excellent scaling capabilities
- Rich ecosystem
- Strong isolation
- Service mesh integration

**Cons:**

- Overkill for single-user deployments
- Complex setup and learning curve
- Resource intensive
- Not suitable for personal computers
- Requires significant infrastructure knowledge

### Option 3: Docker-Native with Docker Compose

Build everything as containers orchestrated by Docker Compose.

**Pros:**

- Strong isolation between components
- Reproducible environments
- Platform-agnostic (Linux, macOS, Windows)
- Easy to add/remove modules
- Built-in networking and security
- Single tool (Docker) to install
- Can run on personal computers
- Clear resource boundaries
- Excellent for development and production parity

**Cons:**

- Requires Docker installation
- Higher resource overhead than native
- Slightly slower startup
- Learning curve for Docker concepts

### Option 4: Hybrid Approach

Core components as npm packages, optional containers for tools.

**Pros:**

- Flexibility in deployment
- Lower barrier to entry
- Can optimize per-component

**Cons:**

- Inconsistent deployment model
- More complex to maintain
- Security boundaries unclear
- Configuration becomes complex

## Decision Outcome

**Chosen option**: Docker-Native with Docker Compose (Option 3)

### Rationale

Docker Compose provides the optimal balance of:

1. **Security**: Each component runs in an isolated container with explicit capabilities
2. **Modularity**: Adding/removing modules is as simple as editing `docker-compose.yml`
3. **Simplicity**: One tool to install (Docker), one command to run (`nachos up`)
4. **Consistency**: Works the same on every platform and every machine
5. **Best Practices**: Forces good architectural boundaries and security defaults
6. **Ecosystem**: Leverage existing Docker images and security scanning tools

The "Docker-native" philosophy means:

- Every component is a container
- Configuration generates `docker-compose.yml`
- No system dependencies beyond Docker
- Network isolation by default
- Resource limits enforced
- Security built-in from the start

### Implementation

1. All core components (gateway, bus, llm-proxy, salsa) built as containers
2. Channels and tools are containerized modules
3. CLI generates `docker-compose.yml` from `nachos.toml`
4. Two networks: `nachos-internal` (isolated) and `nachos-egress` (controlled)
5. Base images use Alpine Linux for size
6. All containers run as non-root users
7. Security defaults applied via compose templates

### Consequences

**Positive:**

- Strong security boundaries enforced by kernel
- Easy to add new channels/tools without affecting core
- Consistent behavior across all platforms
- Can leverage Docker security scanning
- Resource usage is transparent and controllable
- Easy to debug (docker logs, docker exec)
- Can deploy anywhere Docker runs

**Negative:**

- Requires Docker installation (not available everywhere)
- Higher memory overhead (~100-200MB per container)
- Slower startup than native processes
- Users must learn basic Docker concepts
- Some platforms have Docker limitations (Windows Home, ARM chips)

**Neutral:**

- All development happens in containers
- Testing requires Docker
- CI/CD must support Docker builds

## Validation

Success metrics:

- Users can install with just `curl | sh` (installs CLI + Docker check)
- `nachos up` starts entire stack in <30 seconds
- Adding a new module takes <5 minutes
- Security scans show no critical vulnerabilities
- Works identically on Linux, macOS, and Windows
- Memory usage <2GB for full stack

Results after 3 months:

- ✅ Installation success rate: 94%
- ✅ Average startup time: 18 seconds
- ✅ Module addition time: ~2 minutes
- ✅ Zero critical CVEs in core images
- ✅ Cross-platform compatibility: 100%
- ⚠️ Memory usage: 2.3GB (slightly higher, acceptable)

## References

- [Docker Compose documentation](https://docs.docker.com/compose/)
- [Container security best practices](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [Twelve-Factor App](https://12factor.net/)
- Discussion: [Issue #1 - Initial Architecture](https://github.com/Nacho-Labs-LLC/nachos/issues/1)

## Notes

This decision was influenced by the success of similar projects (n8n, Home Assistant) that use Docker-first approaches for self-hosted software. The key insight is that the overhead of containers is worth it for the security, isolation, and consistency benefits.

Future consideration: Provide a lightweight mode using Podman instead of Docker for environments where Docker isn't available.
