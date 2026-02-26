import { createLogger } from '@nachos/types';
const logger = createLogger('webchat-rpc');
export class WebChatRPCService {
    bus;
    store;
    subscriptions = [];
    constructor(bus, store) {
        this.bus = bus;
        this.store = store;
    }
    async start() {
        logger.info('Starting WebChat RPC service');
        await this.registerHandler('nachos.webchat.sessions.list', this.handleListSessions.bind(this));
        await this.registerHandler('nachos.webchat.sessions.listArchived', this.handleListArchived.bind(this));
        await this.registerHandler('nachos.webchat.sessions.create', this.handleCreateSession.bind(this));
        await this.registerHandler('nachos.webchat.sessions.archive', this.handleArchiveSession.bind(this));
        await this.registerHandler('nachos.webchat.sessions.restore', this.handleRestoreSession.bind(this));
        await this.registerHandler('nachos.webchat.sessions.delete', this.handleDeleteSession.bind(this));
        await this.registerHandler('nachos.webchat.sessions.pin', this.handlePinSession.bind(this));
        await this.registerHandler('nachos.webchat.messages.send', this.handleSendMessage.bind(this));
        await this.registerHandler('nachos.webchat.messages.get', this.handleGetMessages.bind(this));
        logger.info('WebChat RPC service started');
    }
    async stop() {
        logger.info('Stopping WebChat RPC service');
        for (const sub of this.subscriptions) {
            sub.unsubscribe();
        }
        this.subscriptions = [];
        logger.info('WebChat RPC service stopped');
    }
    async registerHandler(topic, handler) {
        const sub = await this.bus.subscribe(topic, handler);
        this.subscriptions.push(sub);
        logger.debug({ topic }, 'Registered RPC handler');
    }
    generateSessionName() {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().substring(0, 5);
        return `Session ${dateStr} ${timeStr}`;
    }
    async handleListSessions(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling listSessions');
            const sessions = await this.store.listActive({
                channel: request.channel,
                userId: request.userId,
                limit: request.limit,
                offset: request.offset,
            });
            const response = {
                sessions: await Promise.all(sessions.map(async (session) => ({
                    id: session.id,
                    name: this.generateSessionName(),
                    lastActivity: session.lastActivity,
                    messageCount: await this.store.getMessageCount(session.id),
                    isPinned: session.isPinned,
                }))),
            };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleListSessions');
            rawMsg.respond({ error: 'Failed to list sessions' });
        }
    }
    async handleListArchived(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling listArchived');
            const sessions = await this.store.listArchived({
                channel: request.channel,
                userId: request.userId,
                search: request.search,
                limit: request.limit,
                offset: request.offset,
            });
            const response = {
                sessions: await Promise.all(sessions.map(async (session) => ({
                    id: session.id,
                    name: this.generateSessionName(),
                    archivedAt: session.updatedAt,
                    messageCount: await this.store.getMessageCount(session.id),
                }))),
                total: sessions.length,
            };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleListArchived');
            rawMsg.respond({ error: 'Failed to list archived sessions' });
        }
    }
    async handleCreateSession(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling createSession');
            const conversationId = request.conversationId || `webchat-${Date.now()}`;
            const session = await this.store.createSession({
                channel: request.channel,
                conversationId,
                userId: request.userId,
                systemPrompt: request.systemPrompt,
            });
            const response = {
                session: {
                    id: session.id,
                    name: this.generateSessionName(),
                    createdAt: session.createdAt,
                },
            };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleCreateSession');
            rawMsg.respond({ error: 'Failed to create session' });
        }
    }
    async handleArchiveSession(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling archiveSession');
            const session = await this.store.getSession(request.sessionId);
            if (!session || session.userId !== request.userId) {
                rawMsg.respond({ error: 'Session not found or access denied' });
                return;
            }
            const ok = await this.store.archive(request.sessionId);
            const response = { ok };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleArchiveSession');
            rawMsg.respond({ error: 'Failed to archive session' });
        }
    }
    async handleRestoreSession(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling restoreSession');
            const session = await this.store.getSession(request.sessionId);
            if (!session || session.userId !== request.userId) {
                rawMsg.respond({ error: 'Session not found or access denied' });
                return;
            }
            const ok = await this.store.restore(request.sessionId);
            const response = { ok };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleRestoreSession');
            rawMsg.respond({ error: 'Failed to restore session' });
        }
    }
    async handleDeleteSession(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling deleteSession');
            const session = await this.store.getSession(request.sessionId);
            if (!session || session.userId !== request.userId) {
                rawMsg.respond({ error: 'Session not found or access denied' });
                return;
            }
            const ok = await this.store.deleteSession(request.sessionId);
            const response = { ok };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleDeleteSession');
            rawMsg.respond({ error: 'Failed to delete session' });
        }
    }
    async handlePinSession(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling pinSession');
            const session = await this.store.getSession(request.sessionId);
            if (!session || session.userId !== request.userId) {
                rawMsg.respond({ error: 'Session not found or access denied' });
                return;
            }
            const ok = await this.store.pin(request.sessionId, request.pinned);
            const response = { ok };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handlePinSession');
            rawMsg.respond({ error: 'Failed to pin session' });
        }
    }
    async handleSendMessage(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling sendMessage');
            const session = await this.store.getSession(request.sessionId);
            if (!session || session.userId !== request.userId) {
                rawMsg.respond({ error: 'Session not found or access denied' });
                return;
            }
            const message = await this.store.addMessage({
                sessionId: request.sessionId,
                role: 'user',
                content: request.text,
            });
            const streamedMessage = {
                id: message.id,
                sessionId: message.sessionId,
                role: message.role,
                content: message.content,
                timestamp: message.createdAt,
                toolCalls: message.toolCalls,
            };
            this.bus.publish(`nachos.webchat.messages.${request.sessionId}`, streamedMessage);
            const response = {
                messageId: message.id,
                timestamp: message.createdAt,
            };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleSendMessage');
            rawMsg.respond({ error: 'Failed to send message' });
        }
    }
    async handleGetMessages(envelope, rawMsg) {
        try {
            const request = envelope.payload;
            logger.debug({ request }, 'Handling getMessages');
            const session = await this.store.getSession(request.sessionId);
            if (!session || session.userId !== request.userId) {
                rawMsg.respond({ error: 'Session not found or access denied' });
                return;
            }
            const messages = await this.store.getMessages(request.sessionId, {
                limit: request.limit,
                offset: request.offset,
            });
            const total = await this.store.getMessageCount(request.sessionId);
            const response = {
                messages,
                total,
            };
            rawMsg.respond(response);
        }
        catch (error) {
            logger.error({ err: error }, 'Error in handleGetMessages');
            rawMsg.respond({ error: 'Failed to get messages' });
        }
    }
    publishMessage(sessionId, message) {
        this.bus.publish(`nachos.webchat.messages.${sessionId}`, message);
    }
}
//# sourceMappingURL=webchat-rpc-service.js.map