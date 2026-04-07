/**
 * Snapshot tool schemas for LLM tool calling
 *
 * These tools enable the LLM to list and restore context snapshots,
 * allowing recovery of conversation history from before compaction.
 */

import type { ToolCall, ToolResult, Message } from '@nachos/types';
import type { IContextSnapshotService } from '@nachos/context-manager';
import type { SessionsStore } from '@nachos/state';
import { createLogger } from '@nachos/types';

const logger = createLogger('snapshot-tools');

/**
 * snapshot_list tool schema
 * Lists available snapshots for the current session
 */
export const SnapshotListToolSchema = {
  $id: 'snapshot_list',
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: 'Maximum number of snapshots to return (default: 10)',
      default: 10,
    },
  },
  required: [],
};

/**
 * snapshot_restore tool schema
 * Restores session messages from a snapshot
 */
export const SnapshotRestoreToolSchema = {
  $id: 'snapshot_restore',
  type: 'object',
  properties: {
    snapshot_id: {
      type: 'string',
      description:
        'The ID of the snapshot to restore (obtained from snapshot_list). If not provided, restores from the latest snapshot.',
    },
  },
  required: [],
};

/**
 * Execute snapshot_list tool
 */
export async function executeSnapshotList(
  call: ToolCall,
  snapshotService: IContextSnapshotService,
  sessionId: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      limit?: number;
    };

    const limit = params.limit ?? 10;

    const snapshots = await snapshotService.listSnapshots(sessionId, { limit });

    if (snapshots.length === 0) {
      return {
        success: true,
        content: [
          {
            type: 'text',
            text: 'No snapshots available for this session.',
          },
        ],
      };
    }

    const lines = snapshots.map((s, idx) => {
      const date = new Date(s.timestamp).toLocaleString();
      return `${idx + 1}. **${s.id}** — ${date} (${s.messageCount} messages, trigger: ${s.trigger})`;
    });

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Found ${snapshots.length} snapshot(s) for this session:\n\n${lines.join('\n')}`,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'SNAPSHOT_LIST_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error listing snapshots',
      },
    };
  }
}

/**
 * Execute snapshot_restore tool
 */
export async function executeSnapshotRestore(
  call: ToolCall,
  snapshotService: IContextSnapshotService,
  sessionsStore: SessionsStore,
  sessionId: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      snapshot_id?: string;
    };

    // Get the snapshot
    const snapshot = params.snapshot_id
      ? await snapshotService.getSnapshot(sessionId, params.snapshot_id)
      : await snapshotService.getLatestSnapshot(sessionId);

    if (!snapshot) {
      return {
        success: false,
        content: [],
        error: {
          code: 'SNAPSHOT_NOT_FOUND',
          message: params.snapshot_id
            ? `Snapshot ${params.snapshot_id} not found for this session.`
            : 'No snapshots found for this session.',
        },
      };
    }

    if (snapshot.messages.length === 0) {
      return {
        success: false,
        content: [],
        error: {
          code: 'SNAPSHOT_EMPTY',
          message: `Snapshot ${snapshot.id} contains no messages.`,
        },
      };
    }

    // Convert context messages to NACHOS Message format for replaceMessages
    const messages: Message[] = snapshot.messages.map((contextMsg, idx) => ({
      id: contextMsg.id ?? `restored-${idx}`,
      sessionId,
      role: contextMsg.role as Message['role'],
      content:
        typeof contextMsg.content === 'string'
          ? contextMsg.content
          : JSON.stringify(contextMsg.content),
      createdAt: contextMsg.timestamp
        ? new Date(contextMsg.timestamp).toISOString()
        : new Date().toISOString(),
    }));

    // Replace current session messages with snapshot messages
    await sessionsStore.replaceMessages(sessionId, messages);

    logger.info(
      { sessionId, snapshotId: snapshot.id, messageCount: messages.length },
      'Restored session from snapshot'
    );

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Restored ${messages.length} messages from snapshot ${snapshot.id} (created ${new Date(snapshot.timestamp).toLocaleString()}, trigger: ${snapshot.trigger}). The session history has been replaced with the snapshot contents.`,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'SNAPSHOT_RESTORE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error restoring snapshot',
      },
    };
  }
}
