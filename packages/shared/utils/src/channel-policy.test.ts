import { describe, it, expect } from 'vitest';
import { isMentioned, shouldAllowGroupMessage, shouldAllowDm } from './index.js';

describe('channel policy helpers', () => {
  it('detects mention patterns', () => {
    expect(isMentioned('hello @bot', ['@bot'])).toBe(true);
    expect(isMentioned('hello', ['@bot'])).toBe(false);
  });

  it('enforces group allowlists and mention gating', () => {
    const allowed = shouldAllowGroupMessage({
      channelId: 'C1',
      userId: 'U1',
      text: 'hi @bot',
      channelAllowlist: ['C1'],
      userAllowlist: ['U1'],
      mentionGating: true,
      mentionPatterns: ['@bot'],
    });

    expect(allowed).toBe(true);
  });

  it('enforces DM allowlist with optional pairing', async () => {
    const allow = await shouldAllowDm('U1', ['U1'], false, async () => false);
    expect(allow).toBe(true);

    const paired = await shouldAllowDm('U2', [], true, async () => true);
    expect(paired).toBe(true);
  });
});
