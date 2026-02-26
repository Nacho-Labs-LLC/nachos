/**
 * Matrix Channel Adapter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixChannelAdapter } from './index.js';
import type { ChannelAdapterConfig } from '@nachos/types';

describe('MatrixChannelAdapter', () => {
  let adapter: MatrixChannelAdapter;
  let mockConfig: ChannelAdapterConfig;
  let mockBus: any;

  beforeEach(() => {
    adapter = new MatrixChannelAdapter();
    
    mockBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };

    mockConfig = {
      config: {
        homeserver: 'https://matrix.example.com',
        userId: '@bot:example.com',
        accessToken: 'test_token_12345',
        deviceId: 'NACHOS_TEST',
      },
      secrets: {
        accessToken: 'test_token_12345',
      },
      bus: mockBus,
      securityMode: 'standard',
      dmPolicy: {
        userAllowlist: ['@alice:example.com'],
        pairing: false,
      },
      groupPolicy: {
        mentionGating: true,
        channelIds: ['!room123:example.com'],
        userAllowlist: ['@alice:example.com'],
      },
    };
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      await expect(adapter.initialize(mockConfig)).resolves.not.toThrow();
    });

    it('should throw error if homeserver is missing', async () => {
      const invalidConfig = { ...mockConfig };
      delete (invalidConfig.config as any).homeserver;
      
      await expect(adapter.initialize(invalidConfig)).rejects.toThrow('Matrix homeserver is required');
    });

    it('should throw error if accessToken is missing', async () => {
      const invalidConfig = { ...mockConfig };
      delete (invalidConfig.config as any).accessToken;
      
      await expect(adapter.initialize(invalidConfig)).rejects.toThrow('Matrix access token is required');
    });

    it('should throw error if userId is missing', async () => {
      const invalidConfig = { ...mockConfig };
      delete (invalidConfig.config as any).userId;
      
      await expect(adapter.initialize(invalidConfig)).rejects.toThrow('Matrix user ID is required');
    });
  });

  describe('properties', () => {
    it('should have correct channelId', () => {
      expect(adapter.channelId).toBe('matrix');
    });

    it('should have correct name', () => {
      expect(adapter.name).toBe('Matrix');
    });
  });

  describe('sendMessage', () => {
    it('should return error if client not initialized', async () => {
      const message = {
        channel: 'matrix',
        conversationId: '!room123:example.com',
        content: {
          text: 'Hello, world!',
          format: 'plain' as const,
        },
      };

      const result = await adapter.sendMessage(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CLIENT_NOT_INITIALIZED');
    });
  });

  describe('healthCheck', () => {
    it('should return unhealthy if client not running', async () => {
      const health = await adapter.healthCheck();
      
      expect(health.status).toBe('unhealthy');
      expect(health.details?.message).toContain('not running');
    });
  });
});
