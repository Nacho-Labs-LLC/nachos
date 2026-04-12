# ADR-007: LLM Multi-Provider Adapter Pattern

## Status

Accepted (2026-04-12)

## Context

Nachos originally launched with Anthropic as the only supported LLM provider.
As the platform matured, several pressures made multi-provider support necessary:

- **Operational resilience**: Single provider = single point of failure. Rate
  limits or outages drop the entire bot fleet.
- **Cost flexibility**: Different providers have different price/performance
  profiles. Users need the ability to choose.
- **Deployment constraints**: Enterprise users may have AWS access only (Bedrock)
  or require on-premise models (Ollama) for data-residency reasons.
- **Competitive positioning**: Locking to one provider limits adoption.

We needed to add support for OpenAI, Google Gemini, AWS Bedrock, and Ollama
without breaking existing Anthropic users or requiring them to change config.

### Options Considered

**Option A: Direct SDK calls per provider scattered through codebase**
- Pros: Simple for first provider
- Cons: Provider-specific logic bleeds into gateway, tool loop, and session
  management. Adding a new provider requires touching many files.

**Option B: Unified adapter interface with per-provider implementations**
- Pros: Provider logic isolated to one place. Gateway/tool-loop are provider-
  agnostic. New providers require only a new adapter file + registry entry.
- Cons: Requires upfront interface design. Impedance mismatch between providers
  (Gemini's message format vs. Anthropic's tool_use blocks).

**Option C: OpenAI-compatible proxy layer**
- Pros: Many providers expose OpenAI-compatible endpoints.
- Cons: Anthropic and Gemini are not OpenAI-compatible. Forces non-native message
  formats that lose capability (e.g., Anthropic's multi-turn tool_use vs.
  OpenAI's flattened function calls).

## Decision

Use **Option B — a unified adapter interface** with per-provider implementations
behind a registry.

### Interface Contract (`types.ts`)

Every provider adapter must implement:

```typescript
interface LLMProviderAdapter {
  readonly name: string;
  readonly type: 'anthropic' | 'openai' | 'ollama' | 'custom';
  send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse>;
  stream?(request, options, onChunk): Promise<AdapterResponse>;
}
```

`stream` is optional — adapters that don't support streaming degrade gracefully
to `send`. All adapters return the same `AdapterResponse` shape regardless of
provider.

### Registry (`registry.ts`)

All adapters are registered at startup. Provider selection is a config key:

```typescript
const adapters = new Map<string, LLMProviderAdapter>();
adapters.set('anthropic', new AnthropicAdapter());
adapters.set('openai', new OpenAIAdapter());
adapters.set('ollama', new OllamaAdapter(config.base_url));
adapters.set('bedrock', createBedrockAdapter(awsRegion));
adapters.set('gemini', new GeminiAdapter());
```

### Message Normalization

Each adapter is responsible for translating between Nachos' internal
`LLMRequestType` and the provider's native format:

- **Anthropic**: `tool_use` / `tool_result` content blocks
- **OpenAI**: `function` / `tool` call flattening
- **Bedrock**: Anthropic messages API via AWS SDK (same format as Anthropic
  adapter)
- **Gemini**: `Content[]` with `functionCall` / `functionResponse` parts
- **Ollama**: OpenAI-compatible (delegates to `OpenAIAdapter`)

### Multi-Profile Auth

All adapters support the same profile-based key rotation pattern via
`AdapterSendOptions`:

```typescript
interface AdapterSendOptions {
  model: string;
  getProfileList?: () => string[];
  getProfileApiKey?: (name: string) => string | null;
  onProfileCooldown?: (name: string, reason: 'rate_limit' | 'billing') => void;
}
```

Each adapter's `resolveApiKey` method iterates profiles in order, falling back
to environment variables if no profile key is found.

### Error Normalization

All adapters map provider-specific errors to `ProviderError` with a `kind`
discriminant (`rate_limit`, `billing`, `auth`, `network`, `invalid_request`,
`unknown`). The gateway uses `kind` to decide whether to retry, fall back, or
surface the error to the user.

## Consequences

### Positive

1. **Isolation**: Adding a new provider requires one new file + one registry
   entry. No gateway/tool-loop changes.
2. **Testability**: `cross-provider.test.ts` and `cross-provider.harness.ts`
   run the same behavioral assertions against all adapters, catching regressions
   automatically.
3. **Consistent observability**: `provider` and `model` fields are emitted on
   every stream chunk, regardless of provider.
4. **Graceful degradation**: `stream?` is optional, so providers without
   streaming (e.g., future batch-only providers) can still participate in
   fallback chains.

### Negative

1. **Message format translation burden**: Each adapter must handle the full
   message format impedance mismatch. Gemini's message format is especially
   complex (system prompt extracted separately, tool results as function
   responses, model role named 'model' not 'assistant').
2. **Feature parity gaps**: Not all providers support all features (e.g.,
   Gemini tool IDs are synthetic; Bedrock doesn't have a billing error code).
   These are documented as known limitations.
3. **Test infrastructure overhead**: Cross-provider tests require mocking each
   provider's SDK at the right level.

### Known Limitations

- Network errors (ECONNREFUSED, timeouts) currently map to `unknown` kind in
  all adapters — a future pass should add `network` kind detection.
- Gemini tool call IDs (`gemini-call-0`, `gemini-call-1`) are positional, not
  opaque. This is a Gemini SDK limitation.
- Bedrock has no billing error distinction — quota/throttle errors are mapped to
  `rate_limit`.

## Alternatives Revisited

If provider count grows significantly (10+), a plugin-style adapter loader
(discover adapters from `node_modules/@nachos/adapter-*` packages) would allow
community-contributed providers without core changes. The current registry is a
simple starting point that can evolve to this.

## References

- PR: `feat/llm-multi-provider`
- `packages/core/llm-proxy/src/adapters/`
- `docs/guides/provider-switching.md`
- ADR-001: Bedrock Adapter Type Choice (superseded in part by this decision)
