/**
 * StreamingSessionManager — owns streaming session tracking, buffering, and sweep.
 * Extracted from Gateway to reduce the monolithic class.
 */
import type { ChannelInboundMessage, ChannelOutboundMessage, MessageEnvelope } from '@nachos/types';
import { createLogger, validateMessageEnvelope } from '@nachos/types';
import type { NatsBusAdapter } from '../router.js';

const logger = createLogger('streaming-session-manager');

/**
 * Runtime type guard for the inner payload of LLM stream bus messages.
 * Checks that the payload is an object and has at least a sessionId string field.
 */
function isStreamChunk(value: unknown): value is { sessionId?: string; type?: string; delta?: string } {
  return typeof value === 'object' && value !== null;
}

export interface StreamingState {
  inbound: ChannelInboundMessage;
  buffer: string;
  lastSentAt: number;
  lastSentLength: number;
  createdAt: number;
}

export interface StreamingSessionManagerConfig {
  /** Minimum ms between streaming chunk sends (default 500) */
  streamingMinIntervalMs?: number;
  /** Minimum character delta before sending a chunk (default 200) */
  streamingChunkSize?: number;
  /** Maximum age in ms before a session is reaped (default 300_000 = 5 min) */
  maxSessionAgeMs?: number;
  /** Sweep interval in ms (default 60_000) */
  sweepIntervalMs?: number;
}

export interface StreamingSessionManagerDeps {
  /** Send a channel outbound message */
  sendToChannel(outbound: ChannelOutboundMessage): Promise<void>;
}

export class StreamingSessionManager {
  private sessions: Map<string, StreamingState> = new Map();
  private sweepInterval?: NodeJS.Timeout;
  private config: Required<StreamingSessionManagerConfig>;
  private deps: StreamingSessionManagerDeps;

  constructor(deps: StreamingSessionManagerDeps, config?: StreamingSessionManagerConfig) {
    this.deps = deps;
    this.config = {
      streamingMinIntervalMs: config?.streamingMinIntervalMs ?? 500,
      streamingChunkSize: config?.streamingChunkSize ?? 200,
      maxSessionAgeMs: config?.maxSessionAgeMs ?? 300_000,
      sweepIntervalMs: config?.sweepIntervalMs ?? 60_000,
    };
  }

  /**
   * Register a new streaming session for the given sessionId.
   */
  register(sessionId: string, inbound: ChannelInboundMessage): void {
    this.sessions.set(sessionId, {
      inbound,
      buffer: '',
      lastSentAt: 0,
      lastSentLength: 0,
      createdAt: Date.now(),
    });
  }

  /**
   * Check whether a streaming session exists for the given id.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Return the count of currently active streaming sessions.
   * Useful for metrics / health endpoints.
   */
  getActiveSessions(): number {
    return this.sessions.size;
  }

  /**
   * Subscribe to LLM stream events on the bus and start the sweep interval.
   */
  async startSubscription(bus: NatsBusAdapter): Promise<void> {
    await bus.subscribe('nachos.llm.stream.*', async (data) => {
      // Validate that data is a well-formed MessageEnvelope before processing
      const envelopeResult = validateMessageEnvelope(data);
      if (!envelopeResult.success || !envelopeResult.data) {
        logger.warn({ errors: envelopeResult.errors }, 'Discarding invalid streaming bus payload: not a MessageEnvelope');
        return;
      }
      const envelope: MessageEnvelope = envelopeResult.data;

      // Validate inner payload shape — must have at least sessionId
      if (!isStreamChunk(envelope.payload)) {
        logger.warn({ payload: typeof envelope.payload }, 'Discarding streaming payload: missing expected chunk fields');
        return;
      }
      const chunk = envelope.payload;
      if (!chunk.sessionId) return;
      const state = this.sessions.get(chunk.sessionId);
      if (!state) return;

      if (chunk.type === 'done') {
        this.sessions.delete(chunk.sessionId);
        return;
      }

      if (chunk.type === 'delta' && chunk.delta) {
        state.buffer += chunk.delta;
        const now = Date.now();
        const shouldSend =
          state.buffer.length - state.lastSentLength >= this.config.streamingChunkSize &&
          now - state.lastSentAt >= this.config.streamingMinIntervalMs;

        if (shouldSend) {
          state.lastSentAt = now;
          state.lastSentLength = state.buffer.length;
          const outbound: ChannelOutboundMessage = {
            channel: state.inbound.channel,
            conversationId: state.inbound.conversation.id,
            replyToMessageId: state.inbound.channelMessageId,
            sessionId: chunk.sessionId,
            content: {
              text: state.buffer,
              format: 'markdown',
            },
            options: {
              ephemeral: true,
            },
          };
          await this.deps.sendToChannel(outbound);
        }
      }
    });

    // Sweep stale streaming sessions periodically to prevent leaks
    this.sweepInterval = setInterval(() => {
      const now = Date.now();
      const reaped: string[] = [];

      for (const [id, state] of this.sessions) {
        if (now - state.createdAt > this.config.maxSessionAgeMs) {
          this.sessions.delete(id);
          reaped.push(id);
        }
      }

      if (reaped.length > 0) {
        logger.warn(
          { reaped, count: reaped.length, activeSessions: this.sessions.size },
          'Reaped stale streaming sessions'
        );
      }
    }, this.config.sweepIntervalMs);
  }

  /**
   * Stop the sweep interval and clear all sessions.
   */
  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
    this.sessions.clear();
  }
}
