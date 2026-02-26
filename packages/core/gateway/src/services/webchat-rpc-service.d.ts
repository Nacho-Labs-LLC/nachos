import type { NachosBusClient } from '@nachos/bus';
import type { PostgresSessionsStore } from '../state-layer/sessions/postgres-sessions-store.js';
import type { Message } from '@nachos/types';
export interface ListSessionsRequest {
    userId: string;
    channel?: string;
    limit?: number;
    offset?: number;
}
export interface ListSessionsResponse {
    sessions: Array<{
        id: string;
        name: string;
        lastActivity: string;
        messageCount: number;
        isPinned: boolean;
    }>;
}
export interface ListArchivedRequest {
    userId: string;
    channel?: string;
    search?: string;
    limit?: number;
    offset?: number;
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
export interface CreateSessionRequest {
    userId: string;
    channel: string;
    conversationId?: string;
    systemPrompt?: string;
}
export interface CreateSessionResponse {
    session: {
        id: string;
        name: string;
        createdAt: string;
    };
}
export interface ArchiveSessionRequest {
    sessionId: string;
    userId: string;
}
export interface ArchiveSessionResponse {
    ok: boolean;
}
export interface RestoreSessionRequest {
    sessionId: string;
    userId: string;
}
export interface RestoreSessionResponse {
    ok: boolean;
}
export interface DeleteSessionRequest {
    sessionId: string;
    userId: string;
}
export interface DeleteSessionResponse {
    ok: boolean;
}
export interface PinSessionRequest {
    sessionId: string;
    userId: string;
    pinned: boolean;
}
export interface PinSessionResponse {
    ok: boolean;
}
export interface SendMessageRequest {
    sessionId: string;
    userId: string;
    text: string;
}
export interface SendMessageResponse {
    messageId: string;
    timestamp: string;
}
export interface GetMessagesRequest {
    sessionId: string;
    userId: string;
    limit?: number;
    offset?: number;
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
export declare class WebChatRPCService {
    private bus;
    private store;
    private subscriptions;
    constructor(bus: NachosBusClient, store: PostgresSessionsStore);
    start(): Promise<void>;
    stop(): Promise<void>;
    private registerHandler;
    private generateSessionName;
    private handleListSessions;
    private handleListArchived;
    private handleCreateSession;
    private handleArchiveSession;
    private handleRestoreSession;
    private handleDeleteSession;
    private handlePinSession;
    private handleSendMessage;
    private handleGetMessages;
    publishMessage(sessionId: string, message: StreamedMessage): void;
}
//# sourceMappingURL=webchat-rpc-service.d.ts.map