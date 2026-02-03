import type { AuditEvent } from './types.js';
import type { AuditProvider } from './provider.js';

export class AuditLogger {
  constructor(private readonly provider: AuditProvider) {}

  async init(): Promise<void> {
    await this.provider.init();
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      await this.provider.log(event);
    } catch (error) {
      console.error('[Audit] Failed to log event', error);
    }
  }

  async flush(): Promise<void> {
    try {
      await this.provider.flush();
    } catch (error) {
      console.error('[Audit] Failed to flush audit events', error);
    }
  }

  async close(): Promise<void> {
    try {
      await this.provider.close();
    } catch (error) {
      console.error('[Audit] Failed to close audit provider', error);
    }
  }
}
