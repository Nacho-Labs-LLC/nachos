import type { AuditEvent } from '../types.js';
import type { AuditProvider } from '../provider.js';

const DEFAULT_BATCH_SIZE = 50;

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
    try {
      await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify({ events }),
      });
    } catch (error) {
      console.error('[Audit] Webhook provider failed', error);
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
