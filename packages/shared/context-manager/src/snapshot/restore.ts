/**
 * NACHOS Context Management - Snapshot Restoration
 *
 * Utilities for restoring sessions from snapshots.
 */

import type { ContextSnapshot, ContextMessage } from '../types/index.js';
import type { IContextSnapshotService } from '../types/index.js';
import type { Message } from '@nachos/types';
import { messageAdapter } from '../integration/message-adapter.js';

/**
 * Restoration result
 */
export interface RestoreResult {
  /**
   * Whether restoration was successful
   */
  success: boolean;

  /**
   * Restored messages (if successful)
   */
  messages?: Message[];

  /**
   * Number of messages restored
   */
  messageCount?: number;

  /**
   * Snapshot metadata
   */
  snapshot?: ContextSnapshot;

  /**
   * Error message (if failed)
   */
  error?: string;
}

/**
 * Restoration options
 */
export interface RestoreOptions {
  /**
   * Snapshot ID to restore from
   * If not provided, restores from latest snapshot
   */
  snapshotId?: string;

  /**
   * Validate messages after restoration
   * Default: true
   */
  validate?: boolean;
}

/**
 * Snapshot Restoration Utility
 *
 * Provides methods for restoring session state from snapshots.
 */
export class SnapshotRestorer {
  private snapshotService: IContextSnapshotService;

  constructor(snapshotService: IContextSnapshotService) {
    this.snapshotService = snapshotService;
  }

  /**
   * Restore session from a snapshot
   *
   * @param sessionId - Session to restore
   * @param options - Restoration options
   * @returns Restoration result
   */
  async restore(sessionId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    const { snapshotId, validate = true } = options;

    try {
      // Get snapshot
      const snapshot = snapshotId
        ? await this.snapshotService.getSnapshot(sessionId, snapshotId)
        : await this.snapshotService.getLatestSnapshot(sessionId);

      if (!snapshot) {
        return {
          success: false,
          error: snapshotId
            ? `Snapshot ${snapshotId} not found for session ${sessionId}`
            : `No snapshots found for session ${sessionId}`,
        };
      }

      // Convert context messages back to NACHOS Message format
      const messages: Message[] = snapshot.messages.map((contextMsg) =>
        messageAdapter.toNachosMessage(contextMsg)
      );

      // Validate if requested
      if (validate) {
        const validation = this.validateMessages(messages);
        if (!validation.valid) {
          return {
            success: false,
            error: `Validation failed: ${validation.error}`,
            snapshot,
          };
        }
      }

      return {
        success: true,
        messages,
        messageCount: messages.length,
        snapshot,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during restoration',
      };
    }
  }

  /**
   * List available snapshots for restoration
   *
   * @param sessionId - Session ID
   * @returns Array of snapshot metadata (without full message content)
   */
  async listAvailableSnapshots(
    sessionId: string
  ): Promise<Array<{ id: string; timestamp: string; messageCount: number; trigger: string }>> {
    const snapshots = await this.snapshotService.listSnapshots(sessionId);

    return snapshots.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      messageCount: s.messageCount,
      trigger: s.trigger,
    }));
  }

  /**
   * Get snapshot info without loading messages
   *
   * @param sessionId - Session ID
   * @param snapshotId - Snapshot ID
   * @returns Snapshot metadata
   */
  async getSnapshotInfo(
    sessionId: string,
    snapshotId: string
  ): Promise<{
    id: string;
    timestamp: string;
    messageCount: number;
    trigger: string;
    metadata?: Record<string, unknown>;
  } | null> {
    const snapshot = await this.snapshotService.getSnapshot(sessionId, snapshotId);

    if (!snapshot) {
      return null;
    }

    return {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      messageCount: snapshot.messageCount,
      trigger: snapshot.trigger,
      metadata: snapshot.metadata,
    };
  }

  /**
   * Preview messages from a snapshot (first N messages)
   *
   * @param sessionId - Session ID
   * @param snapshotId - Snapshot ID
   * @param limit - Number of messages to preview
   * @returns Preview of messages
   */
  async previewSnapshot(
    sessionId: string,
    snapshotId: string,
    limit: number = 10
  ): Promise<{ messages: ContextMessage[]; total: number } | null> {
    const snapshot = await this.snapshotService.getSnapshot(sessionId, snapshotId);

    if (!snapshot) {
      return null;
    }

    const previewMessages = snapshot.messages.slice(0, limit);

    return {
      messages: previewMessages,
      total: snapshot.messageCount,
    };
  }

  /**
   * Compare two snapshots
   *
   * @param sessionId - Session ID
   * @param snapshotId1 - First snapshot ID
   * @param snapshotId2 - Second snapshot ID
   * @returns Comparison result
   */
  async compareSnapshots(
    sessionId: string,
    snapshotId1: string,
    snapshotId2: string
  ): Promise<{
    snapshot1: { id: string; timestamp: string; messageCount: number };
    snapshot2: { id: string; timestamp: string; messageCount: number };
    messageDifference: number;
    timeDifference: number; // milliseconds
  } | null> {
    const [s1, s2] = await Promise.all([
      this.snapshotService.getSnapshot(sessionId, snapshotId1),
      this.snapshotService.getSnapshot(sessionId, snapshotId2),
    ]);

    if (!s1 || !s2) {
      return null;
    }

    const time1 = new Date(s1.timestamp).getTime();
    const time2 = new Date(s2.timestamp).getTime();

    return {
      snapshot1: {
        id: s1.id,
        timestamp: s1.timestamp,
        messageCount: s1.messageCount,
      },
      snapshot2: {
        id: s2.id,
        timestamp: s2.timestamp,
        messageCount: s2.messageCount,
      },
      messageDifference: s2.messageCount - s1.messageCount,
      timeDifference: time2 - time1,
    };
  }

  /**
   * Validate restored messages
   */
  private validateMessages(messages: Message[]): { valid: boolean; error?: string } {
    if (messages.length === 0) {
      return { valid: false, error: 'No messages to restore' };
    }

    // Check that all messages have required fields
    for (const msg of messages) {
      if (!msg.id || !msg.sessionId || !msg.role || !msg.content) {
        return { valid: false, error: 'Invalid message structure' };
      }

      if (!['user', 'assistant', 'system', 'tool'].includes(msg.role)) {
        return { valid: false, error: `Invalid role: ${msg.role}` };
      }
    }

    return { valid: true };
  }
}

/**
 * Create a snapshot restorer
 */
export function createSnapshotRestorer(snapshotService: IContextSnapshotService): SnapshotRestorer {
  return new SnapshotRestorer(snapshotService);
}
