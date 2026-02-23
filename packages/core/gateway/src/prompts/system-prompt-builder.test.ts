/**
 * Tests for SystemPromptBuilder
 */

import { describe, it, expect } from 'vitest';
import { SystemPromptBuilder, PlatformHints } from './system-prompt-builder.js';

describe('SystemPromptBuilder', () => {
  it('should build a minimal prompt with just identity', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'You are a helpful assistant.',
      promptMode: 'none',
    });

    expect(prompt).toBe('You are a helpful assistant.');
  });

  it('should include runtime section in minimal mode', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'You are a helpful assistant.',
      runtimeInfo: {
        model: 'claude-sonnet-4',
        workspaceDir: '/workspace',
      },
      promptMode: 'minimal',
    });

    expect(prompt).toContain('You are a helpful assistant.');
    expect(prompt).toContain('## Runtime');
    expect(prompt).toContain('claude-sonnet-4');
    expect(prompt).toContain('/workspace');
    expect(prompt).not.toContain('## Memory Recall');
  });

  it('should build full prompt with all sections', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'You are a test assistant.',
      toolNames: ['exec', 'memory_search'],
      hasMemoryTools: true,
      hasMessagingTools: true,
      runtimeInfo: {
        agentId: 'test-bot',
        model: 'test-model',
        workspaceDir: '/test',
      },
      userTimezone: 'America/New_York',
      currentDateTime: '2026-02-22T12:00:00Z',
      ownerIdentification: 'Owner: test-user',
      messageChannelOptions: 'discord|telegram',
      silentReplyToken: 'NO_REPLY',
    });

    // Check for all major sections
    expect(prompt).toContain('You are a test assistant.');
    expect(prompt).toContain('## Tooling');
    expect(prompt).toContain('exec, memory_search');
    expect(prompt).toContain('## Memory Recall');
    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('## Workspace');
    expect(prompt).toContain('/test');
    expect(prompt).toContain('## User Identity');
    expect(prompt).toContain('Owner: test-user');
    expect(prompt).toContain('## Current Date & Time');
    expect(prompt).toContain('America/New_York');
    expect(prompt).toContain('## Messaging');
    expect(prompt).toContain('discord|telegram');
    expect(prompt).toContain('NO_REPLY');
    expect(prompt).toContain('## Runtime');
    expect(prompt).toContain('test-bot');
    expect(prompt).toContain('test-model');
  });

  it('should skip memory section if no memory tools', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test',
      hasMemoryTools: false,
    });

    expect(prompt).not.toContain('## Memory Recall');
  });

  it('should skip messaging section if no messaging tools', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test',
      hasMessagingTools: false,
    });

    expect(prompt).not.toContain('## Messaging');
  });

  it('should include platform hints when provided', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test',
      platformHints: ['Discord: No markdown tables', 'Use emojis sparingly'],
    });

    expect(prompt).toContain('## Platform Formatting');
    expect(prompt).toContain('Discord: No markdown tables');
    expect(prompt).toContain('Use emojis sparingly');
  });

  it('should include workspace notes when provided', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test',
      runtimeInfo: { workspaceDir: '/test' },
      workspaceNotes: ['Project uses pnpm', 'Config in /config'],
    });

    expect(prompt).toContain('## Workspace');
    expect(prompt).toContain('Project uses pnpm');
    expect(prompt).toContain('Config in /config');
  });

  it('should include tool summaries when provided', () => {
    const builder = new SystemPromptBuilder();
    const prompt = builder.build({
      identity: 'Test',
      toolNames: ['exec', 'web_search'],
      toolSummaries: {
        exec: 'Run shell commands',
        web_search: 'Search the web',
      },
    });

    expect(prompt).toContain('## Tooling');
    expect(prompt).toContain('Run shell commands');
    expect(prompt).toContain('Search the web');
  });
});

describe('PlatformHints', () => {
  it('should provide Discord hints', () => {
    const hints = PlatformHints.discord();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some(h => h.includes('Discord') || h.includes('markdown tables'))).toBe(true);
  });

  it('should provide Telegram hints', () => {
    const hints = PlatformHints.telegram();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some(h => h.includes('Telegram'))).toBe(true);
  });

  it('should provide Slack hints', () => {
    const hints = PlatformHints.slack();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some(h => h.includes('Slack'))).toBe(true);
  });

  it('should provide general hints', () => {
    const hints = PlatformHints.general();
    expect(hints.length).toBeGreaterThan(0);
  });
});
