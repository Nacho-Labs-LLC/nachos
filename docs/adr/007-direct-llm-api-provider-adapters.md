# ADR-007: Direct LLM API Provider Adapters (No CLI Piggyback)

**Status**: Proposed

**Date**: 2026-02-02

**Deciders**: Nachos Core Team

**Context**: Phase 3 (LLM Integration) planning; enforce TOS-compliant, modular provider integrations

---

## Context and Problem Statement

Nachos Phase 3 requires a production-grade LLM integration layer (LLM Proxy). We must support multiple providers (Anthropic, OpenAI, Ollama) with a unified internal request format, streaming, tool calling, and robust error handling.

We explicitly do **not** want to piggyback on third-party CLI tools (e.g., “Claude Code CLI” style wrappers), because:

- It risks violating provider Terms of Service
- It introduces brittle behavior and rate-limit instability
- It makes auditing and security controls harder
- It couples Nachos to unofficial tooling

We need a compliant, modular, and observable approach for LLM provider integration.

## Decision Drivers

- **TOS compliance**: Direct API integrations only
- **Security-first**: Clear boundaries and auditability
- **Modularity**: Providers must be pluggable and isolated in design
- **Performance**: Low-latency streaming and efficient token usage
- **Reliability**: Retries, rate-limit handling, and failover
- **Maintainability**: Clear adapter interface, minimal duplication
- **Developer experience**: Simple local setup and consistent behavior

## Considered Options

### Option 1: Piggyback on External CLI Tools

Wrap third-party CLIs (e.g., Claude Code CLI) for completions.

**Pros:**

- Faster initial prototype
- Minimal provider-specific code

**Cons:**

- TOS risk and policy violations
- No stable API guarantees
- Hard to audit and observe
- Weak error handling and streaming control
- Not acceptable for Nachos security-first goals

### Option 2: Direct API Providers via SDK/HTTP (Chosen)

Implement provider adapters that call official APIs (SDK or HTTP), translating the internal LLM request format to provider-native requests.

**Pros:**

- Fully TOS-compliant
- Clear security and audit boundary
- Explicit control over streaming, tool calls, and system prompts
- Stable provider APIs and SDKs
- Easy to test and mock

**Cons:**

- More implementation work
- Must keep adapters up to date with API changes

### Option 3: Separate Sidecar Service per Provider

Run a dedicated container per provider to handle request translation.

**Pros:**

- Strong isolation per provider
- Can independently scale providers

**Cons:**

- Operational complexity for most users
- More containers in the default stack
- Not aligned with Nachos “simple by default” goal

## Decision Outcome

**Chosen option**: Option 2 — Direct API Provider Adapters

### Rationale

Direct SDK/HTTP integration provides the best balance of compliance, security, modularity, and performance. It keeps provider differences isolated in adapter code while preserving the unified internal LLM request schema defined in the technical spec.

### Implementation

1. **Provider Adapter Interface** (in LLM Proxy)
   - `send(request: LLMRequestType): Promise<LLMResponseType>`
   - `stream(request: LLMRequestType, onChunk): Promise<void>`
   - `healthCheck(): Promise<ProviderHealth>`

2. **Adapters**
   - Anthropic adapter using official SDK or HTTP
   - OpenAI adapter using official SDK or HTTP
   - Ollama adapter using HTTP

3. **Prompt and Tool Handling**
   - Gateway is responsible for composing system prompts and LLMRequest messages
   - LLM Proxy performs **no prompt mutation**, only translation

4. **Reliability**
   - Exponential backoff, retry policies, and rate-limit handling
   - Circuit breaker per provider
   - Optional failover to configured fallback model/provider

5. **Failover & Cooldowns**
   - Apply cooldowns per auth profile (API key) in memory only
   - Failover order is a single ordered list of `provider:model` entries
   - No fallback is attempted unless the ordered list is explicitly configured
   - Exponential cooldowns: 1m → 5m → 25m → 1h cap
   - Billing failures use longer backoff: 5h → 10h → 20h → 24h cap
   - Retry handling is per request only (no queue-wide scheduling)

6. **Streaming Contract (Option C)**
   - Provider adapters emit SSE/token deltas
   - LLM Proxy forwards deltas on `nachos.llm.stream.<sessionId>`
   - Final canonical response is sent on `nachos.llm.response`

7. **Observability**
   - Emit structured events for LLM requests, latency, token usage, and errors
   - Gateway/Salsa handles policy and audit logging

### Consequences

**Positive:**

- TOS-compliant integration
- Clear provider abstraction boundary
- Consistent streaming and tool-calling behavior
- Strong observability and predictable error handling
- Graceful degradation during provider cooldowns

**Negative:**

- Increased implementation effort
- Ongoing maintenance of adapters as provider APIs evolve
- Cooldown state resets on proxy restart (memory-only)

**Neutral:**

- LLM Proxy becomes the canonical translation layer for provider specifics

## Validation

- End-to-end chat request succeeds with Anthropic and OpenAI
- Streaming delivers chunks within 300ms p95 from provider response start
- Token usage and rate-limit headers are surfaced to Gateway
- Failover triggers when provider errors exceed threshold
- No external CLI dependencies required
- Cooldowns apply per auth profile and reset after backoff window

## References

- [Phase 3: LLM Integration](../../../PROJECT_ROADMAP.md)
- [Technical Spec: Message Schemas](../TECHNICAL_SPEC.md)
- [Architecture Overview](../architecture.md)
- [ADR-003: Security-First Design](./003-security-first-design.md)

## Notes

Open questions to finalize:

- How many providers should be enabled by default in development?
- Preferred SDKs vs raw HTTP (per provider)?
- Minimum streaming format to standardize on for Gateway consumption?
- Should LLM Proxy emit audit events directly, or only Gateway/Salsa?
