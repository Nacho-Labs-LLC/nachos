/**
 * Tests for Composio tools
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComposioToolSchema, executeComposio, initComposioClient } from './composio-tools.js';
import type { ToolCall } from '@nachos/types';
import type { StateLayer, StateOperationContext } from '@nachos/state';

// Mock the Composio SDK
vi.mock('@composio/core', () => ({
  Composio: vi.fn().mockImplementation(() => ({
    actions: {
      execute: vi.fn(),
    },
  })),
}));

describe('ComposioToolSchema', () => {
  it('should have required properties', () => {
    expect(ComposioToolSchema.$id).toBe('composio');
    expect(ComposioToolSchema.type).toBe('object');
    expect(ComposioToolSchema.required).toEqual(['action', 'app', 'params']);
  });

  it('should define action property', () => {
    expect(ComposioToolSchema.properties.action).toBeDefined();
    expect(ComposioToolSchema.properties.action.type).toBe('string');
  });

  it('should define app property with allowed values', () => {
    expect(ComposioToolSchema.properties.app).toBeDefined();
    expect(ComposioToolSchema.properties.app.type).toBe('string');
    expect(ComposioToolSchema.properties.app.enum).toContain('gmail');
    expect(ComposioToolSchema.properties.app.enum).toContain('googlecalendar');
  });

  it('should define params property as object', () => {
    expect(ComposioToolSchema.properties.params).toBeDefined();
    expect(ComposioToolSchema.properties.params.type).toBe('object');
  });
});

describe('initComposioClient', () => {
  it('should initialize client with config', () => {
    const config = {
      apiKey: 'test-api-key',
      entityId: 'test-entity',
      allowedApps: ['gmail', 'googlecalendar'],
    };

    expect(() => initComposioClient(config)).not.toThrow();
  });

  it('should use default allowed apps if not provided', () => {
    const config = {
      apiKey: 'test-api-key',
      entityId: 'test-entity',
    };

    expect(() => initComposioClient(config)).not.toThrow();
  });
});

describe('executeComposio', () => {
  let mockStateLayer: StateLayer;
  let mockContext: StateOperationContext;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Initialize client for tests
    initComposioClient({
      apiKey: 'test-api-key',
      entityId: 'test-entity',
      allowedApps: ['gmail', 'googlecalendar', 'googledocs'],
    });

    // Mock state layer (minimal implementation)
    mockStateLayer = {} as StateLayer;

    // Mock context
    mockContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      channel: 'test',
    };
  });

  it('should reject missing action parameter', async () => {
    const call: ToolCall = {
      id: '1',
      tool: 'composio',
      parameters: {
        app: 'gmail',
        params: {},
      },
    };

    const result = await executeComposio(call, mockStateLayer, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
    expect(result.error?.message).toContain('action');
  });

  it('should reject missing app parameter', async () => {
    const call: ToolCall = {
      id: '1',
      tool: 'composio',
      parameters: {
        action: 'GMAIL_SEND_EMAIL',
        params: {},
      },
    };

    const result = await executeComposio(call, mockStateLayer, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
    expect(result.error?.message).toContain('app');
  });

  it('should reject missing params parameter', async () => {
    const call: ToolCall = {
      id: '1',
      tool: 'composio',
      parameters: {
        action: 'GMAIL_SEND_EMAIL',
        app: 'gmail',
      },
    };

    const result = await executeComposio(call, mockStateLayer, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
    expect(result.error?.message).toContain('params');
  });

  it('should reject app not in allowed list', async () => {
    const call: ToolCall = {
      id: '1',
      tool: 'composio',
      parameters: {
        action: 'SLACK_SEND_MESSAGE',
        app: 'slack',
        params: {},
      },
    };

    const result = await executeComposio(call, mockStateLayer, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('APP_NOT_ALLOWED');
    expect(result.error?.message).toContain('slack');
  });

  it('should validate parameters are an object', async () => {
    const call: ToolCall = {
      id: '1',
      tool: 'composio',
      parameters: {
        action: 'GMAIL_SEND_EMAIL',
        app: 'gmail',
        params: 'invalid', // String instead of object
      },
    };

    const result = await executeComposio(call, mockStateLayer, mockContext);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
    expect(result.error?.message).toContain('params');
    expect(result.error?.message).toContain('object');
  });
});
