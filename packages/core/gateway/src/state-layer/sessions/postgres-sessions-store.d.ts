import type { Pool } from 'pg';
import type { Session, SessionStatus, Message, SessionWithMessages } from '@nachos/types';
import type { CreateSessionData, UpdateSessionData, CreateMessageData } from './sessions-store-interface.js';
export declare class PostgresSessionsStore {
    private pool;
    private initialized;
    private schemaPromise;
    private schema;
    constructor(pool: Pool, schema?: string);
    private ensureSchema;
    private runSchema;
    private qualified;
    private rowToSession;
    private rowToMessage;
    createSession(data: CreateSessionData): Promise<Session>;
    getOrCreateSessionAtomic(data: CreateSessionData): Promise<{
        session: Session;
        created: boolean;
    }>;
    getSession(id: string): Promise<Session | null>;
    getSessionByConversation(channel: string, conversationId: string): Promise<Session | null>;
    updateSession(id: string, data: UpdateSessionData): Promise<Session | null>;
    deleteSession(id: string): Promise<boolean>;
    listSessions(options?: {
        channel?: string;
        status?: SessionStatus;
        limit?: number;
        offset?: number;
    }): Promise<Session[]>;
    addMessage(data: CreateMessageData): Promise<Message>;
    getMessages(sessionId: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<Message[]>;
    getSessionWithMessages(id: string): Promise<SessionWithMessages | null>;
    getMessageCount(sessionId: string): Promise<number>;
    replaceMessages(sessionId: string, messages: Message[]): Promise<number>;
    listActive(options?: {
        channel?: string;
        userId?: string;
        limit?: number;
        offset?: number;
    }): Promise<Session[]>;
    listArchived(options?: {
        channel?: string;
        userId?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<Session[]>;
    archive(sessionId: string): Promise<boolean>;
    restore(sessionId: string): Promise<boolean>;
    pin(sessionId: string, pinned: boolean): Promise<boolean>;
    close(): Promise<void>;
}
//# sourceMappingURL=postgres-sessions-store.d.ts.map