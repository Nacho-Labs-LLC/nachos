/**
 * Tests for Message Validation Middleware
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validate,
  validateOrThrow,
  isValid,
  clean,
  validateMessageEnvelope,
  validateChannelInboundMessage,
  validateChannelOutboundMessage,
  validateLLMRequest,
  validateToolRequest,
  validateToolResponse,
  createValidatedHandler,
  withValidation,
} from './validation.js';
import { ChannelInboundMessageSchema, SessionSchema } from './schemas.js';
import { Type } from '@sinclair/typebox';

describe('validate', () => {
  it('should return success for valid data', () => {
    const schema = Type.Object({
      name: Type.String(),
      age: Type.Number(),
    });

    const result = validate(schema, { name: 'John', age: 30 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'John', age: 30 });
    expect(result.errors).toBeUndefined();
  });

  it('should return errors for invalid data', () => {
    const schema = Type.Object({
      name: Type.String(),
      age: Type.Number(),
    });

    const result = validate(schema, { name: 'John', age: 'thirty' });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should return errors for missing required fields', () => {
    const schema = Type.Object({
      name: Type.String(),
      age: Type.Number(),
    });

    const result = validate(schema, { name: 'John' });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

describe('validateOrThrow', () => {
  it('should return data for valid input', () => {
    const schema = Type.Object({
      id: Type.String(),
    });

    const data = validateOrThrow(schema, { id: 'test-123' });
    expect(data).toEqual({ id: 'test-123' });
  });

  it('should throw for invalid input', () => {
    const schema = Type.Object({
      id: Type.String(),
    });

    expect(() => validateOrThrow(schema, { id: 123 })).toThrow('Validation failed');
  });
});

describe('isValid', () => {
  it('should return true for valid data', () => {
    const schema = Type.Object({
      value: Type.Boolean(),
    });

    expect(isValid(schema, { value: true })).toBe(true);
  });

  it('should return false for invalid data', () => {
    const schema = Type.Object({
      value: Type.Boolean(),
    });

    expect(isValid(schema, { value: 'yes' })).toBe(false);
  });

  it('should act as type guard', () => {
    const schema = Type.Object({
      name: Type.String(),
    });

    const data: unknown = { name: 'test' };

    if (isValid(schema, data)) {
      // TypeScript should know data.name is a string here
      expect(data.name.toUpperCase()).toBe('TEST');
    } else {
      // Should not reach here
      expect(true).toBe(false);
    }
  });
});

describe('clean', () => {
  it('should remove extra properties', () => {
    const schema = Type.Object({
      id: Type.String(),
    });

    const result = clean(schema, { id: 'test', extra: 'field' });
    expect(result).toEqual({ id: 'test' });
  });
});

describe('validateMessageEnvelope', () => {
  it('should validate a valid envelope', () => {
    const envelope = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'gateway',
      type: 'test',
      payload: { data: 'test' },
    };

    const result = validateMessageEnvelope(envelope);
    expect(result.success).toBe(true);
  });

  it('should reject invalid envelope', () => {
    const invalid = {
      id: 'msg-123',
      // missing required fields
    };

    const result = validateMessageEnvelope(invalid);
    expect(result.success).toBe(false);
  });
});

describe('validateChannelInboundMessage', () => {
  it('should validate a valid inbound message', () => {
    const message = {
      channel: 'slack',
      channelMessageId: 'msg-123',
      sender: {
        id: 'user-456',
        isAllowed: true,
      },
      conversation: {
        id: 'conv-789',
        type: 'dm',
      },
      content: {
        text: 'Hello!',
      },
    };

    const result = validateChannelInboundMessage(message);
    expect(result.success).toBe(true);
  });

  it('should reject invalid inbound message', () => {
    const invalid = {
      channel: 'slack',
      // missing required fields
    };

    const result = validateChannelInboundMessage(invalid);
    expect(result.success).toBe(false);
  });
});

describe('validateChannelOutboundMessage', () => {
  it('should validate a valid outbound message', () => {
    const message = {
      channel: 'slack',
      conversationId: 'conv-123',
      content: {
        text: 'Hello from bot!',
      },
    };

    const result = validateChannelOutboundMessage(message);
    expect(result.success).toBe(true);
  });
});

describe('validateLLMRequest', () => {
  it('should validate a valid LLM request', () => {
    const request = {
      sessionId: 'session-123',
      messages: [
        {
          role: 'user',
          content: 'Hello!',
        },
      ],
    };

    const result = validateLLMRequest(request);
    expect(result.success).toBe(true);
  });
});

describe('validateToolRequest', () => {
  it('should validate a valid tool request', () => {
    const request = {
      sessionId: 'session-123',
      tool: 'filesystem',
      callId: 'call-456',
      parameters: {
        action: 'read',
        path: '/tmp/test.txt',
      },
    };

    const result = validateToolRequest(request);
    expect(result.success).toBe(true);
  });
});

describe('validateToolResponse', () => {
  it('should validate a successful tool response', () => {
    const response = {
      sessionId: 'session-123',
      callId: 'call-456',
      success: true,
      result: { content: 'file data' },
    };

    const result = validateToolResponse(response);
    expect(result.success).toBe(true);
  });

  it('should validate a failed tool response', () => {
    const response = {
      sessionId: 'session-123',
      callId: 'call-456',
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'File not found',
      },
    };

    const result = validateToolResponse(response);
    expect(result.success).toBe(true);
  });
});

describe('createValidatedHandler', () => {
  it('should call handler with validated data', async () => {
    const handler = vi.fn();

    const validatedHandler = createValidatedHandler(ChannelInboundMessageSchema, handler);

    const envelope = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'channel-slack',
      type: 'channel.inbound',
      payload: {
        channel: 'slack',
        channelMessageId: 'msg-slack-123',
        sender: {
          id: 'user-456',
          isAllowed: true,
        },
        conversation: {
          id: 'conv-789',
          type: 'dm',
        },
        content: {
          text: 'Hello!',
        },
      },
    };

    await validatedHandler(envelope);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-123' }),
      expect.objectContaining({ channel: 'slack' })
    );
  });

  it('should not call handler for invalid envelope', async () => {
    const handler = vi.fn();

    const validatedHandler = createValidatedHandler(ChannelInboundMessageSchema, handler);

    const invalidEnvelope = {
      // Missing required fields
      payload: {},
    };

    await validatedHandler(invalidEnvelope);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not call handler for invalid payload', async () => {
    const handler = vi.fn();

    const validatedHandler = createValidatedHandler(ChannelInboundMessageSchema, handler);

    const envelope = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'channel-slack',
      type: 'channel.inbound',
      payload: {
        // Invalid payload - missing required fields
        channel: 'slack',
      },
    };

    await validatedHandler(envelope);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should call onError for invalid messages', async () => {
    const handler = vi.fn();
    const onError = vi.fn();

    const validatedHandler = createValidatedHandler(ChannelInboundMessageSchema, handler, {
      onError,
    });

    const invalidEnvelope = {
      payload: {},
    };

    await validatedHandler(invalidEnvelope);

    expect(onError).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('should throw when throwOnInvalid is true', async () => {
    const handler = vi.fn();

    const validatedHandler = createValidatedHandler(ChannelInboundMessageSchema, handler, {
      throwOnInvalid: true,
    });

    const invalidEnvelope = {
      payload: {},
    };

    await expect(validatedHandler(invalidEnvelope)).rejects.toThrow('Invalid message envelope');
  });
});

describe('withValidation', () => {
  it('should be an alias for createValidatedHandler', async () => {
    const handler = vi.fn();

    const validatedHandler = withValidation(SessionSchema, handler);

    const envelope = {
      id: 'msg-123',
      timestamp: '2024-01-15T10:30:00.000Z',
      source: 'gateway',
      type: 'session.created',
      payload: {
        id: 'session-456',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
        channel: 'slack',
        conversationId: 'conv-789',
        userId: 'user-000',
        status: 'active',
        config: {},
        metadata: {},
      },
    };

    await validatedHandler(envelope);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('validation caching', () => {
  it('should cache compiled validators', () => {
    // Run validation multiple times with same schema
    const schema = Type.Object({
      test: Type.String(),
    });

    // First call compiles the schema
    const result1 = validate(schema, { test: 'a' });
    expect(result1.success).toBe(true);

    // Second call should use cached compiler
    const result2 = validate(schema, { test: 'b' });
    expect(result2.success).toBe(true);

    // Verify both work correctly (caching doesn't break validation)
    const result3 = validate(schema, { test: 123 });
    expect(result3.success).toBe(false);
  });
});
