/**
 * Shared session/tool utility functions.
 * Extracted from Gateway and ToolExecutor to eliminate duplication.
 */
import type { Session } from '@nachos/types';
import type { StateOperationContext } from '@nachos/state';

/**
 * Resolve the agent identity for a session.
 * Prefers `userId` when present, falls back to session `id`.
 */
export function resolveAgentId(session: Session): string {
  return session.userId ?? session.id;
}

/**
 * Build a {@link StateOperationContext} from a session and security mode.
 */
export function buildStateContext(
  session: Session,
  securityMode: 'strict' | 'standard' | 'permissive'
): StateOperationContext {
  return {
    sessionId: session.id,
    userId: session.userId,
    securityMode,
    channel: session.channel,
  };
}

/**
 * Check whether a session belongs to a subagent.
 */
export function isSubagentSession(session: Session | null): boolean {
  if (!session?.metadata) {
    return false;
  }
  return 'subagent' in session.metadata;
}

/**
 * Normalize a tool name to lowercase trimmed form.
 */
export function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase();
}
