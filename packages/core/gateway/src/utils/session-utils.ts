/**
 * Shared session/tool utility functions.
 * Extracted from Gateway and ToolExecutor to eliminate duplication.
 */
import type { Session } from '@nachos/types';
import type { StateOperationContext } from '@nachos/state';

/**
 * Shared bot-level agent ID.
 *
 * When set (via {@link setBotAgentId}), all sessions resolve to this single
 * identity.  This means memory, identity, and preferences are shared across
 * every channel and user — the bot is the entity that "knows things", not the
 * individual caller.
 *
 * Derived from `nachos.name` in nachos.toml (e.g. "nate-jr").
 */
let _botAgentId: string | undefined;

/**
 * Set the bot-level agent ID (called once during gateway init).
 * When set, {@link resolveAgentId} returns this value for every session.
 */
export function setBotAgentId(id: string): void {
  _botAgentId = id;
}

/** Exposed for testing. */
export function clearBotAgentId(): void {
  _botAgentId = undefined;
}

/**
 * Resolve the agent identity for a session.
 *
 * If a bot-level agent ID has been configured (single-identity mode),
 * all sessions share that ID.  Otherwise falls back to per-user scoping.
 */
export function resolveAgentId(session: Session): string {
  return _botAgentId ?? session.userId ?? session.id;
}

/**
 * Build a {@link StateOperationContext} from a session and security mode.
 *
 * Uses {@link resolveAgentId} so that when a bot-level agent ID is configured,
 * all state operations (memory, identity, etc.) resolve to the shared ID.
 */
export function buildStateContext(
  session: Session,
  securityMode: 'strict' | 'standard' | 'permissive'
): StateOperationContext {
  return {
    sessionId: session.id,
    userId: resolveAgentId(session),
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
