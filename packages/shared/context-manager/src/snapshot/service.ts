/**
 * NACHOS Context Management - Snapshot Service
 *
 * Creates and manages pre-compaction snapshots of session message history.
 * Snapshots are stored as compressed JSON for efficient storage.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import type { ContextMessage, ContextSnapshot, IContextSnapshotService } from '../types/index.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Options for creating a snapshot
 */
export interface CreateSnapshotOptions {
  sessionId: string;
  messages: ContextMessage[];
  trigger: 'manual' | 'auto-compaction' | 'auto-threshold' | 'periodic';
  metadata?: Record<string, unknown>;
}

/**
 * Options for listing snapshots
 */
export interface ListSnapshotsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Snapshot service configuration
 */
export interface SnapshotServiceConfig {
  /**
   * Base directory for storing session data
   * Default: './data'
   */
  stateDir?: string;

  /**
   * Maximum number of snapshots to keep per session
   * Default: 10
   */
  maxSnapshots?: number;

  /**
   * Enable compression (gzip)
   * Default: true
   */
  compression?: boolean;
}

/**
 * Context Snapshot Service
 *
 * Manages creation, storage, and retrieval of session snapshots.
 * Snapshots are stored in: {stateDir}/sessions/{sessionId}/snapshots/
 */
export class ContextSnapshotService implements IContextSnapshotService {
  private stateDir: string;
  private maxSnapshots: number;
  private compression: boolean;

  constructor(config: SnapshotServiceConfig = {}) {
    this.stateDir = config.stateDir ?? './data';
    this.maxSnapshots = config.maxSnapshots ?? 10;
    this.compression = config.compression ?? true;
  }

  /**
   * Create a snapshot of the current session state
   */
  async createSnapshot(options: CreateSnapshotOptions): Promise<ContextSnapshot> {
    const { sessionId, messages, trigger, metadata = {} } = options;

    // Generate snapshot ID (timestamp-based for chronological ordering)
    const timestamp = new Date().toISOString();
    const snapshotId = `snapshot-${Date.now()}`;

    // Create snapshot object
    const snapshot: ContextSnapshot = {
      id: snapshotId,
      sessionId,
      timestamp,
      trigger,
      messageCount: messages.length,
      messages,
      metadata,
    };

    // Ensure snapshot directory exists
    const snapshotDir = this.getSnapshotDirectory(sessionId);
    await fs.mkdir(snapshotDir, { recursive: true });

    // Write snapshot to disk
    await this.writeSnapshot(snapshotDir, snapshotId, snapshot);

    // Rotate old snapshots if needed
    await this.rotateSnapshots(sessionId);

    return snapshot;
  }

  /**
   * Get a specific snapshot
   */
  async getSnapshot(sessionId: string, snapshotId: string): Promise<ContextSnapshot | null> {
    const snapshotDir = this.getSnapshotDirectory(sessionId);
    const filename = this.getSnapshotFilename(snapshotId);
    const filepath = join(snapshotDir, filename);

    try {
      return await this.readSnapshot(filepath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List snapshots for a session
   */
  async listSnapshots(
    sessionId: string,
    options?: ListSnapshotsOptions
  ): Promise<ContextSnapshot[]> {
    const snapshotDir = this.getSnapshotDirectory(sessionId);

    try {
      const files = await fs.readdir(snapshotDir);
      const snapshotFiles = files
        .filter(
          (f) => f.startsWith('snapshot-') && f.endsWith(this.compression ? '.json.gz' : '.json')
        )
        .sort()
        .reverse(); // Most recent first

      // Apply pagination
      const { limit, offset = 0 } = options ?? {};
      const paginatedFiles = limit
        ? snapshotFiles.slice(offset, offset + limit)
        : snapshotFiles.slice(offset);

      // Read snapshot metadata (without full message content for efficiency)
      const snapshots: ContextSnapshot[] = [];
      for (const file of paginatedFiles) {
        const filepath = join(snapshotDir, file);
        const snapshot = await this.readSnapshot(filepath);
        if (snapshot) {
          // Omit messages from list view to save memory
          snapshots.push({
            ...snapshot,
            messages: [], // Empty array - use getSnapshot() for full content
          });
        }
      }

      return snapshots;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete a specific snapshot
   */
  async deleteSnapshot(sessionId: string, snapshotId: string): Promise<boolean> {
    const snapshotDir = this.getSnapshotDirectory(sessionId);
    const filename = this.getSnapshotFilename(snapshotId);
    const filepath = join(snapshotDir, filename);

    try {
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete all snapshots for a session
   */
  async deleteAllSnapshots(sessionId: string): Promise<number> {
    const snapshots = await this.listSnapshots(sessionId);
    let deletedCount = 0;

    for (const snapshot of snapshots) {
      const deleted = await this.deleteSnapshot(sessionId, snapshot.id);
      if (deleted) {
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Get snapshot count for a session
   */
  async getSnapshotCount(sessionId: string): Promise<number> {
    const snapshots = await this.listSnapshots(sessionId);
    return snapshots.length;
  }

  /**
   * Get the most recent snapshot
   */
  async getLatestSnapshot(sessionId: string): Promise<ContextSnapshot | null> {
    const snapshots = await this.listSnapshots(sessionId, { limit: 1 });
    return snapshots[0] ?? null;
  }

  /**
   * Rotate snapshots - keep only the most recent N snapshots
   */
  private async rotateSnapshots(sessionId: string): Promise<void> {
    const snapshots = await this.listSnapshots(sessionId);

    // If we're under the limit, no rotation needed
    if (snapshots.length <= this.maxSnapshots) {
      return;
    }

    // Delete oldest snapshots
    const toDelete = snapshots.slice(this.maxSnapshots);
    for (const snapshot of toDelete) {
      await this.deleteSnapshot(sessionId, snapshot.id);
    }
  }

  /**
   * Get the snapshot directory path for a session
   */
  private getSnapshotDirectory(sessionId: string): string {
    return join(this.stateDir, 'sessions', sessionId, 'snapshots');
  }

  /**
   * Get the filename for a snapshot
   */
  private getSnapshotFilename(snapshotId: string): string {
    return this.compression ? `${snapshotId}.json.gz` : `${snapshotId}.json`;
  }

  /**
   * Write a snapshot to disk
   */
  private async writeSnapshot(
    directory: string,
    snapshotId: string,
    snapshot: ContextSnapshot
  ): Promise<void> {
    const filename = this.getSnapshotFilename(snapshotId);
    const filepath = join(directory, filename);
    const jsonData = JSON.stringify(snapshot, null, 2);

    if (this.compression) {
      const compressed = await gzipAsync(Buffer.from(jsonData, 'utf-8'));
      await fs.writeFile(filepath, compressed);
    } else {
      await fs.writeFile(filepath, jsonData, 'utf-8');
    }
  }

  /**
   * Read a snapshot from disk
   */
  private async readSnapshot(filepath: string): Promise<ContextSnapshot | null> {
    try {
      const fileData = await fs.readFile(filepath);

      let jsonData: string;
      if (this.compression && filepath.endsWith('.gz')) {
        const decompressed = await gunzipAsync(fileData);
        jsonData = decompressed.toString('utf-8');
      } else {
        jsonData = fileData.toString('utf-8');
      }

      return JSON.parse(jsonData) as ContextSnapshot;
    } catch (error) {
      console.error(`[SnapshotService] Failed to read snapshot ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Calculate the total disk space used by snapshots for a session
   */
  async getSnapshotDiskUsage(sessionId: string): Promise<number> {
    const snapshotDir = this.getSnapshotDirectory(sessionId);
    try {
      const files = await fs.readdir(snapshotDir);
      let totalBytes = 0;

      for (const file of files) {
        if (file.startsWith('snapshot-')) {
          const filepath = join(snapshotDir, file);
          const stats = await fs.stat(filepath);
          totalBytes += stats.size;
        }
      }

      return totalBytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw error;
    }
  }
}

/**
 * Create a snapshot service with default configuration
 */
export function createSnapshotService(config?: SnapshotServiceConfig): ContextSnapshotService {
  return new ContextSnapshotService(config);
}
