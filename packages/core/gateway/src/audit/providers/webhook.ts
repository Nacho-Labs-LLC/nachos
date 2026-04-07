import type { AuditEvent } from '../types.js';
import type { AuditProvider } from '../provider.js';
import { createLogger, createConfigError, createValidationError } from '@nachos/types';

const logger = createLogger('audit-webhook');

const DEFAULT_BATCH_SIZE = 50;

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^127\./,
  /^0\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
  /^::$/,
];

function isPrivateHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') {
    return true;
  }
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(hostname));
}

function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw createValidationError(`Invalid webhook URL: ${url}`, { component: 'audit-webhook' });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createConfigError(
      `Webhook URL must use http or https protocol, got: ${parsed.protocol}`,
      { component: 'audit-webhook' }
    );
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw createConfigError(
      `Webhook URL points to a private/internal address (${parsed.hostname}). ` +
        'This is blocked to prevent SSRF attacks.',
      { component: 'audit-webhook' }
    );
  }
}

export interface WebhookAuditProviderConfig {
  url: string;
  headers?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class WebhookAuditProvider implements AuditProvider {
  readonly name = 'webhook';
  private buffer: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: WebhookAuditProviderConfig) {}

  async init(): Promise<void> {
    validateWebhookUrl(this.config.url);

    const interval = this.config.flushIntervalMs ?? 5000;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, interval);
  }

  async log(event: AuditEvent): Promise<void> {
    this.buffer.push(event);
    const batchSize = this.config.batchSize ?? DEFAULT_BATCH_SIZE;
    if (this.buffer.length >= batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    const events = this.buffer.splice(0);
    const maxAttempts = 3;
    const baseDelayMs = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          body: JSON.stringify({ events }),
        });
        if (response.ok) {
          return;
        }
        logger.warn(
          { attempt, status: response.status, maxAttempts },
          'Webhook provider received non-OK response'
        );
      } catch (error) {
        logger.warn({ err: error, attempt, maxAttempts }, 'Webhook provider attempt failed');
      }

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }

    logger.error(
      { eventsCount: events.length, maxAttempts },
      'Webhook provider exhausted all retry attempts — events dropped'
    );
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
