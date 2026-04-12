import { describe, it, expect } from 'vitest';
import { resolveDmPolicy, resolveGroupPolicy, findServerConfig } from './policy.js';
import type { ChannelServerConfig } from '@nachos/config';

describe('channel base policy helpers', () => {
  it('resolves dm policy with defaults', () => {
    const policy = resolveDmPolicy({ user_allowlist: ['U1'] });
    expect(policy?.userAllowlist).toEqual(['U1']);
    expect(policy?.pairing).toBe(false);
  });

  it('resolves group policy with mention gating default', () => {
    const server: ChannelServerConfig = {
      id: 'G1',
      channel_ids: ['C1'],
      user_allowlist: ['U1'],
    };
    const policy = resolveGroupPolicy(server);
    expect(policy.mentionGating).toBe(true);
  });

  it('finds server config by id', () => {
    const servers: ChannelServerConfig[] = [
      { id: 'G1', channel_ids: ['C1'], user_allowlist: ['U1'] },
    ];
    expect(findServerConfig(servers, 'G1')?.id).toBe('G1');
  });
});
