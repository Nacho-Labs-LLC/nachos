/**
 * Tests for Skill Watcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillWatcher } from './skill-watcher.js';
import type { Skill } from './skill-loader.js';

describe('SkillWatcher', () => {
  let testDir: string;
  let watcher: SkillWatcher;
  let reloadCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create a unique test directory
    testDir = join(tmpdir(), `skill-watcher-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    reloadCallback = vi.fn();
  });

  afterEach(() => {
    // Stop watcher if running
    if (watcher) {
      watcher.stop();
    }

    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should start and stop watcher', () => {
    watcher = new SkillWatcher({
      skillsDir: testDir,
      onReload: reloadCallback,
    });

    expect(watcher.isActive()).toBe(false);

    watcher.start();
    expect(watcher.isActive()).toBe(true);

    watcher.stop();
    expect(watcher.isActive()).toBe(false);
  });

  it('should not start watcher twice', () => {
    watcher = new SkillWatcher({
      skillsDir: testDir,
      onReload: reloadCallback,
    });

    watcher.start();
    expect(watcher.isActive()).toBe(true);

    // Starting again should not throw
    watcher.start();
    expect(watcher.isActive()).toBe(true);
  });

  it('should debounce multiple rapid changes', async () => {
    const mockPrevious: Skill[] = [];
    const mockCurrent: Skill[] = [
      {
        name: 'test-skill',
        metadata: {
          name: 'test-skill',
          description: 'Test skill',
        },
        content: 'Test content',
        filePath: join(testDir, 'test-skill', 'SKILL.md'),
      },
    ];

    reloadCallback.mockResolvedValue({
      previous: mockPrevious,
      current: mockCurrent,
    });

    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 100,
      onReload: reloadCallback,
    });

    watcher.start();

    // Create a skill directory and file
    const skillDir = join(testDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');

    // Make multiple rapid changes
    writeFileSync(skillFile, 'version 1');
    writeFileSync(skillFile, 'version 2');
    writeFileSync(skillFile, 'version 3');

    // Wait for debounce to settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Reload should only be called once
    expect(reloadCallback).toHaveBeenCalledTimes(1);
  });

  it('should detect added skills', async () => {
    const mockSkill: Skill = {
      name: 'new-skill',
      metadata: {
        name: 'new-skill',
        description: 'New skill',
      },
      content: 'New content',
      filePath: join(testDir, 'new-skill', 'SKILL.md'),
    };

    reloadCallback.mockResolvedValue({
      previous: [],
      current: [mockSkill],
    });

    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 50,
      onReload: reloadCallback,
    });

    watcher.start();

    // Add a new skill
    const skillDir = join(testDir, 'new-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: new-skill\n---\nContent');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reloadCallback).toHaveBeenCalled();
  });

  it('should detect removed skills', async () => {
    const mockSkill: Skill = {
      name: 'removed-skill',
      metadata: {
        name: 'removed-skill',
        description: 'Removed skill',
      },
      content: 'Removed content',
      filePath: join(testDir, 'removed-skill', 'SKILL.md'),
    };

    // Create initial skill
    const skillDir = join(testDir, 'removed-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    writeFileSync(skillFile, '---\nname: removed-skill\n---\nContent');

    reloadCallback.mockResolvedValue({
      previous: [mockSkill],
      current: [],
    });

    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 50,
      onReload: reloadCallback,
    });

    watcher.start();

    // Remove the skill file
    unlinkSync(skillFile);

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reloadCallback).toHaveBeenCalled();
  });

  it('should detect modified skills', async () => {
    const mockSkillBefore: Skill = {
      name: 'modified-skill',
      metadata: {
        name: 'modified-skill',
        description: 'Before',
      },
      content: 'Before content',
      filePath: join(testDir, 'modified-skill', 'SKILL.md'),
    };

    const mockSkillAfter: Skill = {
      name: 'modified-skill',
      metadata: {
        name: 'modified-skill',
        description: 'After',
      },
      content: 'After content',
      filePath: join(testDir, 'modified-skill', 'SKILL.md'),
    };

    // Create initial skill
    const skillDir = join(testDir, 'modified-skill');
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    writeFileSync(skillFile, '---\nname: modified-skill\n---\nBefore content');

    reloadCallback.mockResolvedValue({
      previous: [mockSkillBefore],
      current: [mockSkillAfter],
    });

    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 50,
      onReload: reloadCallback,
    });

    watcher.start();

    // Modify the skill file
    writeFileSync(skillFile, '---\nname: modified-skill\n---\nAfter content');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(reloadCallback).toHaveBeenCalled();
  });

  it('should handle errors during reload gracefully', async () => {
    reloadCallback.mockRejectedValue(new Error('Reload failed'));

    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 50,
      onReload: reloadCallback,
    });

    watcher.start();

    // Create a skill to trigger reload
    const skillDir = join(testDir, 'error-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: error-skill\n---\nContent');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not throw, error is logged
    expect(reloadCallback).toHaveBeenCalled();
  });

  it('should ignore non-SKILL.md files', async () => {
    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 50,
      onReload: reloadCallback,
    });

    watcher.start();

    // Create a non-skill file
    writeFileSync(join(testDir, 'README.md'), 'Not a skill');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reload should not be called for non-skill files
    expect(reloadCallback).not.toHaveBeenCalled();
  });

  it('should cleanup properly on stop', () => {
    watcher = new SkillWatcher({
      skillsDir: testDir,
      debounceMs: 50,
      onReload: reloadCallback,
    });

    watcher.start();
    expect(watcher.isActive()).toBe(true);

    watcher.stop();
    expect(watcher.isActive()).toBe(false);

    // Create a file after stop - should not trigger reload
    const skillDir = join(testDir, 'post-stop-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: post-stop\n---\nContent');

    // Wait a bit
    setTimeout(() => {
      expect(reloadCallback).not.toHaveBeenCalled();
    }, 100);
  });
});
