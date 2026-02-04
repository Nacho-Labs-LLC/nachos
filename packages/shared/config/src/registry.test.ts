import { describe, it, expect } from 'vitest';
import { buildChannelRegistry, listEnabledChannels } from './registry.js';
import type { NachosConfig } from './schema.js';

describe('channel registry helpers', () => {
  const baseConfig: NachosConfig = {
    nachos: { name: 'test', version: '1.0' },
    llm: { provider: 'anthropic', model: 'claude' },
    security: { mode: 'standard' },
  };

  it('returns empty when no channels configured', () => {
    expect(listEnabledChannels(baseConfig)).toEqual([]);
    expect(buildChannelRegistry(baseConfig)).toEqual([]);
  });

  it('treats channels as enabled unless explicitly disabled', () => {
    const config: NachosConfig = {
      ...baseConfig,
      channels: {
        slack: { enabled: false },
        discord: { token: 'token' },
      },
    };

    expect(listEnabledChannels(config)).toEqual(['discord']);
  });
});
