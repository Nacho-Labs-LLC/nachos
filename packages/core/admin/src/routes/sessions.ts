import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { SessionRow, SessionsResponse } from '../types.js';

const STATE_DIR = process.env['NACHOS_STATE_DIR'] ?? '/app/state';

export const sessionsRouter = new Hono();

sessionsRouter.get('/', (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? '50')));
  const status = c.req.query('status');
  const channel = c.req.query('channel');

  const dbPath = join(STATE_DIR, 'nachos.db');

  if (!existsSync(dbPath)) {
    const empty: SessionsResponse = { sessions: [], total: 0, page, pageSize };
    return c.json(empty);
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (status) {
      conditions.push('s.status = ?');
      params.push(status);
    }
    if (channel) {
      conditions.push('s.channel = ?');
      params.push(channel);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const countRow = db
      .prepare<
        (string | number)[],
        { count: number }
      >(`SELECT COUNT(*) as count FROM sessions s ${where}`)
      .get(...params);
    const total = countRow?.count ?? 0;

    const sessions = db
      .prepare<(string | number)[], SessionRow>(
        `SELECT s.id, s.channel, s.user_id, s.conversation_id, s.status,
                s.system_prompt, s.created_at, s.updated_at,
                COUNT(m.id) as message_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id
         ${where}
         GROUP BY s.id
         ORDER BY s.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset);

    db.close();

    const response: SessionsResponse = { sessions, total, page, pageSize };
    return c.json(response);
  } catch (err) {
    return c.json({ error: 'Failed to read sessions', details: String(err) }, 500);
  }
});

sessionsRouter.post('/:id/expire', (c) => {
  const id = c.req.param('id');
  const dbPath = join(STATE_DIR, 'nachos.db');

  if (!existsSync(dbPath)) {
    return c.json({ error: 'Session not found' }, 404);
  }

  try {
    const db = new Database(dbPath, { readonly: false, fileMustExist: true });

    const result = db
      .prepare(`UPDATE sessions SET status = 'ended', updated_at = datetime('now') WHERE id = ?`)
      .run(id);

    db.close();

    if (result.changes === 0) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to expire session', details: String(err) }, 500);
  }
});
