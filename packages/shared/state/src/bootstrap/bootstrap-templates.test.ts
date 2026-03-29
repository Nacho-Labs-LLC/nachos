import { describe, it, expect } from 'vitest';
import {
  createDefaultBootstrapBlocks,
  createBootstrapBlocksWithCustomPrompt,
} from './bootstrap-templates.js';

describe('createDefaultBootstrapBlocks', () => {
  it('should return all expected block keys', () => {
    const blocks = createDefaultBootstrapBlocks();
    expect(blocks).toHaveProperty('agents');
    expect(blocks).toHaveProperty('soul');
    expect(blocks).toHaveProperty('tools');
    expect(blocks).toHaveProperty('identity');
    expect(blocks).toHaveProperty('user');
    expect(blocks).toHaveProperty('bootstrap');
  });

  it('should have a non-empty bootstrap block', () => {
    const blocks = createDefaultBootstrapBlocks();
    expect(blocks.bootstrap).toBeTruthy();
    expect(blocks.bootstrap.length).toBeGreaterThan(10);
  });

  it('bootstrap block should guide structured onboarding', () => {
    const blocks = createDefaultBootstrapBlocks();
    // Should guide name collection
    expect(blocks.bootstrap).toContain('name');
    // Should guide identity setup
    expect(blocks.bootstrap).toContain('IDENTITY');
    // Should guide user profile
    expect(blocks.bootstrap).toContain('USER');
    // Should instruct to complete bootstrap
    expect(blocks.bootstrap).toContain('bootstrap');
    expect(blocks.bootstrap).toContain('identityCompleted');
  });

  it('identity block should have blank fields for user to fill in', () => {
    const blocks = createDefaultBootstrapBlocks();
    expect(blocks.identity).toContain('Name:');
    expect(blocks.identity).toContain('Role or vibe:');
  });

  it('user block should have blank fields for user to fill in', () => {
    const blocks = createDefaultBootstrapBlocks();
    expect(blocks.user).toContain('Name:');
    expect(blocks.user).toContain('Timezone:');
  });
});

describe('createBootstrapBlocksWithCustomPrompt', () => {
  it('should replace the bootstrap block with custom content', () => {
    const customPrompt = 'Welcome to MyBot! Tell me your name.';
    const blocks = createBootstrapBlocksWithCustomPrompt(customPrompt);
    expect(blocks.bootstrap).toBe(customPrompt);
  });

  it('should retain all other default blocks unchanged', () => {
    const defaults = createDefaultBootstrapBlocks();
    const customPrompt = 'Custom onboarding flow';
    const blocks = createBootstrapBlocksWithCustomPrompt(customPrompt);

    expect(blocks.agents).toBe(defaults.agents);
    expect(blocks.soul).toBe(defaults.soul);
    expect(blocks.tools).toBe(defaults.tools);
    expect(blocks.identity).toBe(defaults.identity);
    expect(blocks.user).toBe(defaults.user);
  });

  it('should handle empty string custom prompt', () => {
    const blocks = createBootstrapBlocksWithCustomPrompt('');
    expect(blocks.bootstrap).toBe('');
  });

  it('should handle multiline custom prompts', () => {
    const customPrompt = 'Line one\nLine two\nLine three';
    const blocks = createBootstrapBlocksWithCustomPrompt(customPrompt);
    expect(blocks.bootstrap).toBe(customPrompt);
  });
});
