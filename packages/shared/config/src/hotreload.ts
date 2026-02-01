/**
 * Hot-Reload System for Policy Files
 *
 * Monitors policy files for changes and triggers reload callbacks
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';

/**
 * Callback function type for file change events
 */
export type FileChangeCallback = (filePath: string, content: string) => void | Promise<void>;

/**
 * Options for file watcher
 */
export interface WatchOptions {
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Whether to ignore initial add events (default: true) */
  ignoreInitial?: boolean;
  /** File patterns to watch (default: ['*.yaml', '*.yml', '*.json']) */
  patterns?: string[];
}

/**
 * Hot-reload watcher for policy files
 */
export class HotReloadWatcher {
  private watcher?: FSWatcher;
  private callbacks: Map<string, FileChangeCallback> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private options: WatchOptions = {}) {
    this.options.debounceMs = options.debounceMs ?? 300;
    this.options.ignoreInitial = options.ignoreInitial ?? true;
    this.options.patterns = options.patterns ?? ['*.yaml', '*.yml', '*.json'];
  }

  /**
   * Start watching a directory for file changes
   */
  watch(directory: string, callback: FileChangeCallback): void {
    if (!fs.existsSync(directory)) {
      throw new Error(`Directory does not exist: ${directory}`);
    }

    if (!fs.statSync(directory).isDirectory()) {
      throw new Error(`Path is not a directory: ${directory}`);
    }

    // Store callback for this directory
    const normalizedPath = path.resolve(directory);
    this.callbacks.set(normalizedPath, callback);

    // Create watcher if it doesn't exist
    if (!this.watcher) {
      const watchPatterns = this.options.patterns!.map((pattern) =>
        path.join(normalizedPath, pattern),
      );

      this.watcher = watch(watchPatterns, {
        ignoreInitial: this.options.ignoreInitial,
        persistent: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      });

      this.watcher
        .on('change', (filePath) => this.handleFileChange(filePath))
        .on('add', (filePath) => this.handleFileChange(filePath))
        .on('error', (error: unknown) => {
          if (error instanceof Error) {
            this.handleError(error);
          } else {
            this.handleError(new Error(String(error)));
          }
        });
    }
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(filePath: string): void {
    const normalizedPath = path.resolve(filePath);

    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(normalizedPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.processFileChange(normalizedPath);
      this.debounceTimers.delete(normalizedPath);
    }, this.options.debounceMs);

    this.debounceTimers.set(normalizedPath, timer);
  }

  /**
   * Process file change after debounce
   */
  private async processFileChange(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const directory = path.dirname(filePath);

      // Find callback for this directory
      for (const [watchedDir, callback] of this.callbacks.entries()) {
        if (directory.startsWith(watchedDir)) {
          try {
            await callback(filePath, content);
          } catch (error) {
            console.error(`Error in hot-reload callback for ${filePath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
    }
  }

  /**
   * Handle watcher errors
   */
  private handleError(error: Error): void {
    console.error('Hot-reload watcher error:', error);
  }

  /**
   * Stop watching and clean up resources
   */
  async stop(): Promise<void> {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }

    // Clear callbacks
    this.callbacks.clear();
  }

  /**
   * Check if watcher is currently active
   */
  isWatching(): boolean {
    return this.watcher !== undefined;
  }
}

/**
 * Create and start a hot-reload watcher for policy files
 */
export function createPolicyWatcher(
  policyDir: string,
  callback: FileChangeCallback,
  options?: WatchOptions,
): HotReloadWatcher {
  const watcher = new HotReloadWatcher(options);
  watcher.watch(policyDir, callback);
  return watcher;
}
