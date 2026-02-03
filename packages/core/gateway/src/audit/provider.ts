import type { AuditEvent } from './types.js';

export interface AuditQueryFilter {
  startTime?: string;
  endTime?: string;
  userId?: string;
  sessionId?: string;
  eventType?: AuditEvent['eventType'];
  outcome?: AuditEvent['outcome'];
  limit?: number;
  offset?: number;
}

export interface AuditProvider {
  readonly name: string;
  init(): Promise<void>;
  log(event: AuditEvent): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  query?(filter: AuditQueryFilter): Promise<AuditEvent[]>;
}
