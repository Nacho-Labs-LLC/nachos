/**
 * Snapshot Service Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ContextSnapshotService } from './service.js';
import type { ContextMessage } from '../types/index.js';

describe('ContextSnapshotService', () => {
  const testStateDir = join(process.cwd(), 'test-data', 'snapshots');
  const testSessionId = 'test-session-123';

  const createTestMessages = (count: number): ContextMessage[] => {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i + 1}`,
      _tokenCache: 10,
    }));
  };

  beforeEach(async () => {
    // Clean up test directory before each test
    try {
      await fs.rm(testStateDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await fs.rm(testStateDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('createSnapshot()', () => {
    it('should create a snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(10);

      const snapshot = await service.createSnapshot({
        sessionId: testSessionId,
        messages,
        trigger: 'manual',
        metadata: { test: true },
      });

      expect(snapshot.id).toBeDefined();
      expect(snapshot.sessionId).toBe(testSessionId);
      expect(snapshot.messageCount).toBe(10);
      expect(snapshot.trigger).toBe('manual');
      expect(snapshot.messages).toHaveLength(10);
    });

    it('should create compressed snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: true });
      const messages = createTestMessages(100); // More messages for better compression

      const snapshot = await service.createSnapshot({
        sessionId: testSessionId,
        messages,
        trigger: 'auto-compaction',
      });

      expect(snapshot.id).toBeDefined();

      // Verify file is compressed
      const snapshotDir = join(testStateDir, 'sessions', testSessionId, 'snapshots');
      const files = await fs.readdir(snapshotDir);
      const snapshotFile = files.find((f) => f.startsWith('snapshot-'));
      expect(snapshotFile).toBeDefined();
      expect(snapshotFile).toMatch(/\.json\.gz$/);
    });

    it('should create directory structure', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir });
      const messages = createTestMessages(5);

      await service.createSnapshot({
        sessionId: testSessionId,
        messages,
        trigger: 'manual',
      });

      const snapshotDir = join(testStateDir, 'sessions', testSessionId, 'snapshots');
      const stat = await fs.stat(snapshotDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('getSnapshot()', () => {
    it('should retrieve a snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(10);

      const created = await service.createSnapshot({
        sessionId: testSessionId,
        messages,
        trigger: 'manual',
      });

      const retrieved = await service.getSnapshot(testSessionId, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.messages).toHaveLength(10);
    });

    it('should return null for non-existent snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir });

      const snapshot = await service.getSnapshot(testSessionId, 'non-existent-id');
      expect(snapshot).toBeNull();
    });

    it('should decompress compressed snapshots', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: true });
      const messages = createTestMessages(20);

      const created = await service.createSnapshot({
        sessionId: testSessionId,
        messages,
        trigger: 'auto-compaction',
      });

      const retrieved = await service.getSnapshot(testSessionId, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.messages).toHaveLength(20);
    });
  });

  describe('listSnapshots()', () => {
    it('should list all snapshots', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(5);

      // Create multiple snapshots
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'auto-compaction' });
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'periodic' });

      const snapshots = await service.listSnapshots(testSessionId);

      expect(snapshots).toHaveLength(3);
      // Should be in reverse chronological order (most recent first)
      expect(new Date(snapshots[0].timestamp).getTime()).toBeGreaterThan(
        new Date(snapshots[1].timestamp).getTime()
      );
    });

    it('should return empty array for session with no snapshots', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir });

      const snapshots = await service.listSnapshots('no-snapshots-session');
      expect(snapshots).toEqual([]);
    });

    it('should support pagination', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(5);

      // Create 5 snapshots
      for (let i = 0; i < 5; i++) {
        await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      }

      const page1 = await service.listSnapshots(testSessionId, { limit: 2, offset: 0 });
      const page2 = await service.listSnapshots(testSessionId, { limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('deleteSnapshot()', () => {
    it('should delete a snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(10);

      const snapshot = await service.createSnapshot({
        sessionId: testSessionId,
        messages,
        trigger: 'manual',
      });

      const deleted = await service.deleteSnapshot(testSessionId, snapshot.id);
      expect(deleted).toBe(true);

      const retrieved = await service.getSnapshot(testSessionId, snapshot.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir });

      const deleted = await service.deleteSnapshot(testSessionId, 'non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteAllSnapshots()', () => {
    it('should delete all snapshots for a session', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(5);

      // Create multiple snapshots
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });

      const deletedCount = await service.deleteAllSnapshots(testSessionId);
      expect(deletedCount).toBe(3);

      const remaining = await service.listSnapshots(testSessionId);
      expect(remaining).toHaveLength(0);
    });
  });

  describe('getSnapshotCount()', () => {
    it('should return correct count', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(5);

      expect(await service.getSnapshotCount(testSessionId)).toBe(0);

      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });

      expect(await service.getSnapshotCount(testSessionId)).toBe(2);
    });
  });

  describe('getLatestSnapshot()', () => {
    it('should return most recent snapshot', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(5);

      const first = await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });

      const latest = await service.getLatestSnapshot(testSessionId);

      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(second.id);
      expect(latest?.id).not.toBe(first.id);
    });

    it('should return null for session with no snapshots', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir });

      const latest = await service.getLatestSnapshot('no-snapshots-session');
      expect(latest).toBeNull();
    });
  });

  describe('Snapshot rotation', () => {
    it('should rotate old snapshots', async () => {
      const service = new ContextSnapshotService({
        stateDir: testStateDir,
        maxSnapshots: 3,
        compression: false,
      });
      const messages = createTestMessages(5);

      // Create 5 snapshots (exceeds maxSnapshots of 3)
      for (let i = 0; i < 5; i++) {
        await service.createSnapshot({
          sessionId: testSessionId,
          messages,
          trigger: 'manual',
          metadata: { index: i },
        });
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const snapshots = await service.listSnapshots(testSessionId);

      // Should only keep 3 most recent
      expect(snapshots).toHaveLength(3);
    });
  });

  describe('getSnapshotDiskUsage()', () => {
    it('should calculate disk usage', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir, compression: false });
      const messages = createTestMessages(20);

      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });
      await service.createSnapshot({ sessionId: testSessionId, messages, trigger: 'manual' });

      const diskUsage = await service.getSnapshotDiskUsage(testSessionId);

      expect(diskUsage).toBeGreaterThan(0);
    });

    it('should return 0 for session with no snapshots', async () => {
      const service = new ContextSnapshotService({ stateDir: testStateDir });

      const diskUsage = await service.getSnapshotDiskUsage('no-snapshots-session');
      expect(diskUsage).toBe(0);
    });
  });
});
