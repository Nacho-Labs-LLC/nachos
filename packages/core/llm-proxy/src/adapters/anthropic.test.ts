import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';

type ResolveResult = { apiKey: string; profileName?: string };

type ResolveFn = (options: {
  getProfileList?: () => string[];
  getProfileApiKey?: (profileName: string) => string | null;
}) => ResolveResult;

const ENV_KEYS = ['ANTHROPIC_API_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();

for (const key of ENV_KEYS) {
  savedEnv.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('AnthropicAdapter resolveApiKey', () => {
  it('uses the first available profile key in order', () => {
    const adapter = new AnthropicAdapter();
    const resolveApiKey = (adapter as unknown as { resolveApiKey: ResolveFn }).resolveApiKey.bind(
      adapter
    );

    const result = resolveApiKey({
      getProfileList: () => ['profile-a', 'profile-b'],
      getProfileApiKey: (name) => (name === 'profile-b' ? 'key-b' : null),
    });

    expect(result).toEqual({ apiKey: 'key-b', profileName: 'profile-b' });
  });

  it('falls back to defaultApiKey when no profiles match', () => {
    const adapter = new AnthropicAdapter(undefined, 'default-key');
    const resolveApiKey = (adapter as unknown as { resolveApiKey: ResolveFn }).resolveApiKey.bind(
      adapter
    );

    const result = resolveApiKey({
      getProfileList: () => ['profile-a'],
      getProfileApiKey: () => null,
    });

    expect(result).toEqual({ apiKey: 'default-key' });
  });

  it('falls back to ANTHROPIC_API_KEY when no profile keys exist', () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';

    const adapter = new AnthropicAdapter();
    const resolveApiKey = (adapter as unknown as { resolveApiKey: ResolveFn }).resolveApiKey.bind(
      adapter
    );

    const result = resolveApiKey({});
    expect(result).toEqual({ apiKey: 'env-key' });
  });

  it('throws ProviderError when no API key is available', () => {
    delete process.env.ANTHROPIC_API_KEY;

    const adapter = new AnthropicAdapter();
    const resolveApiKey = (adapter as unknown as { resolveApiKey: ResolveFn }).resolveApiKey.bind(
      adapter
    );

    expect(() => resolveApiKey({})).toThrow('Anthropic API key missing');
  });
});
