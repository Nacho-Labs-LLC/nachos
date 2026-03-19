import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { AuditRow, AuditResponse } from '../types.js';

// GATEWAY_STATE_DIR overrides for audit.db path (gateway writes audit to its own state dir)
const STATE_DIR = process.env['GATEWAY_STATE_DIR'] ?? process.env['NACHOS_STATE_DIR'] ?? '/app/state';

export const auditRouter = new Hono();

auditRouter.get('/', (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? '50')));
  const eventType = c.req.query('event_type');
  const channel = c.req.query('channel');
  const outcome = c.req.query('outcome');

  const dbPath = join(STATE_DIR, 'audit.db');

  if (!existsSync(dbPath)) {
    const empty: AuditResponse = { events: [], total: 0, page, pageSize };
    return c.json(empty);
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (eventType) {
      conditions.push('event_type = ?');
      params.push(eventType);
    }
    if (channel) {
      conditions.push('channel = ?');
      params.push(channel);
    }
    if (outcome) {
      conditions.push('outcome = ?');
      params.push(outcome);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const countRow = db
      .prepare<
        (string | number)[],
        { count: number }
      >(`SELECT COUNT(*) as count FROM audit_events ${where}`)
      .get(...params);
    const total = countRow?.count ?? 0;

    const events = db
      .prepare<(string | number)[], AuditRow>(
        `SELECT id, timestamp, instance_id, user_id, session_id, channel,
                event_type, action, resource, outcome, reason, security_mode,
                policy_matched, details, created_at
         FROM audit_events ${where}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset);

    db.close();

    const response: AuditResponse = { events, total, page, pageSize };
    return c.json(response);
  } catch (err) {
    return c.json({ error: 'Failed to read audit log', details: String(err) }, 500);
  }
});

auditRouter.get('/event-types', (c) => {
  const dbPath = join(STATE_DIR, 'audit.db');

  if (!existsSync(dbPath)) return c.json([]);

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare<
        [],
        { event_type: string }
      >('SELECT DISTINCT event_type FROM audit_events ORDER BY event_type')
      .all();
    db.close();
    return c.json(rows.map((r) => r.event_type));
  } catch {
    return c.json([]);
  }
});
