/**
 * WebChat RPC Types
 *
 * Type definitions for WebChat RPC requests and responses.
 * These mirror the types defined in the WebChatRPCService.
 */

import type { Message } from '@nachos/types';

export interface ListSessionsResponse {
  sessions: Array<{
    id: string;
    name: string;
    lastActivity: string;
    messageCount: number;
    isPinned: boolean;
  }>;
}

export interface ListArchivedResponse {
  sessions: Array<{
    id: string;
    name: string;
    archivedAt: string;
    messageCount: number;
  }>;
  total: number;
}

export interface CreateSessionResponse {
  session: {
    id: string;
    name: string;
    createdAt: string;
  };
}

export interface ArchiveSessionResponse {
  ok: boolean;
}

export interface RestoreSessionResponse {
  ok: boolean;
}

export interface DeleteSessionResponse {
  ok: boolean;
}

export interface PinSessionResponse {
  ok: boolean;
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: string;
}

export interface GetMessagesResponse {
  messages: Message[];
  total: number;
}

export interface StreamedMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: unknown;
}
