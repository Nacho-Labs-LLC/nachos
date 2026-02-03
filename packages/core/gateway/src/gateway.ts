/**
 * Gateway - Main entry point for the Nachos Gateway service
 */
import type { ChannelInboundMessage, MessageEnvelope, Session } from '@nachos/types';
import type { AuditConfig } from '@nachos/config';
import { StateStorage } from './state.js';
import { SessionManager } from './session.js';
import { Router, InMemoryMessageBus, createEnvelope, type MessageBus } from './router.js';
import { createHealthServer, performHealthCheck, type HealthCheckDeps } from './health.js';
import { Salsa, type PolicyEngineConfig, type SecurityRequest } from './salsa/index.js';
import { AuditLogger, loadAuditProvider } from './audit/index.js';
import type { AuditEvent } from './audit/types.js';
import {
  createDefaultRateLimiterConfig,
  RateLimiter,
  type RateLimiterConfig,
} from './security/rate-limiter.js';

/**
 * Gateway configuration options
 */
export interface GatewayOptions {
  /** Path to SQLite database file, or ':memory:' for in-memory */
  dbPath?: string;
  /** Port for health check endpoint */
  healthPort?: number;
  /** Message bus implementation (defaults to in-memory) */
  bus?: MessageBus;
  /** Default system prompt for new sessions */
  defaultSystemPrompt?: string;
  /** Channels to subscribe to */
  channels?: string[];
  /** Policy engine configuration */
  policyConfig?: PolicyEngineConfig;
  /** Audit configuration */
  auditConfig?: AuditConfig;
  /** Gateway instance ID */
  instanceId?: string;
  /** Rate limiting configuration */
  rateLimiterConfig?: RateLimiterConfig;
}

/**
 * Gateway class - orchestrates sessions, routing, and health
 */
export class Gateway {
  private storage: StateStorage;
  private sessionManager: SessionManager;
  private router: Router;
  private rateLimiter?: RateLimiter;
  private salsa: Salsa | null = null;
  private auditLogger: AuditLogger | null = null;
  private instanceId: string;
  private healthServer: ReturnType<typeof createHealthServer> | null = null;
  private options: GatewayOptions;
  private isConnected: boolean = false;
  private shutdownHandlers: (() => void)[] = [];

  constructor(options: GatewayOptions = {}) {
    this.options = options;
    this.instanceId = options.instanceId ?? 'gateway';

    // Initialize storage
    this.storage = new StateStorage(options.dbPath ?? ':memory:');

    // Initialize session manager
    this.sessionManager = new SessionManager(this.storage);

    // Initialize rate limiter
    if (options.rateLimiterConfig?.enabled !== false) {
      this.rateLimiter = new RateLimiter(
        options.rateLimiterConfig ?? createDefaultRateLimiterConfig()
      );
    }

    // Initialize router
    const bus = options.bus ?? new InMemoryMessageBus();
    this.router = new Router({ bus, componentName: 'gateway', rateLimiter: this.rateLimiter });

    // Initialize Salsa policy engine if configured
    if (options.policyConfig) {
      this.salsa = new Salsa(options.policyConfig);
      console.log('[Gateway] Policy engine (Salsa) initialized');
    }

    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Register default message handlers
   */
  private registerDefaultHandlers(): void {
    // Handle inbound channel messages
    this.router.registerHandler('channel.inbound', async (envelope: MessageEnvelope) => {
      await this.handleInboundMessage(envelope);
    });
  }

  /**
   * Handle an inbound message from a channel
   */
  private async handleInboundMessage(envelope: MessageEnvelope): Promise<void> {
    const message = envelope.payload as ChannelInboundMessage;
    const existingSession = this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    // Get or create session for this conversation
    const session = this.sessionManager.getOrCreateSession({
      channel: message.channel,
      conversationId: message.conversation.id,
      userId: message.sender.id,
      systemPrompt: this.options.defaultSystemPrompt,
    });

    // Add user message to session
    if (message.content.text) {
      this.sessionManager.addMessage(session.id, {
        role: 'user',
        content: message.content.text,
      });
    }

    // Emit a processed message envelope
    const processedEnvelope = createEnvelope(
      'gateway',
      'message.processed',
      {
        sessionId: session.id,
        originalMessage: message,
      },
      envelope.id
    );

    // Publish the processed message (for further handling)
    await this.router.getBus().publish('nachos.gateway.processed', processedEnvelope);

    if (!existingSession) {
      await this.logAuditEvent({
        id: envelope.id,
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId,
        userId: message.sender.id,
        sessionId: session.id,
        channel: message.channel,
        eventType: 'session_create',
        action: 'session.create',
        resource: session.id,
        outcome: 'allowed',
        securityMode: this.options.policyConfig?.securityMode ?? 'standard',
        details: {
          conversationId: message.conversation.id,
          messageId: message.channelMessageId,
        },
      });
    }
  }

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
    if (this.options.auditConfig?.enabled) {
      const provider = await loadAuditProvider(this.options.auditConfig);
      this.auditLogger = new AuditLogger(provider);
      await this.auditLogger.init();
    }

    // Create health server
    const healthDeps: HealthCheckDeps = {
      checkDatabase: () => {
        try {
          this.storage.listSessions({ limit: 1 });
          return true;
        } catch {
          return false;
        }
      },
      checkBus: () => this.isConnected,
    };

    this.healthServer = createHealthServer({
      port: this.options.healthPort ?? 8081,
      componentName: 'gateway',
      deps: healthDeps,
    });

    await this.healthServer.start();

    // Subscribe to configured channels
    if (this.options.channels) {
      for (const channel of this.options.channels) {
        await this.router.subscribeToChannel(channel);
      }
    }

    this.isConnected = true;
    console.log('Gateway started');
  }

  /**
   * Stop the gateway
   */
  async stop(): Promise<void> {
    this.isConnected = false;

    // Remove signal handlers
    this.removeSignalHandlers();

    if (this.healthServer && this.healthServer.server.listening) {
      await this.healthServer.stop();
    }

    // Cleanup Salsa
    if (this.salsa) {
      this.salsa.destroy();
    }

    if (this.auditLogger) {
      await this.auditLogger.close();
      this.auditLogger = null;
    }
    if (this.rateLimiter) {
      await this.rateLimiter.shutdown();
    }

    this.storage.close();
    console.log('Gateway stopped');
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    const sigintHandler = () => shutdown('SIGINT');
    const sigtermHandler = () => shutdown('SIGTERM');

    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigtermHandler);

    // Store handlers for cleanup
    this.shutdownHandlers.push(
      () => process.removeListener('SIGINT', sigintHandler),
      () => process.removeListener('SIGTERM', sigtermHandler)
    );
  }

  /**
   * Remove signal handlers (for testing)
   */
  private removeSignalHandlers(): void {
    this.shutdownHandlers.forEach((handler) => handler());
    this.shutdownHandlers = [];
  }

  /**
   * Get the session manager
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get the router
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Log an audit event when audit logging is enabled.
   */
  async logAuditEvent(event: AuditEvent): Promise<void> {
    if (!this.auditLogger) {
      return;
    }
    await this.auditLogger.log(event);
  }

  /**
   * Get the state storage
   */
  getStorage(): StateStorage {
    return this.storage;
  }

  /**
   * Get health status
   */
  getHealth() {
    const health = performHealthCheck({
      checkDatabase: () => {
        try {
          this.storage.listSessions({ limit: 1 });
          return true;
        } catch {
          return false;
        }
      },
      checkBus: () => this.isConnected,
    });

    // Add Salsa statistics if available
    if (this.salsa) {
      const salsaStats = this.salsa.getStats();
      return {
        ...health,
        salsa: {
          policiesLoaded: salsaStats.policiesLoaded,
          rulesActive: salsaStats.rulesActive,
          hasErrors: this.salsa.hasValidationErrors(),
        },
      };
    }

    return health;
  }

  /**
   * Get the policy engine (Salsa)
   */
  getSalsa(): Salsa | null {
    return this.salsa;
  }

  /**
   * Evaluate a security request against policies
   * @param request - Security request to evaluate
   * @returns Security result with allow/deny decision
   */
  evaluatePolicy(request: SecurityRequest) {
    if (!this.salsa) {
      // If no policy engine is configured, allow by default
      return {
        allowed: true,
        effect: 'allow' as const,
        evaluationTimeMs: 0,
      };
    }

    return this.salsa.evaluate(request);
  }

  /**
   * Process an inbound message directly (for testing)
   */
  async processMessage(message: ChannelInboundMessage): Promise<Session> {
    const envelope = createEnvelope('test', 'channel.inbound', message);
    await this.handleInboundMessage(envelope);

    const session = this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (!session) {
      throw new Error('Session not found after processing message');
    }

    return session;
  }
}
