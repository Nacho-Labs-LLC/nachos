import type { AuditLogEntryType } from '@nachos/types';

export type AuditEventType = AuditLogEntryType['eventType'];
export type AuditOutcome = AuditLogEntryType['outcome'];

export type AuditEvent = AuditLogEntryType;
