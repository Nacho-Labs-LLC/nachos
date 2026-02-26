# ADR-001: Bedrock Adapter Type Choice

## Status
Accepted (2026-02-24)

## Context

AWS Bedrock provides managed access to Anthropic Claude models through AWS infrastructure. When implementing the Bedrock adapter, we needed to choose how to classify it within Nachos' LLM provider system.

### Options Considered

1. **Type: 'anthropic'** - Treat Bedrock as a variant of the Anthropic provider
   - Pros: Logical grouping (same underlying models)
   - Cons: Different authentication (AWS credentials vs API key), different error handling, potential config confusion

2. **Type: 'bedrock'** - Create a new top-level provider type
   - Pros: Clear separation
   - Cons: Requires schema changes, breaks backward compatibility with existing 'anthropic'|'openai' type

3. **Type: 'custom'** - Use existing custom provider type
   - Pros: Maintains backward compatibility, flexible credential handling, clean separation
   - Cons: Requires type assertion in adapter registry

## Decision

Use **`type: 'custom'`** for the Bedrock adapter.

Implementation:
```typescript
export function createBedrockAdapter(
  region?: string,
  credentials?: AwsCredentialIdentity
): LLMAdapterInterface {
  return {
    name: 'bedrock',
    type: 'custom', // <-- Critical choice
    send: async (request, options) => { ... },
    stream: async (request, options, onChunk) => { ... },
  };
}
```

## Consequences

### Positive

1. **Backward Compatibility**: No breaking changes to existing config schema
2. **Clean Separation**: Bedrock is clearly distinct from direct Anthropic API access
3. **Flexible Credentials**: Custom type allows different auth models (AWS SDK chain vs API keys)
4. **Future-Proof**: Easy to add other AWS-based providers (e.g., SageMaker endpoints)

### Negative

1. **Type Assertion Required**: Registry must cast to correct type:
   ```typescript
   const awsRegion = process.env.AWS_REGION || 'us-east-1';
   registry.register(
     createBedrockAdapter(awsRegion) as LLMAdapterInterface
   );
   ```

2. **Less Obvious**: Users might not realize Bedrock provides Claude access without reading docs

### Mitigations

- Comprehensive `BEDROCK_SETUP.md` documentation
- Clear naming: adapter name is 'bedrock', not 'anthropic-bedrock'
- Config validation warns if provider=bedrock but missing AWS credentials

## Alternatives Revisited

If we need to add many AWS-based providers in the future, we could:
- Create a new `type: 'aws'` category
- Use `name` to distinguish: 'bedrock', 'sagemaker', 'custom-endpoint'
- Maintain backward compatibility via migration

## References

- PR #112: Initial Bedrock implementation
- `packages/core/llm-proxy/src/adapters/bedrock.ts`
- `packages/core/llm-proxy/src/adapters/registry.ts`
- `packages/shared/config/src/schema.ts`
