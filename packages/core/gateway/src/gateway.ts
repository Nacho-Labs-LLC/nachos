/**
 * Gateway - Main entry point for the Nachos Gateway service
 */
import type { ChannelInboundMessage, MessageEnvelope, Session } from '@nachos/types';
import { StateStorage } from './state.js';
import { SessionManager } from './session.js';
import { Router, InMemoryMessageBus, createEnvelope, type MessageBus } from './router.js';
import { createHealthServer, performHealthCheck, type HealthCheckDeps } from './health.js';

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
}

/**
 * Gateway class - orchestrates sessions, routing, and health
 */
export class Gateway {
  private storage: StateStorage;
  private sessionManager: SessionManager;
  private router: Router;
  private healthServer: ReturnType<typeof createHealthServer> | null = null;
  private options: GatewayOptions;
  private isConnected: boolean = false;

  constructor(options: GatewayOptions = {}) {
    this.options = options;

    // Initialize storage
    this.storage = new StateStorage(options.dbPath ?? ':memory:');

    // Initialize session manager
    this.sessionManager = new SessionManager(this.storage);

    // Initialize router
    const bus = options.bus ?? new InMemoryMessageBus();
    this.router = new Router({ bus, componentName: 'gateway' });

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
  }

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
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

    if (this.healthServer && this.healthServer.server.listening) {
      await this.healthServer.stop();
    }

    this.storage.close();
    console.log('Gateway stopped');
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
   * Get the state storage
   */
  getStorage(): StateStorage {
    return this.storage;
  }

  /**
   * Get health status
   */
  getHealth() {
    return performHealthCheck({
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
