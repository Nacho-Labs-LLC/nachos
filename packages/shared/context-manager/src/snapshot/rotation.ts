/**
 * NACHOS Context Management - Snapshot Rotation
 *
 * Utilities for managing snapshot lifecycle and cleanup.
 */

import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Snapshot cleanup configuration
 */
export interface SnapshotCleanupConfig {
  /**
   * Maximum age of snapshots in milliseconds
   * Default: 30 days
   */
  maxAge?: number;

  /**
   * Maximum number of snapshots per session
   * Default: 10
   */
  maxSnapshots?: number;

  /**
   * Maximum total disk space for snapshots (bytes)
   * Default: 100MB
   */
  maxDiskSpace?: number;
}

/**
 * Snapshot cleanup result
 */
export interface CleanupResult {
  sessionsProcessed: number;
  snapshotsDeleted: number;
  bytesFreed: number;
}

/**
 * Snapshot rotation utilities
 */
export class SnapshotRotation {
  private stateDir: string;

  constructor(stateDir: string = './data') {
    this.stateDir = stateDir;
  }

  /**
   * Clean up old snapshots across all sessions
   */
  async cleanupOldSnapshots(config: SnapshotCleanupConfig = {}): Promise<CleanupResult> {
    const { maxAge = 30 * 24 * 60 * 60 * 1000, maxSnapshots = 10 } = config; // 30 days default

    const sessionsDir = join(this.stateDir, 'sessions');
    let sessionsProcessed = 0;
    let snapshotsDeleted = 0;
    let bytesFreed = 0;

    try {
      const sessionDirs = await fs.readdir(sessionsDir);

      for (const sessionId of sessionDirs) {
        const snapshotDir = join(sessionsDir, sessionId, 'snapshots');

        try {
          const result = await this.cleanupSessionSnapshots(snapshotDir, { maxAge, maxSnapshots });
          sessionsProcessed++;
          snapshotsDeleted += result.deleted;
          bytesFreed += result.bytesFreed;
        } catch (error) {
          // Skip sessions without snapshots or with access errors
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(`[SnapshotRotation] Error cleaning session ${sessionId}:`, error);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return { sessionsProcessed, snapshotsDeleted, bytesFreed };
  }

  /**
   * Clean up snapshots for a specific session
   */
  private async cleanupSessionSnapshots(
    snapshotDir: string,
    options: { maxAge: number; maxSnapshots: number }
  ): Promise<{ deleted: number; bytesFreed: number }> {
    const { maxAge, maxSnapshots } = options;
    const now = Date.now();

    const files = await fs.readdir(snapshotDir);
    const snapshotFiles = files
      .filter((f) => f.startsWith('snapshot-') && (f.endsWith('.json') || f.endsWith('.json.gz')))
      .map((f) => ({
        name: f,
        path: join(snapshotDir, f),
        timestamp: this.extractTimestamp(f),
      }))
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

    let deleted = 0;
    let bytesFreed = 0;

    // Delete snapshots older than maxAge
    for (const snapshot of snapshotFiles) {
      const age = now - snapshot.timestamp;

      if (age > maxAge) {
        const stats = await fs.stat(snapshot.path);
        await fs.unlink(snapshot.path);
        deleted++;
        bytesFreed += stats.size;
      }
    }

    // Delete excess snapshots (keep only maxSnapshots most recent)
    if (snapshotFiles.length > maxSnapshots) {
      const toDelete = snapshotFiles.slice(maxSnapshots);

      for (const snapshot of toDelete) {
        // Skip if already deleted due to age
        try {
          const stats = await fs.stat(snapshot.path);
          await fs.unlink(snapshot.path);
          deleted++;
          bytesFreed += stats.size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }

    return { deleted, bytesFreed };
  }

  /**
   * Delete snapshots for sessions older than a certain age
   */
  async deleteOldSessions(olderThanMs: number): Promise<CleanupResult> {
    const sessionsDir = join(this.stateDir, 'sessions');
    const now = Date.now();

    let sessionsProcessed = 0;
    let snapshotsDeleted = 0;
    let bytesFreed = 0;

    try {
      const sessionDirs = await fs.readdir(sessionsDir);

      for (const sessionId of sessionDirs) {
        const sessionDir = join(sessionsDir, sessionId);
        const stats = await fs.stat(sessionDir);

        // Check if session directory is old
        const age = now - stats.mtimeMs;
        if (age > olderThanMs) {
          const result = await this.deleteSessionSnapshots(sessionId);
          sessionsProcessed++;
          snapshotsDeleted += result.deleted;
          bytesFreed += result.bytesFreed;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return { sessionsProcessed, snapshotsDeleted, bytesFreed };
  }

  /**
   * Delete all snapshots for a session
   */
  async deleteSessionSnapshots(
    sessionId: string
  ): Promise<{ deleted: number; bytesFreed: number }> {
    const snapshotDir = join(this.stateDir, 'sessions', sessionId, 'snapshots');

    let deleted = 0;
    let bytesFreed = 0;

    try {
      const files = await fs.readdir(snapshotDir);

      for (const file of files) {
        if (file.startsWith('snapshot-')) {
          const filepath = join(snapshotDir, file);
          const stats = await fs.stat(filepath);
          await fs.unlink(filepath);
          deleted++;
          bytesFreed += stats.size;
        }
      }

      // Try to remove empty directory
      await fs.rmdir(snapshotDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return { deleted, bytesFreed };
  }

  /**
   * Get total disk usage for all snapshots
   */
  async getTotalDiskUsage(): Promise<number> {
    const sessionsDir = join(this.stateDir, 'sessions');
    let totalBytes = 0;

    try {
      const sessionDirs = await fs.readdir(sessionsDir);

      for (const sessionId of sessionDirs) {
        const snapshotDir = join(sessionsDir, sessionId, 'snapshots');

        try {
          const files = await fs.readdir(snapshotDir);

          for (const file of files) {
            if (file.startsWith('snapshot-')) {
              const filepath = join(snapshotDir, file);
              const stats = await fs.stat(filepath);
              totalBytes += stats.size;
            }
          }
        } catch (error) {
          // Skip if no snapshots directory
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return totalBytes;
  }

  /**
   * Extract timestamp from snapshot filename
   */
  private extractTimestamp(filename: string): number {
    const match = filename.match(/snapshot-(\d+)/);
    const timestamp = match?.[1];
    return timestamp ? parseInt(timestamp, 10) : 0;
  }
}

/**
 * Create a snapshot rotation manager
 */
export function createSnapshotRotation(stateDir?: string): SnapshotRotation {
  return new SnapshotRotation(stateDir);
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
