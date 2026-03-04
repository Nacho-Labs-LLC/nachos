/**
 * NATS Utilities
 *
 * Utility functions for working with NATS messaging in tool services
 */

import { connect, type NatsConnection, type ConnectionOptions } from 'nats';
import type { MessageEnvelope } from '@nachos/types';
import { createLogger, createTimeoutError, createBusConnectionError } from '@nachos/types';

const logger = createLogger('tool-nats');

/**
 * Connect to NATS server
 */
export async function connectToNats(url?: string): Promise<NatsConnection> {
  const natsUrl = url ?? process.env.NATS_URL ?? 'nats://localhost:4222';

  const token = process.env.NATS_TOKEN;

  const options: ConnectionOptions = {
    servers: natsUrl,
    name: `tool-${process.env.TOOL_ID ?? 'unknown'}`,
    maxReconnectAttempts: -1, // Reconnect indefinitely
    reconnectTimeWait: 1000, // Wait 1 second between reconnect attempts
    ...(token ? { token } : {}),
  };

  logger.info({ url: natsUrl }, 'Connecting to NATS');
  const nc = await connect(options);
  logger.info({ server: nc.getServer() }, 'Connected to NATS');

  return nc;
}

/**
 * Create a message envelope
 */
export function createEnvelope(
  source: string,
  type: string,
  payload: unknown,
  correlationId?: string
): MessageEnvelope {
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: new Date().toISOString(),
    source,
    type,
    correlationId,
    payload,
  };
}

/**
 * Parse a message envelope from JSON data
 */
export function parseEnvelope(data: Uint8Array | string): MessageEnvelope {
  const json = typeof data === 'string' ? data : new TextDecoder().decode(data);
  return JSON.parse(json) as MessageEnvelope;
}

/**
 * Serialize a message envelope to JSON
 */
export function serializeEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Wait for NATS connection to be ready
 */
export async function waitForReady(nc: NatsConnection, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();

  while (!nc.isClosed()) {
    if (Date.now() - startTime > timeoutMs) {
      throw createTimeoutError('Timeout waiting for NATS connection', { component: 'tool-nats' });
    }

    // Check if connection is ready by attempting to get server info
    try {
      nc.getServer();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw createBusConnectionError('NATS connection closed while waiting for ready', { component: 'tool-nats' });
}

/**
 * Gracefully close NATS connection
 */
export async function closeNats(nc: NatsConnection): Promise<void> {
  logger.info('Closing NATS connection');
  await nc.drain();
  await nc.close();
  logger.info('NATS connection closed');
}

/**
 * Setup signal handlers for graceful shutdown
 */
export function setupShutdownHandlers(nc: NatsConnection, onShutdown?: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received signal, shutting down gracefully');

    try {
      // Call custom shutdown handler
      if (onShutdown) {
        await onShutdown();
      }

      // Close NATS connection
      await closeNats(nc);

      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
