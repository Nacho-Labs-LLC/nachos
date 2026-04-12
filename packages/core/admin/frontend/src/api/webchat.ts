/**
 * WebChat API Client
 *
 * TypeScript wrapper for WebChat RPC endpoints.
 * Provides session management, messaging, and real-time updates via SSE.
 */

import type {
  ListSessionsResponse,
  ListArchivedResponse,
  CreateSessionResponse,
  ArchiveSessionResponse,
  RestoreSessionResponse,
  DeleteSessionResponse,
  PinSessionResponse,
  SendMessageResponse,
  GetMessagesResponse,
  StreamedMessage,
} from '../../../src/types/webchat-rpc-types.js';

export type {
  ListSessionsResponse,
  ListArchivedResponse,
  CreateSessionResponse,
  ArchiveSessionResponse,
  RestoreSessionResponse,
  DeleteSessionResponse,
  PinSessionResponse,
  SendMessageResponse,
  GetMessagesResponse,
  StreamedMessage,
};

const BASE = import.meta.env.VITE_API_BASE ?? '';

// ── Helper: HTTP Request ──────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Session Management ────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  name: string;
  lastActivity: string;
  messageCount: number;
  isPinned: boolean;
}

export interface ArchivedSessionInfo {
  id: string;
  name: string;
  archivedAt: string;
  messageCount: number;
}

/**
 * List active sessions (last 24h or pinned)
 */
export async function listActiveSessions(params?: {
  channel?: string;
  limit?: number;
  offset?: number;
}): Promise<SessionInfo[]> {
  const query = new URLSearchParams();
  if (params?.channel) query.set('channel', params.channel);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));

  const qs = query.toString();
  const response = await request<ListSessionsResponse>(
    `/api/webchat/sessions/active${qs ? `?${qs}` : ''}`
  );

  return response.sessions;
}

/**
 * List archived sessions
 */
export async function listArchivedSessions(params?: {
  channel?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: ArchivedSessionInfo[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.channel) query.set('channel', params.channel);
  if (params?.search) query.set('search', params.search);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));

  const qs = query.toString();
  const response = await request<ListArchivedResponse>(
    `/api/webchat/sessions/archived${qs ? `?${qs}` : ''}`
  );

  return response;
}

/**
 * Create a new session
 */
export async function createSession(params?: {
  channel?: string;
  systemPrompt?: string;
}): Promise<{ sessionId: string; name: string; createdAt: string }> {
  const response = await request<CreateSessionResponse>('/api/webchat/sessions/create', {
    method: 'POST',
    body: JSON.stringify({
      channel: params?.channel || 'webchat',
      systemPrompt: params?.systemPrompt,
    }),
  });

  return {
    sessionId: response.session.id,
    name: response.session.name,
    createdAt: response.session.createdAt,
  };
}

/**
 * Archive a session
 */
export async function archiveSession(sessionId: string): Promise<void> {
  await request<ArchiveSessionResponse>(`/api/webchat/sessions/${sessionId}/archive`, {
    method: 'POST',
  });
}

/**
 * Restore a session from archive
 */
export async function restoreSession(sessionId: string): Promise<void> {
  await request<RestoreSessionResponse>(`/api/webchat/sessions/${sessionId}/restore`, {
    method: 'POST',
  });
}

/**
 * Delete a session permanently
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await request<DeleteSessionResponse>(`/api/webchat/sessions/${sessionId}`, { method: 'DELETE' });
}

/**
 * Pin or unpin a session
 */
export async function pinSession(sessionId: string, pinned: boolean): Promise<void> {
  await request<PinSessionResponse>(`/api/webchat/sessions/${sessionId}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });
}

// ── Message Management ────────────────────────────────────────────────────────

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
  toolCalls?: unknown;
}

/**
 * Send a message
 */
export async function sendMessage(
  sessionId: string,
  text: string
): Promise<{ messageId: string; timestamp: string }> {
  const response = await request<SendMessageResponse>('/api/webchat/messages/send', {
    method: 'POST',
    body: JSON.stringify({ sessionId, text }),
  });

  return response;
}

/**
 * Get messages for a session (with pagination)
 */
export async function getMessages(
  sessionId: string,
  params?: { limit?: number; offset?: number }
): Promise<{ messages: Message[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));

  const qs = query.toString();
  const response = await request<GetMessagesResponse>(
    `/api/webchat/messages/${sessionId}${qs ? `?${qs}` : ''}`
  );

  return response;
}

// ── Real-time Message Stream ──────────────────────────────────────────────────

export interface SSEMessage {
  data: StreamedMessage;
  event: 'message';
}

export interface SSEStatus {
  data: {
    type: 'connected' | 'thinking' | 'tool' | 'done' | 'error';
    sessionId?: string;
    userId?: string;
    tool?: string;
    error?: string;
  };
  event: 'status';
}

export type SSEEvent = SSEMessage | SSEStatus;

export interface MessageSubscription {
  unsubscribe: () => void;
  reconnect: () => void;
  isConnected: () => boolean;
}

/**
 * Subscribe to real-time messages for a session
 *
 * @param sessionId - Session to subscribe to
 * @param onMessage - Callback for new messages
 * @param onStatus - Optional callback for status updates
 * @param onError - Optional callback for errors
 * @returns Subscription object with unsubscribe method
 */
export function subscribeToMessages(
  sessionId: string,
  onMessage: (message: StreamedMessage) => void,
  options?: {
    onStatus?: (status: SSEStatus['data']) => void;
    onError?: (error: Error) => void;
    onConnect?: () => void;
    autoReconnect?: boolean;
  }
): MessageSubscription {
  let eventSource: EventSource | null = null;
  let reconnectTimeout: number | null = null;
  let reconnectAttempts = 0;
  const maxReconnectDelay = 8000; // 8 seconds max
  const autoReconnect = options?.autoReconnect !== false;

  function connect() {
    if (eventSource) {
      eventSource.close();
    }

    const url = `${BASE}/api/webchat/messages/${sessionId}/stream`;
    eventSource = new EventSource(url);

    eventSource.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data) as StreamedMessage;
        onMessage(data);
        reconnectAttempts = 0; // Reset on successful message
      } catch (err) {
        console.error('[webchat] Error parsing message:', err);
        options?.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data) as SSEStatus['data'];

        if (data.type === 'connected') {
          options?.onConnect?.();
        }

        options?.onStatus?.(data);
      } catch (err) {
        console.error('[webchat] Error parsing status:', err);
      }
    });

    eventSource.addEventListener('error', (e) => {
      console.error('[webchat] SSE connection error:', e);

      if (eventSource?.readyState === EventSource.CLOSED) {
        const error = new Error('SSE connection closed');
        options?.onError?.(error);

        // Auto-reconnect with exponential backoff
        if (autoReconnect) {
          scheduleReconnect();
        }
      }
    });
  }

  function scheduleReconnect() {
    if (reconnectTimeout !== null) {
      return; // Already scheduled
    }

    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), maxReconnectDelay);

    console.log(`[webchat] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

    reconnectTimeout = window.setTimeout(() => {
      reconnectTimeout = null;
      connect();
    }, delay);
  }

  function unsubscribe() {
    if (reconnectTimeout !== null) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function reconnect() {
    reconnectAttempts = 0;
    connect();
  }

  function isConnected(): boolean {
    return eventSource?.readyState === EventSource.OPEN;
  }

  // Initial connection
  connect();

  return {
    unsubscribe,
    reconnect,
    isConnected,
  };
}
