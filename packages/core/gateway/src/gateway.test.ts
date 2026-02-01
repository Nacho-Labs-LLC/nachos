import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gateway } from './gateway.js';
import type { ChannelInboundMessage } from '@nachos/types';

describe('Gateway', () => {
  let gateway: Gateway;

  beforeEach(() => {
    gateway = new Gateway({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
    }
  });

  describe('constructor', () => {
    it('should create a gateway with default options', () => {
      expect(gateway).toBeDefined();
      expect(gateway.getSessionManager()).toBeDefined();
      expect(gateway.getRouter()).toBeDefined();
      expect(gateway.getStorage()).toBeDefined();
    });

    it('should create a gateway with custom system prompt', () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'You are a custom assistant',
      });

      expect(customGateway).toBeDefined();

      // Clean up
      customGateway.getStorage().close();
    });
  });

  describe('start/stop', () => {
    it('should start and stop without errors', async () => {
      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await gateway.start();

      // Gateway should be connected
      const health = gateway.getHealth();
      expect(health.status).toBe('healthy');

      await gateway.stop();
    });

    it('should start on specified health port', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        healthPort: 9001,
      });

      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await customGateway.start();

      // Verify health endpoint is accessible
      const response = await fetch('http://localhost:9001/health');
      expect(response.status).toBe(200);

      await customGateway.stop();
    });
  });

  describe('processMessage', () => {
    it('should create a session for new conversation', async () => {
      const message: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: { text: 'Hello!' },
      };

      const session = await gateway.processMessage(message);

      expect(session).toBeDefined();
      expect(session.channel).toBe('slack');
      expect(session.conversationId).toBe('conv-789');
      expect(session.userId).toBe('user-456');
      expect(session.status).toBe('active');
    });

    it('should reuse existing session for same conversation', async () => {
      const message1: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-1',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: { text: 'Hello!' },
      };

      const message2: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-2',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: { text: 'How are you?' },
      };

      const session1 = await gateway.processMessage(message1);
      const session2 = await gateway.processMessage(message2);

      expect(session2.id).toBe(session1.id);
    });

    it('should store user message in session', async () => {
      const message: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: { text: 'Hello!' },
      };

      const session = await gateway.processMessage(message);
      const messages = gateway.getSessionManager().getMessages(session.id);

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hello!');
    });

    it('should handle message without text content', async () => {
      const message: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: {
          attachments: [{ type: 'image', url: 'https://example.com/image.png' }],
        },
      };

      const session = await gateway.processMessage(message);

      // Session should be created even without text
      expect(session).toBeDefined();

      // No message should be added (no text content)
      const messages = gateway.getSessionManager().getMessages(session.id);
      expect(messages).toHaveLength(0);
    });

    it('should use default system prompt for new sessions', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'You are a helpful assistant',
      });

      const message: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: { text: 'Hello!' },
      };

      const session = await customGateway.processMessage(message);

      expect(session.systemPrompt).toBe('You are a helpful assistant');

      customGateway.getStorage().close();
    });
  });

  describe('getHealth', () => {
    it('should return database check as ok', () => {
      const health = gateway.getHealth();

      expect(health.component).toBe('gateway');
      expect(health.checks.database).toBe('ok');
    });

    it('should return healthy status when started', async () => {
      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await gateway.start();

      const health = gateway.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.checks.bus).toBe('ok');
    });

    it('should return unhealthy status when not started (bus disconnected)', () => {
      const health = gateway.getHealth();

      // Bus is not connected until start() is called
      expect(health.checks.bus).toBe('error');
      expect(health.status).toBe('unhealthy');
    });
  });

  describe('SessionManager access', () => {
    it('should provide access to session manager', () => {
      const sessionManager = gateway.getSessionManager();

      const session = sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session).toBeDefined();
      expect(session.channel).toBe('slack');
    });
  });

  describe('Router access', () => {
    it('should provide access to router', () => {
      const router = gateway.getRouter();

      expect(router).toBeDefined();
      expect(typeof router.subscribe).toBe('function');
      expect(typeof router.sendToChannel).toBe('function');
    });

    it('should register custom handlers', async () => {
      const router = gateway.getRouter();
      const handler = vi.fn().mockResolvedValue(undefined);

      router.registerHandler('custom.message', handler);

      const retrievedHandler = router.getHandler('custom.message');
      expect(retrievedHandler).toBe(handler);
    });
  });

  describe('Storage access', () => {
    it('should provide access to storage', () => {
      const storage = gateway.getStorage();

      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    });
  });
});
