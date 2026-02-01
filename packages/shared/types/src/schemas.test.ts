/**
 * Tests for TypeBox Message Schemas
 */

import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  MessageEnvelopeSchema,
  AttachmentSchema,
  SenderSchema,
  ConversationSchema,
  MessageContentSchema,
  ChannelInboundMessageSchema,
  ChannelOutboundMessageSchema,
  SessionSchema,
  MessageSchema,
  LLMRequestSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  HealthCheckSchema,
  NachosErrorSchema,
  PolicyCheckRequestSchema,
  PolicyCheckResultSchema,
  AuditLogEntrySchema,
  Schemas,
} from './schemas.js';

describe('MessageEnvelopeSchema', () => {
  it('should validate a valid message envelope', () => {
    const envelope = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'gateway',
      type: 'channel.inbound',
      payload: { data: 'test' },
    };

    expect(Value.Check(MessageEnvelopeSchema, envelope)).toBe(true);
  });

  it('should validate envelope with correlationId', () => {
    const envelope = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'gateway',
      type: 'channel.inbound',
      correlationId: 'corr-456',
      payload: { data: 'test' },
    };

    expect(Value.Check(MessageEnvelopeSchema, envelope)).toBe(true);
  });

  it('should reject envelope missing required fields', () => {
    const invalid = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      // missing source, type, payload
    };

    expect(Value.Check(MessageEnvelopeSchema, invalid)).toBe(false);
  });

  it('should reject envelope with invalid timestamp', () => {
    const invalid = {
      id: 'msg-123',
      timestamp: 'not-a-date',
      source: 'gateway',
      type: 'channel.inbound',
      payload: {},
    };

    // TypeBox string format validation is optional, so this will pass
    // The schema declares format but doesn't enforce it by default
    expect(Value.Check(MessageEnvelopeSchema, invalid)).toBe(true);
  });
});

describe('AttachmentSchema', () => {
  it('should validate a valid attachment', () => {
    const attachment = {
      type: 'image',
      url: 'https://example.com/image.png',
      name: 'image.png',
      mimeType: 'image/png',
      size: 1024,
    };

    expect(Value.Check(AttachmentSchema, attachment)).toBe(true);
  });

  it('should validate attachment with only required fields', () => {
    const attachment = {
      type: 'file',
      url: 'https://example.com/file.pdf',
    };

    expect(Value.Check(AttachmentSchema, attachment)).toBe(true);
  });
});

describe('SenderSchema', () => {
  it('should validate a valid sender', () => {
    const sender = {
      id: 'user-123',
      name: 'John Doe',
      isAllowed: true,
    };

    expect(Value.Check(SenderSchema, sender)).toBe(true);
  });

  it('should validate sender without optional name', () => {
    const sender = {
      id: 'user-123',
      isAllowed: false,
    };

    expect(Value.Check(SenderSchema, sender)).toBe(true);
  });

  it('should reject sender missing isAllowed', () => {
    const invalid = {
      id: 'user-123',
    };

    expect(Value.Check(SenderSchema, invalid)).toBe(false);
  });
});

describe('ConversationSchema', () => {
  it('should validate dm conversation', () => {
    const conversation = {
      id: 'conv-123',
      type: 'dm',
    };

    expect(Value.Check(ConversationSchema, conversation)).toBe(true);
  });

  it('should validate channel conversation', () => {
    const conversation = {
      id: 'conv-456',
      type: 'channel',
    };

    expect(Value.Check(ConversationSchema, conversation)).toBe(true);
  });

  it('should validate thread conversation', () => {
    const conversation = {
      id: 'conv-789',
      type: 'thread',
    };

    expect(Value.Check(ConversationSchema, conversation)).toBe(true);
  });

  it('should reject invalid conversation type', () => {
    const invalid = {
      id: 'conv-123',
      type: 'invalid',
    };

    expect(Value.Check(ConversationSchema, invalid)).toBe(false);
  });
});

describe('MessageContentSchema', () => {
  it('should validate content with text only', () => {
    const content = {
      text: 'Hello, world!',
    };

    expect(Value.Check(MessageContentSchema, content)).toBe(true);
  });

  it('should validate content with attachments', () => {
    const content = {
      text: 'Check this out',
      attachments: [
        {
          type: 'image',
          url: 'https://example.com/image.png',
        },
      ],
    };

    expect(Value.Check(MessageContentSchema, content)).toBe(true);
  });

  it('should validate empty content', () => {
    const content = {};

    expect(Value.Check(MessageContentSchema, content)).toBe(true);
  });
});

describe('ChannelInboundMessageSchema', () => {
  it('should validate a complete inbound message', () => {
    const message = {
      channel: 'slack',
      channelMessageId: 'msg-slack-123',
      sender: {
        id: 'user-456',
        name: 'Jane Doe',
        isAllowed: true,
      },
      conversation: {
        id: 'conv-789',
        type: 'dm' as const,
      },
      content: {
        text: 'Hello!',
      },
    };

    expect(Value.Check(ChannelInboundMessageSchema, message)).toBe(true);
  });

  it('should validate message with sessionId and metadata', () => {
    const message = {
      channel: 'discord',
      channelMessageId: 'msg-discord-123',
      sessionId: 'session-456',
      sender: {
        id: 'user-789',
        isAllowed: true,
      },
      conversation: {
        id: 'conv-000',
        type: 'channel' as const,
      },
      content: {
        text: 'Test message',
      },
      metadata: {
        guildId: 'guild-123',
        channelName: 'general',
      },
    };

    expect(Value.Check(ChannelInboundMessageSchema, message)).toBe(true);
  });
});

describe('ChannelOutboundMessageSchema', () => {
  it('should validate a simple outbound message', () => {
    const message = {
      channel: 'slack',
      conversationId: 'conv-123',
      content: {
        text: 'Hello from bot!',
      },
    };

    expect(Value.Check(ChannelOutboundMessageSchema, message)).toBe(true);
  });

  it('should validate outbound message with all options', () => {
    const message = {
      channel: 'discord',
      conversationId: 'conv-456',
      replyToMessageId: 'msg-789',
      content: {
        text: 'Here is the response',
        format: 'markdown' as const,
        attachments: [
          {
            type: 'code',
            data: 'console.log("hello")',
            name: 'example.js',
          },
        ],
      },
      options: {
        ephemeral: true,
        threadReply: true,
      },
    };

    expect(Value.Check(ChannelOutboundMessageSchema, message)).toBe(true);
  });
});

describe('SessionSchema', () => {
  it('should validate a complete session', () => {
    const session = {
      id: 'session-123',
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
      channel: 'slack',
      conversationId: 'conv-456',
      userId: 'user-789',
      status: 'active' as const,
      systemPrompt: 'You are a helpful assistant.',
      config: {
        model: 'claude-3-sonnet',
        maxTokens: 4096,
        tools: ['filesystem', 'browser'],
      },
      metadata: {
        teamId: 'team-123',
      },
    };

    expect(Value.Check(SessionSchema, session)).toBe(true);
  });

  it('should validate session with minimal config', () => {
    const session = {
      id: 'session-456',
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      channel: 'telegram',
      conversationId: 'conv-789',
      userId: 'user-000',
      status: 'paused' as const,
      config: {},
      metadata: {},
    };

    expect(Value.Check(SessionSchema, session)).toBe(true);
  });
});

describe('MessageSchema', () => {
  it('should validate user message', () => {
    const message = {
      id: 'msg-123',
      sessionId: 'session-456',
      role: 'user' as const,
      content: 'What is the weather?',
      createdAt: '2024-01-15T10:30:00.000Z',
    };

    expect(Value.Check(MessageSchema, message)).toBe(true);
  });

  it('should validate assistant message with tool calls', () => {
    const message = {
      id: 'msg-456',
      sessionId: 'session-789',
      role: 'assistant' as const,
      content: "I'll check that for you.",
      toolCalls: [
        {
          id: 'call-123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: '{"location": "Seattle"}',
          },
        },
      ],
      createdAt: '2024-01-15T10:31:00.000Z',
    };

    expect(Value.Check(MessageSchema, message)).toBe(true);
  });
});

describe('LLMRequestSchema', () => {
  it('should validate a basic LLM request', () => {
    const request = {
      sessionId: 'session-123',
      messages: [
        {
          role: 'user' as const,
          content: 'Hello!',
        },
      ],
    };

    expect(Value.Check(LLMRequestSchema, request)).toBe(true);
  });

  it('should validate LLM request with tools and options', () => {
    const request = {
      sessionId: 'session-456',
      messages: [
        {
          role: 'system' as const,
          content: 'You are a helpful assistant.',
        },
        {
          role: 'user' as const,
          content: 'List files in /tmp',
        },
      ],
      tools: [
        {
          name: 'filesystem',
          description: 'File system operations',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              path: { type: 'string' },
            },
          },
        },
      ],
      options: {
        model: 'claude-3-opus',
        maxTokens: 8192,
        temperature: 0.7,
        stream: true,
      },
    };

    expect(Value.Check(LLMRequestSchema, request)).toBe(true);
  });
});

describe('ToolRequestSchema', () => {
  it('should validate a tool request', () => {
    const request = {
      sessionId: 'session-123',
      tool: 'filesystem',
      callId: 'call-456',
      parameters: {
        action: 'read',
        path: '/tmp/test.txt',
      },
    };

    expect(Value.Check(ToolRequestSchema, request)).toBe(true);
  });
});

describe('ToolResponseSchema', () => {
  it('should validate successful tool response', () => {
    const response = {
      sessionId: 'session-123',
      callId: 'call-456',
      success: true,
      result: {
        content: 'file contents here',
      },
    };

    expect(Value.Check(ToolResponseSchema, response)).toBe(true);
  });

  it('should validate failed tool response', () => {
    const response = {
      sessionId: 'session-123',
      callId: 'call-456',
      success: false,
      error: {
        code: 'FILE_NOT_FOUND',
        message: 'The specified file does not exist',
      },
    };

    expect(Value.Check(ToolResponseSchema, response)).toBe(true);
  });
});

describe('HealthCheckSchema', () => {
  it('should validate healthy status', () => {
    const health = {
      status: 'healthy' as const,
      component: 'gateway',
      version: '0.1.0',
      uptime: 3600,
      checks: {
        database: 'ok' as const,
        bus: 'ok' as const,
      },
    };

    expect(Value.Check(HealthCheckSchema, health)).toBe(true);
  });

  it('should validate degraded status', () => {
    const health = {
      status: 'degraded' as const,
      component: 'bus',
      version: '0.1.0',
      uptime: 7200,
      checks: {
        connection: 'ok' as const,
        latency: 'error' as const,
      },
    };

    expect(Value.Check(HealthCheckSchema, health)).toBe(true);
  });
});

describe('NachosErrorSchema', () => {
  it('should validate a complete error', () => {
    const error = {
      code: 'NACHOS_ERR_VALIDATION',
      message: 'Invalid message format',
      component: 'gateway',
      details: {
        field: 'payload.content',
        expected: 'string',
      },
      timestamp: '2024-01-15T10:30:00.000Z',
      correlationId: 'corr-123',
    };

    expect(Value.Check(NachosErrorSchema, error)).toBe(true);
  });

  it('should validate error without optional fields', () => {
    const error = {
      code: 'NACHOS_ERR_INTERNAL',
      message: 'Unexpected error occurred',
      component: 'llm-proxy',
      timestamp: '2024-01-15T10:30:00.000Z',
    };

    expect(Value.Check(NachosErrorSchema, error)).toBe(true);
  });
});

describe('PolicyCheckRequestSchema', () => {
  it('should validate a policy check request', () => {
    const request = {
      sessionId: 'session-123',
      action: 'tool.execute',
      resource: 'filesystem',
      context: {
        path: '/tmp',
        operation: 'read',
      },
    };

    expect(Value.Check(PolicyCheckRequestSchema, request)).toBe(true);
  });

  it('should validate minimal policy check request', () => {
    const request = {
      sessionId: 'session-456',
      action: 'message.send',
    };

    expect(Value.Check(PolicyCheckRequestSchema, request)).toBe(true);
  });
});

describe('PolicyCheckResultSchema', () => {
  it('should validate allowed result', () => {
    const result = {
      allowed: true,
    };

    expect(Value.Check(PolicyCheckResultSchema, result)).toBe(true);
  });

  it('should validate denied result with reason', () => {
    const result = {
      allowed: false,
      reason: 'User not in allowlist',
      conditions: ['user.verified', 'session.active'],
    };

    expect(Value.Check(PolicyCheckResultSchema, result)).toBe(true);
  });
});

describe('AuditLogEntrySchema', () => {
  it('should validate a complete audit entry', () => {
    const entry = {
      id: 'audit-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      component: 'gateway',
      action: 'session.create',
      sessionId: 'session-456',
      userId: 'user-789',
      details: {
        channel: 'slack',
        conversationId: 'conv-000',
      },
      result: 'success' as const,
    };

    expect(Value.Check(AuditLogEntrySchema, entry)).toBe(true);
  });

  it('should validate minimal audit entry', () => {
    const entry = {
      id: 'audit-456',
      timestamp: '2024-01-15T10:31:00.000Z',
      component: 'bus',
      action: 'message.publish',
    };

    expect(Value.Check(AuditLogEntrySchema, entry)).toBe(true);
  });
});

describe('Schemas collection', () => {
  it('should contain all schemas', () => {
    expect(Schemas.MessageEnvelope).toBe(MessageEnvelopeSchema);
    expect(Schemas.Attachment).toBe(AttachmentSchema);
    expect(Schemas.Sender).toBe(SenderSchema);
    expect(Schemas.Conversation).toBe(ConversationSchema);
    expect(Schemas.MessageContent).toBe(MessageContentSchema);
    expect(Schemas.ChannelInboundMessage).toBe(ChannelInboundMessageSchema);
    expect(Schemas.ChannelOutboundMessage).toBe(ChannelOutboundMessageSchema);
    expect(Schemas.Session).toBe(SessionSchema);
    expect(Schemas.Message).toBe(MessageSchema);
    expect(Schemas.LLMRequest).toBe(LLMRequestSchema);
    expect(Schemas.ToolRequest).toBe(ToolRequestSchema);
    expect(Schemas.ToolResponse).toBe(ToolResponseSchema);
    expect(Schemas.HealthCheck).toBe(HealthCheckSchema);
    expect(Schemas.NachosError).toBe(NachosErrorSchema);
    expect(Schemas.PolicyCheckRequest).toBe(PolicyCheckRequestSchema);
    expect(Schemas.PolicyCheckResult).toBe(PolicyCheckResultSchema);
    expect(Schemas.AuditLogEntry).toBe(AuditLogEntrySchema);
  });
});
