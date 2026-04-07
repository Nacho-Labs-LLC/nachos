import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gateway } from './gateway.js';
import type { ChannelInboundMessage, Session } from '@nachos/types';
import type { AuditConfig, ToolsConfig } from '@nachos/config';
import type { AuditProvider } from './audit/provider.js';
import * as auditLoader from './audit/loader.js';

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
      expect(gateway.getSessionsStore()).toBeDefined();
      expect(gateway.getRouter()).toBeDefined();
    });

    it('should create a gateway with custom system prompt', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'You are a custom assistant',
      });

      expect(customGateway).toBeDefined();

      // Clean up
      await customGateway.stop();
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

    it('should initialize audit logging when enabled', async () => {
      const provider: AuditProvider = {
        name: 'test',
        init: vi.fn().mockResolvedValue(undefined),
        log: vi.fn().mockResolvedValue(undefined),
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const auditConfig: AuditConfig = {
        enabled: true,
        provider: 'sqlite',
        path: ':memory:',
      };
      vi.spyOn(auditLoader, 'loadAuditProvider').mockResolvedValue(provider);

      const customGateway = new Gateway({
        dbPath: ':memory:',
        healthPort: 9002,
        auditConfig,
      });

      vi.spyOn(console, 'log').mockImplementation(() => {});

      await customGateway.start();

      expect(provider.init).toHaveBeenCalled();

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

    it('should log audit event for new session when audit is enabled', async () => {
      const provider: AuditProvider = {
        name: 'test',
        init: vi.fn().mockResolvedValue(undefined),
        log: vi.fn().mockResolvedValue(undefined),
        flush: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const auditConfig: AuditConfig = {
        enabled: true,
        provider: 'sqlite',
        path: ':memory:',
      };
      vi.spyOn(auditLoader, 'loadAuditProvider').mockResolvedValue(provider);

      const customGateway = new Gateway({
        dbPath: ':memory:',
        healthPort: 0,
        auditConfig,
      });

      vi.spyOn(console, 'log').mockImplementation(() => {});

      await customGateway.start();

      const message: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' },
        content: { text: 'Hello!' },
      };

      await customGateway.processMessage(message);

      expect(provider.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'session_create',
          action: 'session.create',
          outcome: 'allowed',
          channel: 'slack',
          userId: 'user-456',
        })
      );

      await customGateway.stop();
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
      const messages = await gateway.getSessionsStore().getMessages(session.id);

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
      const messages = await gateway.getSessionsStore().getMessages(session.id);
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

      await customGateway.stop();
    });
  });

  describe('bootstrap tool', () => {
    it('omits bootstrap tool when disabled', async () => {
      const toolsConfig: ToolsConfig = { bootstrap: { enabled: false } };
      const customGateway = new Gateway({ dbPath: ':memory:', toolsConfig });
      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });

      const toolExecutor = (
        customGateway as unknown as {
          toolExecutor: {
            buildToolDefinitions: (s: Session) => unknown;
            updateDeps: (partial: Record<string, unknown>) => void;
          };
        }
      ).toolExecutor;
      toolExecutor.updateDeps({ stateLayer: {} as unknown });

      const tools = toolExecutor.buildToolDefinitions(session) as
        | Array<{ name?: string }>
        | undefined;

      expect(tools?.some((tool) => tool.name === 'bootstrap')).toBe(false);

      await customGateway.stop();
    });

    it('increments bootstrap version on set', async () => {
      const session = await gateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const stateLayer = {
        getIdentity: vi.fn().mockResolvedValue(null),
        getBootstrap: vi.fn().mockResolvedValue({
          agentId: 'user-2',
          content: { foo: 'bar' },
          updatedAt: '2024-01-01T00:00:00.000Z',
          version: 2,
          source: 'db',
        }),
        putBootstrap: vi.fn().mockImplementation(async (profile) => profile),
        deleteBootstrap: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const toolExecutor = (
        gateway as unknown as {
          toolExecutor: { updateDeps: (partial: Record<string, unknown>) => void };
        }
      ).toolExecutor;
      toolExecutor.updateDeps({
        state: { stateLayer, getIdentityCompletionStatus: vi.fn().mockResolvedValue(false) },
      });

      const call = {
        tool: 'bootstrap',
        parameters: {
          action: 'set',
          content: { foo: 'baz' },
        },
      };

      const result = await (
        toolExecutor as unknown as {
          executeBootstrapToolCall: (
            c: unknown,
            s: Session
          ) => Promise<{ content: Array<{ text?: string }> }>;
        }
      ).executeBootstrapToolCall(call, session);

      expect(stateLayer.putBootstrap).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'user-2',
          version: 3,
          content: { foo: 'baz' },
        }),
        expect.anything()
      );

      const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
        profile?: { version?: number };
      };
      expect(payload.profile?.version).toBe(3);
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

  describe('subagent tool policy', () => {
    it('denies session tools by default', () => {
      const toolExecutor = (gateway as unknown as { toolExecutor: unknown }).toolExecutor as {
        evaluateSubagentToolPolicy: (
          tool: string,
          session?: Session | null
        ) => {
          allowed: boolean;
        };
      };
      const policy = toolExecutor.evaluateSubagentToolPolicy('sessions_spawn');

      expect(policy.allowed).toBe(false);
    });

    it('respects allowlist overrides', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        subagentToolPolicy: { allow: ['filesystem_read'] },
      });

      const toolExecutor = (customGateway as unknown as { toolExecutor: unknown }).toolExecutor as {
        evaluateSubagentToolPolicy: (
          tool: string,
          session?: Session | null
        ) => {
          allowed: boolean;
        };
      };

      const allowed = toolExecutor.evaluateSubagentToolPolicy('filesystem_read');
      const denied = toolExecutor.evaluateSubagentToolPolicy('browser');

      expect(allowed.allowed).toBe(true);
      expect(denied.allowed).toBe(false);

      await customGateway.stop();
    });

    it('supports profile-specific allowlists', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        subagentToolPolicy: {
          default_profile: 'research',
          profiles: {
            research: {
              allow: ['browser', 'web_search'],
              deny: ['filesystem_write'],
            },
          },
        },
      });

      const { session } = await customGateway.getSessionsStore().getOrCreateSessionAtomic({
        channel: 'subagent',
        conversationId: 'conv-1',
        userId: 'user-1',
        metadata: { subagent: { runId: 'run-1', profile: 'research' } },
      });

      const toolExecutor = (customGateway as unknown as { toolExecutor: unknown }).toolExecutor as {
        evaluateSubagentToolPolicy: (
          tool: string,
          session?: Session | null
        ) => {
          allowed: boolean;
        };
      };

      const allowed = toolExecutor.evaluateSubagentToolPolicy('browser', session);
      const denied = toolExecutor.evaluateSubagentToolPolicy('filesystem_write', session);

      expect(allowed.allowed).toBe(true);
      expect(denied.allowed).toBe(false);

      await customGateway.stop();
    });
  });

  describe('SessionsStore access', () => {
    it('should provide access to sessions store', async () => {
      const sessionsStore = gateway.getSessionsStore();

      const { session } = await sessionsStore.getOrCreateSessionAtomic({
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
    it('should provide access to storage', async () => {
      const storage = gateway.getSessionsStore();

      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
    });
  });

  describe('Status Events (SE)', () => {
    it('[SE-01] should publish thinking event on NATS with correct topic', async () => {
      const bus = gateway.getRouter().getBus();
      const publishSpy = vi.spyOn(bus, 'publish');

      const session = await gateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-se-1',
        userId: 'user-se-1',
      });

      const publishStatusEvent = (
        gateway as unknown as {
          publishStatusEvent: (
            sessionId: string,
            status: string,
            channelId: string,
            channelMessageId?: string,
            toolName?: string
          ) => Promise<void>;
        }
      ).publishStatusEvent.bind(gateway);

      await publishStatusEvent(session.id, 'thinking', 'conv-se-1');

      expect(publishSpy).toHaveBeenCalledWith(
        expect.stringContaining(`nachos.status.${session.id}.thinking`),
        expect.objectContaining({
          type: 'status.thinking',
          source: 'gateway',
          payload: expect.objectContaining({
            sessionId: session.id,
            status: 'thinking',
            channelId: 'conv-se-1',
          }),
        })
      );
    });

    it('[SE-02] should publish tool event with toolName', async () => {
      const bus = gateway.getRouter().getBus();
      const publishSpy = vi.spyOn(bus, 'publish');

      const session = await gateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-se-2',
        userId: 'user-se-2',
      });

      const publishStatusEvent = (
        gateway as unknown as {
          publishStatusEvent: (
            sessionId: string,
            status: string,
            channelId: string,
            channelMessageId?: string,
            toolName?: string
          ) => Promise<void>;
        }
      ).publishStatusEvent.bind(gateway);

      await publishStatusEvent(session.id, 'tool', 'conv-se-2', 'msg-id', 'web_search');

      expect(publishSpy).toHaveBeenCalledWith(
        expect.stringContaining(`nachos.status.${session.id}.tool`),
        expect.objectContaining({
          payload: expect.objectContaining({
            status: 'tool',
            toolName: 'web_search',
          }),
        })
      );
    });

    it('[SE-03] should publish done event on completion', async () => {
      const bus = gateway.getRouter().getBus();
      const publishSpy = vi.spyOn(bus, 'publish');

      const session = await gateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-se-3',
        userId: 'user-se-3',
      });

      const publishStatusEvent = (
        gateway as unknown as {
          publishStatusEvent: (
            sessionId: string,
            status: string,
            channelId: string,
            channelMessageId?: string,
            toolName?: string
          ) => Promise<void>;
        }
      ).publishStatusEvent.bind(gateway);

      await publishStatusEvent(session.id, 'done', 'conv-se-3', 'msg-done');

      expect(publishSpy).toHaveBeenCalledWith(
        expect.stringContaining(`nachos.status.${session.id}.done`),
        expect.objectContaining({
          type: 'status.done',
          payload: expect.objectContaining({
            status: 'done',
            sessionId: session.id,
          }),
        })
      );
    });

    it('[SE-04] should publish error event on failure', async () => {
      const bus = gateway.getRouter().getBus();
      const publishSpy = vi.spyOn(bus, 'publish');

      const session = await gateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-se-4',
        userId: 'user-se-4',
      });

      const publishStatusEvent = (
        gateway as unknown as {
          publishStatusEvent: (
            sessionId: string,
            status: string,
            channelId: string,
            channelMessageId?: string,
            toolName?: string
          ) => Promise<void>;
        }
      ).publishStatusEvent.bind(gateway);

      await publishStatusEvent(session.id, 'error', 'conv-se-4');

      expect(publishSpy).toHaveBeenCalledWith(
        expect.stringContaining(`nachos.status.${session.id}.error`),
        expect.objectContaining({
          type: 'status.error',
          payload: expect.objectContaining({
            status: 'error',
          }),
        })
      );
    });

    it('[SE-05] should not crash message processing when status event publish fails', async () => {
      const bus = gateway.getRouter().getBus();
      vi.spyOn(bus, 'publish').mockRejectedValue(new Error('NATS connection failed'));

      const publishStatusEvent = (
        gateway as unknown as {
          publishStatusEvent: (
            sessionId: string,
            status: string,
            channelId: string,
            channelMessageId?: string,
            toolName?: string
          ) => Promise<void>;
        }
      ).publishStatusEvent.bind(gateway);

      // Should not throw - status events are best-effort
      await expect(
        publishStatusEvent('session-broken', 'thinking', 'conv-broken')
      ).resolves.toBeUndefined();
    });

    it('[SE-06] should include sessionId, channelId, and channelMessageId in status event', async () => {
      const bus = gateway.getRouter().getBus();
      const publishSpy = vi.spyOn(bus, 'publish');

      const session = await gateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-se-6',
        userId: 'user-se-6',
      });

      const publishStatusEvent = (
        gateway as unknown as {
          publishStatusEvent: (
            sessionId: string,
            status: string,
            channelId: string,
            channelMessageId?: string,
            toolName?: string
          ) => Promise<void>;
        }
      ).publishStatusEvent.bind(gateway);

      await publishStatusEvent(session.id, 'thinking', 'conv-se-6', 'msg-se-6');

      expect(publishSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          payload: expect.objectContaining({
            sessionId: session.id,
            channelId: 'conv-se-6',
            channelMessageId: 'msg-se-6',
          }),
        })
      );
    });
  });

  describe('Bootstrap Assembly (BS)', () => {
    it('[BS-02] should inject bootstrap profile blocks into system prompt', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-2',
        userId: 'user-bs-2',
      });

      const mockStateLayer = {
        getIdentity: vi.fn().mockResolvedValue(null),
        getBootstrap: vi.fn().mockResolvedValue({
          agentId: 'user-bs-2',
          content: { personality: 'friendly helper' },
          updatedAt: '2024-01-01T00:00:00.000Z',
          version: 1,
          source: 'db',
        }),
        getUserProfile: vi.fn().mockResolvedValue(null),
        buildMemoryManifest: vi.fn().mockResolvedValue(null),
        queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
        getSessionState: vi.fn().mockResolvedValue(null),
        assemblePrompt: vi.fn().mockReturnValue({
          prompt: 'Base prompt\n\n## Bootstrap\npersonality: friendly helper',
          report: {
            totalChars: 100,
            totalTokens: 25,
            sections: [],
            generatedAt: new Date().toISOString(),
          },
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      // Inject mock state layer
      (customGateway as unknown as { stateLayer: unknown }).stateLayer = mockStateLayer;

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      const request = await buildLLMRequest(session.id);

      expect(mockStateLayer.getBootstrap).toHaveBeenCalled();
      expect(mockStateLayer.assemblePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          bootstrap: expect.objectContaining({
            content: { personality: 'friendly helper' },
          }),
        })
      );
      const systemMsg = request.messages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toContain('Bootstrap');

      await customGateway.stop();
    });

    it('[BS-03] should inject identity data into prompt when identity exists', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-3',
        userId: 'user-bs-3',
      });

      const mockIdentity = {
        agentId: 'user-bs-3',
        soul: 'A helpful AI assistant',
        identity: { name: 'Nachos Agent' },
        identityCompleted: false,
      };

      const mockStateLayer = {
        getIdentity: vi.fn().mockResolvedValue(mockIdentity),
        getBootstrap: vi.fn().mockResolvedValue(null),
        getUserProfile: vi.fn().mockResolvedValue(null),
        buildMemoryManifest: vi.fn().mockResolvedValue(null),
        queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
        getSessionState: vi.fn().mockResolvedValue(null),
        assemblePrompt: vi.fn().mockReturnValue({
          prompt: 'Base prompt\n\n## Identity\nname: Nachos Agent\nsoul: A helpful AI assistant',
          report: {
            totalChars: 120,
            totalTokens: 30,
            sections: [],
            generatedAt: new Date().toISOString(),
          },
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      (customGateway as unknown as { stateLayer: unknown }).stateLayer = mockStateLayer;

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      const request = await buildLLMRequest(session.id);

      expect(mockStateLayer.getIdentity).toHaveBeenCalled();
      expect(mockStateLayer.assemblePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: expect.objectContaining({
            soul: 'A helpful AI assistant',
          }),
        })
      );
      const systemMsg = request.messages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toContain('Identity');

      await customGateway.stop();
    });

    it('[BS-04] should inject memory entries into prompt', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-4',
        userId: 'user-bs-4',
      });

      const memoryEntries = [
        { id: 'mem-1', kind: 'fact', content: 'User prefers dark mode', createdAt: '2024-01-01' },
      ];
      const memoryFacts = [{ key: 'preference', value: 'dark mode' }];

      const mockStateLayer = {
        getIdentity: vi.fn().mockResolvedValue(null),
        getBootstrap: vi.fn().mockResolvedValue(null),
        getUserProfile: vi.fn().mockResolvedValue(null),
        buildMemoryManifest: vi.fn().mockResolvedValue(null),
        queryMemory: vi.fn().mockResolvedValue({ entries: memoryEntries, facts: memoryFacts }),
        getSessionState: vi.fn().mockResolvedValue(null),
        assemblePrompt: vi.fn().mockReturnValue({
          prompt: 'Base prompt\n\n## Memory\nUser prefers dark mode',
          report: {
            totalChars: 80,
            totalTokens: 20,
            sections: [],
            generatedAt: new Date().toISOString(),
          },
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      (customGateway as unknown as { stateLayer: unknown }).stateLayer = mockStateLayer;

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      await buildLLMRequest(session.id);

      expect(mockStateLayer.queryMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'user-bs-4',
          limit: 20,
          kinds: ['preference', 'task', 'fact', 'note', 'lesson'],
        }),
        expect.anything()
      );
      expect(mockStateLayer.assemblePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryEntries,
          memoryFacts: memoryFacts,
        })
      );

      await customGateway.stop();
    });

    it('[BS-05] should include skills documentation in assembled prompt', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-5',
        userId: 'user-bs-5',
      });

      // Mock the skills manager to return a skills prompt
      const skillsManager = (
        customGateway as unknown as { skillsManager: { getSkillsPrompt: () => string | null } }
      ).skillsManager;
      vi.spyOn(skillsManager, 'getSkillsPrompt').mockReturnValue(
        '## Skills\ngoplaces: lookup tool'
      );

      const mockStateLayer = {
        getIdentity: vi.fn().mockResolvedValue(null),
        getBootstrap: vi.fn().mockResolvedValue(null),
        getUserProfile: vi.fn().mockResolvedValue(null),
        buildMemoryManifest: vi.fn().mockResolvedValue(null),
        queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
        getSessionState: vi.fn().mockResolvedValue(null),
        assemblePrompt: vi.fn().mockReturnValue({
          prompt: 'Base prompt\n\n## Skills\ngoplaces: lookup tool',
          report: {
            totalChars: 80,
            totalTokens: 20,
            sections: [],
            generatedAt: new Date().toISOString(),
          },
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      (customGateway as unknown as { stateLayer: unknown }).stateLayer = mockStateLayer;

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      await buildLLMRequest(session.id);

      expect(mockStateLayer.assemblePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: '## Skills\ngoplaces: lookup tool',
        })
      );

      await customGateway.stop();
    });

    it('[BS-09] should prune bootstrap block after identity completion', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-9',
        userId: 'user-bs-9',
      });

      const completedIdentity = {
        agentId: 'user-bs-9',
        soul: 'completed',
        identity: { name: 'Agent' },
        identityCompleted: true,
      };

      const bootstrapProfile = {
        agentId: 'user-bs-9',
        content: { bootstrap: 'setup data', personality: 'friendly' },
        updatedAt: '2024-01-01T00:00:00.000Z',
        version: 3,
        source: 'db',
      };

      const mockStateLayer = {
        getIdentity: vi.fn().mockResolvedValue(completedIdentity),
        getBootstrap: vi.fn().mockResolvedValue(bootstrapProfile),
        getUserProfile: vi.fn().mockResolvedValue(null),
        buildMemoryManifest: vi.fn().mockResolvedValue(null),
        queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
        getSessionState: vi.fn().mockResolvedValue(null),
        assemblePrompt: vi.fn().mockReturnValue({
          prompt: 'Base prompt\n\n## Identity\nAgent',
          report: {
            totalChars: 60,
            totalTokens: 15,
            sections: [],
            generatedAt: new Date().toISOString(),
          },
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      (customGateway as unknown as { stateLayer: unknown }).stateLayer = mockStateLayer;

      // Mock pruneBootstrapAfterCompletion to verify it is called
      const pruneSpy = vi.fn().mockResolvedValue({
        ...bootstrapProfile,
        content: { personality: 'friendly' }, // bootstrap key pruned
      });
      (
        customGateway as unknown as {
          pruneBootstrapAfterCompletion: typeof pruneSpy;
        }
      ).pruneBootstrapAfterCompletion = pruneSpy;

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      await buildLLMRequest(session.id);

      // When identity is completed, pruneBootstrapAfterCompletion should be called
      expect(pruneSpy).toHaveBeenCalledWith(bootstrapProfile, expect.anything());

      await customGateway.stop();
    });

    it('[BS-10] should include all session messages in LLM request', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-10',
        userId: 'user-bs-10',
      });

      // Add some messages to session
      await customGateway.getSessionsStore().addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello there',
      });
      await customGateway.getSessionsStore().addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Hi! How can I help?',
      });
      await customGateway.getSessionsStore().addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Tell me about nachos',
      });

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      const request = await buildLLMRequest(session.id);

      // Should contain system prompt + 3 messages
      const userMsgs = request.messages.filter((m) => m.role === 'user');
      const assistantMsgs = request.messages.filter((m) => m.role === 'assistant');

      expect(userMsgs).toHaveLength(2);
      expect(assistantMsgs).toHaveLength(1);
      expect(userMsgs[0]?.content).toBe('Hello there');
      expect(assistantMsgs[0]?.content).toBe('Hi! How can I help?');
      expect(userMsgs[1]?.content).toBe('Tell me about nachos');

      await customGateway.stop();
    });

    it('[BS-11] should include tool definitions in LLM request', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'Base prompt',
        toolsConfig: { bootstrap: { enabled: true } },
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-11',
        userId: 'user-bs-11',
      });

      // Inject a mock stateLayer so tool definitions include memory tools etc.
      const mockStateLayer = {
        getIdentity: vi.fn().mockResolvedValue(null),
        getBootstrap: vi.fn().mockResolvedValue(null),
        getUserProfile: vi.fn().mockResolvedValue(null),
        buildMemoryManifest: vi.fn().mockResolvedValue(null),
        queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
        getSessionState: vi.fn().mockResolvedValue(null),
        assemblePrompt: vi.fn().mockReturnValue({
          prompt: 'Base prompt',
          report: {
            totalChars: 20,
            totalTokens: 5,
            sections: [],
            generatedAt: new Date().toISOString(),
          },
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      (customGateway as unknown as { stateLayer: unknown }).stateLayer = mockStateLayer;

      // Also update the toolExecutor deps so buildToolDefinitions sees the stateLayer
      const toolExecutor = (
        customGateway as unknown as {
          toolExecutor: { updateDeps: (partial: Record<string, unknown>) => void };
        }
      ).toolExecutor;
      toolExecutor.updateDeps({ state: { stateLayer: mockStateLayer } });

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{
            messages: Array<{ role: string; content: string }>;
            tools?: Array<{ name: string }>;
          }>;
        }
      ).buildLLMRequest.bind(customGateway);

      const request = await buildLLMRequest(session.id);

      // Should have tools defined (at least memory_search, memory_get, user_profile, bootstrap)
      expect(request.tools).toBeDefined();
      expect(Array.isArray(request.tools)).toBe(true);
      const toolNames = request.tools!.map((t) => t.name);
      expect(toolNames).toContain('memory_search');
      expect(toolNames).toContain('user_profile');
      expect(toolNames).toContain('bootstrap');

      await customGateway.stop();
    });

    it('[BS-01] should start with base system prompt from session or gateway default', async () => {
      const customGateway = new Gateway({
        dbPath: ':memory:',
        defaultSystemPrompt: 'You are a helpful assistant',
      });

      const session = await customGateway.getSessionsStore().createSession({
        channel: 'slack',
        conversationId: 'conv-bs-1',
        userId: 'user-bs-1',
      });

      const buildLLMRequest = (
        customGateway as unknown as {
          buildLLMRequest: (
            sessionId: string,
            extraMessages?: unknown[],
            stream?: boolean
          ) => Promise<{ messages: Array<{ role: string; content: string }>; tools?: unknown }>;
        }
      ).buildLLMRequest.bind(customGateway);

      const request = await buildLLMRequest(session.id);

      // Without state layer, should use base prompt directly
      const systemMsg = request.messages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toBe('You are a helpful assistant');

      await customGateway.stop();
    });
  });
});
