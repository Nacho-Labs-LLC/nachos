/**
 * Skill Watcher
 *
 * Watches the skills directory for changes and triggers skill reloads.
 * Supports debouncing to avoid excessive reloads during file saves.
 */

import { watch, type FSWatcher } from 'node:fs';
import { createLogger } from '@nachos/types';
import type { Skill } from './skill-loader.js';

const logger = createLogger('skill-watcher');

export interface SkillWatcherConfig {
  /** Directory to watch for skill changes */
  skillsDir: string;
  /** Debounce delay in milliseconds (default: 500ms) */
  debounceMs?: number;
  /** Callback when skills should be reloaded */
  onReload: () => Promise<SkillReloadResult>;
}

export interface SkillReloadResult {
  /** Previously loaded skills (before reload) */
  previous: Skill[];
  /** Newly loaded skills (after reload) */
  current: Skill[];
}

export interface SkillChanges {
  added: string[];
  removed: string[];
  modified: string[];
  total: number;
}

/**
 * Watches the skills directory and triggers reload callbacks on changes
 */
export class SkillWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private config: SkillWatcherConfig;
  private isRunning = false;

  constructor(config: SkillWatcherConfig) {
    this.config = {
      debounceMs: 500,
      ...config,
    };
  }

  /**
   * Start watching the skills directory
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Skill watcher already running');
      return;
    }

    try {
      // Use fs.watch with recursive option to watch the entire skills directory tree
      this.watcher = watch(this.config.skillsDir, { recursive: true }, (eventType, filename) => {
        this.handleFileChange(eventType, filename);
      });

      this.isRunning = true;
      logger.info(
        {
          skillsDir: this.config.skillsDir,
          debounceMs: this.config.debounceMs,
        },
        'Skill watcher started'
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          skillsDir: this.config.skillsDir,
        },
        'Failed to start skill watcher'
      );
    }
  }

  /**
   * Stop watching the skills directory
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isRunning = false;
    logger.info('Skill watcher stopped');
  }

  /**
   * Handle file system change events
   */
  private handleFileChange(eventType: string, filename: string | null): void {
    if (!filename) {
      return;
    }

    // Only care about SKILL.md files or directory changes
    const isSkillFile = filename.endsWith('SKILL.md');
    const isDirectory = !filename.includes('.');

    if (!isSkillFile && !isDirectory) {
      return;
    }

    logger.debug(
      {
        eventType,
        filename,
        isSkillFile,
        isDirectory,
      },
      'Detected file change in skills directory'
    );

    // Debounce: clear existing timer and set a new one
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.triggerReload();
    }, this.config.debounceMs);
  }

  /**
   * Trigger a skill reload
   */
  private async triggerReload(): Promise<void> {
    try {
      logger.info('Reloading skills...');
      const result = await this.config.onReload();
      const changes = this.detectChanges(result.previous, result.current);

      logger.info(
        {
          added: changes.added,
          removed: changes.removed,
          modified: changes.modified,
          total: changes.total,
        },
        'Skills reloaded successfully'
      );
    } catch (error) {
      logger.error(
        {
          err: error,
        },
        'Failed to reload skills'
      );
    }
  }

  /**
   * Detect what changed between skill sets
   */
  private detectChanges(previous: Skill[], current: Skill[]): SkillChanges {
    const prevMap = new Map(previous.map((s) => [s.name, s]));
    const currMap = new Map(current.map((s) => [s.name, s]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Find added and modified skills
    for (const [name, skill] of currMap) {
      const prevSkill = prevMap.get(name);
      if (!prevSkill) {
        added.push(name);
      } else if (prevSkill.content !== skill.content) {
        modified.push(name);
      }
    }

    // Find removed skills
    for (const name of prevMap.keys()) {
      if (!currMap.has(name)) {
        removed.push(name);
      }
    }

    return {
      added,
      removed,
      modified,
      total: currMap.size,
    };
  }

  /**
   * Check if the watcher is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}
