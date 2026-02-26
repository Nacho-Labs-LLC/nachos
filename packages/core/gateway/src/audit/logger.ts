import type { AuditEvent } from './types.js';
import type { AuditProvider } from './provider.js';
import { createLogger } from '@nachos/types';

const logger = createLogger('audit');

export class AuditLogger {
  constructor(private readonly provider: AuditProvider) {}

  async init(): Promise<void> {
    await this.provider.init();
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      await this.provider.log(event);
    } catch (error) {
      logger.error({ err: error }, 'Failed to log event');
    }
  }

  async flush(): Promise<void> {
    try {
      await this.provider.flush();
    } catch (error) {
      logger.error({ err: error }, 'Failed to flush audit events');
    }
  }

  async close(): Promise<void> {
    try {
      await this.provider.close();
    } catch (error) {
      logger.error({ err: error }, 'Failed to close audit provider');
    }
  }
}
