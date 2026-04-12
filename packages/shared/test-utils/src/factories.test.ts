import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestSession,
  createTestMessage,
  createInboundMessage,
  createOutboundMessage,
  createToolRequest,
  createToolResponse,
  createToolResult,
  createToolCall,
  createMessageEnvelope,
  createTextBlock,
  resetFactories,
} from './factories.js';
import { SecurityTier } from '@nachos/types';

describe('factories', () => {
  beforeEach(() => {
    resetFactories();
  });

  describe('createTestSession', () => {
    it('should create a valid session with defaults', () => {
      const session = createTestSession();

      expect(session.id).toMatch(/^session-/);
      expect(session.channel).toBe('slack');
      expect(session.status).toBe('active');
      expect(session.config).toEqual({});
      expect(session.metadata).toEqual({});
      expect(session.isPinned).toBe(false);
      expect(session.isArchived).toBe(false);
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
      expect(session.lastActivity).toBeDefined();
      expect(session.userId).toMatch(/^user-/);
      expect(session.conversationId).toMatch(/^conv-/);
    });

    it('should allow overriding any field', () => {
      const session = createTestSession({
        id: 'custom-session',
        channel: 'discord',
        userId: 'U999',
        status: 'ended',
        isPinned: true,
      });

      expect(session.id).toBe('custom-session');
      expect(session.channel).toBe('discord');
      expect(session.userId).toBe('U999');
      expect(session.status).toBe('ended');
      expect(session.isPinned).toBe(true);
    });

    it('should generate unique IDs across calls', () => {
      const s1 = createTestSession();
      const s2 = createTestSession();

      expect(s1.id).not.toBe(s2.id);
      expect(s1.userId).not.toBe(s2.userId);
    });
  });

  describe('createTestMessage', () => {
    it('should create a valid message with defaults', () => {
      const msg = createTestMessage();

      expect(msg.id).toMatch(/^msg-/);
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello, Nachos!');
      expect(msg.createdAt).toBeDefined();
      expect(msg.sessionId).toMatch(/^session-/);
    });

    it('should allow overriding role and content', () => {
      const msg = createTestMessage({
        role: 'assistant',
        content: 'I am an AI',
      });

      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('I am an AI');
    });
  });

  describe('createInboundMessage', () => {
    it('should create a valid inbound message with defaults', () => {
      const msg = createInboundMessage();

      expect(msg.channel).toBe('slack');
      expect(msg.channelMessageId).toMatch(/^cmsg-/);
      expect(msg.sender.isAllowed).toBe(true);
      expect(msg.sender.name).toBe('Test User');
      expect(msg.conversation.type).toBe('dm');
      expect(msg.content.text).toBe('Hello from test');
    });

    it('should allow overriding nested fields', () => {
      const msg = createInboundMessage({
        channel: 'telegram',
        sender: { id: 'T999', name: 'Telegram User', isAllowed: false },
        conversation: { id: 'group-1', type: 'channel' },
        content: { text: 'Custom content' },
      });

      expect(msg.channel).toBe('telegram');
      expect(msg.sender.id).toBe('T999');
      expect(msg.sender.isAllowed).toBe(false);
      expect(msg.conversation.type).toBe('channel');
      expect(msg.content.text).toBe('Custom content');
    });
  });

  describe('createOutboundMessage', () => {
    it('should create a valid outbound message with defaults', () => {
      const msg = createOutboundMessage();

      expect(msg.channel).toBe('slack');
      expect(msg.conversationId).toMatch(/^conv-/);
      expect(msg.content.text).toBe('Response from assistant');
    });

    it('should allow overriding fields', () => {
      const msg = createOutboundMessage({
        channel: 'discord',
        content: { text: 'Discord reply' },
      });

      expect(msg.channel).toBe('discord');
      expect(msg.content.text).toBe('Discord reply');
    });
  });

  describe('createToolRequest', () => {
    it('should create a valid tool request with defaults', () => {
      const req = createToolRequest();

      expect(req.sessionId).toMatch(/^session-/);
      expect(req.tool).toBe('web_fetch');
      expect(req.callId).toMatch(/^call-/);
      expect(req.parameters).toEqual({});
    });

    it('should allow custom tool and parameters', () => {
      const req = createToolRequest({
        tool: 'code_runner',
        parameters: { language: 'python', code: 'print(1)' },
      });

      expect(req.tool).toBe('code_runner');
      expect(req.parameters).toEqual({ language: 'python', code: 'print(1)' });
    });
  });

  describe('createToolResponse', () => {
    it('should create a successful response by default', () => {
      const res = createToolResponse();

      expect(res.success).toBe(true);
      expect(res.result).toBe('tool result data');
      expect(res.error).toBeUndefined();
    });

    it('should allow creating a failed response', () => {
      const res = createToolResponse({
        success: false,
        result: undefined,
        error: { code: 'TIMEOUT', message: 'Tool timed out' },
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('TIMEOUT');
    });
  });

  describe('createToolResult', () => {
    it('should create a successful result with text content by default', () => {
      const result = createToolResult();

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
    });

    it('should allow custom content blocks', () => {
      const result = createToolResult({
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ],
      });

      expect(result.content).toHaveLength(2);
    });

    it('should allow creating a failed result', () => {
      const result = createToolResult({
        success: false,
        content: [],
        error: { code: 'EXEC_ERROR', message: 'Execution failed' },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXEC_ERROR');
    });
  });

  describe('createToolCall', () => {
    it('should create a valid tool call with defaults', () => {
      const call = createToolCall();

      expect(call.id).toMatch(/^call-/);
      expect(call.tool).toBe('web_fetch');
      expect(call.sessionId).toMatch(/^session-/);
      expect(call.userId).toMatch(/^user-/);
      expect(call.securityTier).toBe(SecurityTier.SAFE);
      expect(call.securityMode).toBe('standard');
      expect(call.parameters).toEqual({});
    });

    it('should allow overriding security fields', () => {
      const call = createToolCall({
        securityTier: SecurityTier.RESTRICTED,
        securityMode: 'strict',
      });

      expect(call.securityTier).toBe(SecurityTier.RESTRICTED);
      expect(call.securityMode).toBe('strict');
    });
  });

  describe('createMessageEnvelope', () => {
    it('should create a valid envelope with defaults', () => {
      const env = createMessageEnvelope();

      expect(env.id).toMatch(/^env-/);
      expect(env.source).toBe('test-component');
      expect(env.type).toBe('message');
      expect(env.timestamp).toBeDefined();
      expect(env.payload).toEqual({});
    });

    it('should allow a typed payload', () => {
      const env = createMessageEnvelope({
        payload: { action: 'test' },
        type: 'command',
      });

      expect(env.payload).toEqual({ action: 'test' });
      expect(env.type).toBe('command');
    });
  });

  describe('createTextBlock', () => {
    it('should create a text content block', () => {
      const block = createTextBlock('Hello');

      expect(block.type).toBe('text');
      expect(block).toEqual({ type: 'text', text: 'Hello' });
    });
  });

  describe('resetFactories', () => {
    it('should reset ID counter for deterministic tests', () => {
      const s1 = createTestSession();
      resetFactories();
      const s2 = createTestSession();

      // After reset, IDs should match because counter is back to 0
      expect(s1.id).toBe(s2.id);
    });
  });
});
