/**
 * Scheduler Admin API routes
 *
 * CRUD for cron jobs + execution history. Reads/writes the scheduler's
 * SQLite tables (cron_jobs, cron_runs) in the shared nachos.db.
 */
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type {
  SchedulerJobRow,
  SchedulerJob,
  SchedulerJobsResponse,
  SchedulerRunRow,
  SchedulerRun,
  SchedulerRunsResponse,
} from '../types.js';

const STATE_DIR = process.env['NACHOS_STATE_DIR'] ?? '/app/state';
const ADMIN_USER_ID = '__admin__';
const RESERVED_USER_IDS = new Set(['__config__', '__system__']);

export const schedulerRouter = new Hono();

// ── Helpers ──────────────────────────────────────────────────────────

function getDbPath(): string {
  return join(STATE_DIR, 'nachos.db');
}

/** Open a DB connection with consistent pragmas. Caller MUST close in finally. */
function openDb(readonly: boolean): InstanceType<typeof Database> {
  const db = new Database(getDbPath(), { readonly, fileMustExist: true });
  db.pragma('foreign_keys = ON');
  return db;
}

function rowToJob(row: SchedulerJobRow): SchedulerJob {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scheduleType: row.schedule_type,
    scheduleValue: row.schedule_value,
    timezone: row.timezone,
    actionType: row.action_type,
    actionData: JSON.parse(row.action_data) as Record<string, unknown>,
    deliveryChannel: row.delivery_channel ?? undefined,
    deliveryAnnounce: Boolean(row.delivery_announce),
    enabled: Boolean(row.enabled),
    sessionId: row.session_id ?? undefined,
    userId: row.user_id,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
  };
}

function rowToRun(row: SchedulerRunRow): SchedulerRun {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

const VALID_SCHEDULE_TYPES = ['at', 'every', 'cron'] as const;
const VALID_ACTION_TYPES = ['systemEvent', 'agentTurn'] as const;

function validateScheduleValue(scheduleType: string, scheduleValue: string): string | null {
  switch (scheduleType) {
    case 'at': {
      const d = new Date(scheduleValue);
      if (isNaN(d.getTime())) return 'Invalid ISO timestamp for schedule type "at"';
      return null;
    }
    case 'every': {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) return 'Interval must be a positive integer (milliseconds)';
      return null;
    }
    case 'cron': {
      try {
        CronExpressionParser.parse(scheduleValue);
        return null;
      } catch {
        return `Invalid cron expression: "${scheduleValue}"`;
      }
    }
    default:
      return `Unknown schedule type: "${scheduleType}"`;
  }
}

/** Validate actionData shape matches the actionType */
function validateActionData(
  actionType: string,
  actionData: Record<string, unknown>
): string | null {
  if (actionType === 'systemEvent') {
    if (typeof actionData['text'] !== 'string' || !actionData['text']) {
      return 'actionData must include a non-empty "text" string for actionType "systemEvent"';
    }
    if (actionData['type'] !== undefined && actionData['type'] !== 'systemEvent') {
      return 'actionData.type must be "systemEvent" when actionType is "systemEvent"';
    }
  } else if (actionType === 'agentTurn') {
    if (typeof actionData['prompt'] !== 'string' || !actionData['prompt']) {
      return 'actionData must include a non-empty "prompt" string for actionType "agentTurn"';
    }
    if (actionData['type'] !== undefined && actionData['type'] !== 'agentTurn') {
      return 'actionData.type must be "agentTurn" when actionType is "agentTurn"';
    }
  }
  return null;
}

/** Validate timezone is a recognized IANA zone */
function validateTimezone(timezone: string): string | null {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return null;
  } catch {
    return `Invalid timezone: "${timezone}". Must be a valid IANA timezone (e.g., "America/New_York", "UTC")`;
  }
}

// ── GET /jobs ────────────────────────────────────────────────────────

schedulerRouter.get('/jobs', (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? '50')));
  const enabled = c.req.query('enabled');
  const userId = c.req.query('userId');

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    const empty: SchedulerJobsResponse = { jobs: [], total: 0, page, pageSize };
    return c.json(empty);
  }

  const db = openDb(true);
  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(enabled === 'true' ? 1 : 0);
    }
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const countRow = db
      .prepare<
        (string | number)[],
        { count: number }
      >(`SELECT COUNT(*) as count FROM cron_jobs ${where}`)
      .get(...params);
    const total = countRow?.count ?? 0;

    const rows = db
      .prepare<
        (string | number)[],
        SchedulerJobRow
      >(`SELECT * FROM cron_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);

    const response: SchedulerJobsResponse = {
      jobs: rows.map(rowToJob),
      total,
      page,
      pageSize,
    };
    return c.json(response);
  } catch (err) {
    return c.json({ error: 'Failed to list scheduler jobs', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── GET /jobs/:id ────────────────────────────────────────────────────

schedulerRouter.get('/jobs/:id', (c) => {
  const id = c.req.param('id');
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const db = openDb(true);
  try {
    const row = db
      .prepare<[string], SchedulerJobRow>('SELECT * FROM cron_jobs WHERE id = ?')
      .get(id);

    if (!row) return c.json({ error: 'Job not found' }, 404);
    return c.json(rowToJob(row));
  } catch (err) {
    return c.json({ error: 'Failed to get job', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── POST /jobs ───────────────────────────────────────────────────────

interface CreateJobBody {
  name: string;
  description?: string;
  scheduleType: string;
  scheduleValue: string;
  timezone?: string;
  actionType: string;
  actionData: Record<string, unknown>;
  deliveryChannel?: string;
  deliveryAnnounce?: boolean;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

schedulerRouter.post('/jobs', async (c) => {
  const body = await c.req.json<CreateJobBody>();

  // Validate required fields
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
  if (!body.scheduleType) return c.json({ error: 'scheduleType is required' }, 400);
  if (!body.scheduleValue) return c.json({ error: 'scheduleValue is required' }, 400);
  if (!body.actionType) return c.json({ error: 'actionType is required' }, 400);
  if (!body.actionData) return c.json({ error: 'actionData is required' }, 400);

  // Validate schedule type
  if (!VALID_SCHEDULE_TYPES.includes(body.scheduleType as (typeof VALID_SCHEDULE_TYPES)[number])) {
    return c.json(
      { error: `scheduleType must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}` },
      400
    );
  }

  // Validate action type
  if (!VALID_ACTION_TYPES.includes(body.actionType as (typeof VALID_ACTION_TYPES)[number])) {
    return c.json({ error: `actionType must be one of: ${VALID_ACTION_TYPES.join(', ')}` }, 400);
  }

  // Validate schedule value
  const scheduleError = validateScheduleValue(body.scheduleType, body.scheduleValue);
  if (scheduleError) return c.json({ error: scheduleError }, 400);

  // Validate actionData shape
  const actionDataError = validateActionData(body.actionType, body.actionData);
  if (actionDataError) return c.json({ error: actionDataError }, 400);

  // Validate timezone if provided
  if (body.timezone) {
    const tzError = validateTimezone(body.timezone);
    if (tzError) return c.json({ error: tzError }, 400);
  }

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return c.json({ error: 'Scheduler database not initialized' }, 503);
  }

  const db = openDb(false);
  try {
    const now = new Date().toISOString();
    const id = randomUUID();

    db.prepare(
      `
      INSERT INTO cron_jobs (
        id, name, description, schedule_type, schedule_value, timezone,
        action_type, action_data, delivery_channel, delivery_announce,
        enabled, session_id, user_id, metadata, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      body.name.trim(),
      body.description ?? null,
      body.scheduleType,
      body.scheduleValue,
      body.timezone ?? 'UTC',
      body.actionType,
      JSON.stringify(body.actionData),
      body.deliveryChannel ?? null,
      body.deliveryAnnounce ? 1 : 0,
      1, // enabled by default
      body.sessionId ?? null,
      ADMIN_USER_ID, // Always use admin identity — never trust client-supplied userId
      body.metadata ? JSON.stringify(body.metadata) : null,
      now,
      now
    );

    const row = db
      .prepare<[string], SchedulerJobRow>('SELECT * FROM cron_jobs WHERE id = ?')
      .get(id);

    if (!row) return c.json({ error: 'Failed to retrieve created job' }, 500);
    return c.json(rowToJob(row), 201);
  } catch (err) {
    return c.json({ error: 'Failed to create job', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── PUT /jobs/:id ────────────────────────────────────────────────────

interface UpdateJobBody {
  name?: string;
  description?: string;
  scheduleValue?: string;
  timezone?: string;
  actionData?: Record<string, unknown>;
  deliveryChannel?: string;
  deliveryAnnounce?: boolean;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

schedulerRouter.put('/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateJobBody>();

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const db = openDb(false);
  try {
    // Check job exists
    const existing = db
      .prepare<[string], SchedulerJobRow>('SELECT * FROM cron_jobs WHERE id = ?')
      .get(id);
    if (!existing) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Block updates to reserved jobs
    if (RESERVED_USER_IDS.has(existing.user_id)) {
      return c.json({ error: 'Cannot modify config-managed or system jobs via admin API' }, 403);
    }

    // Validate schedule value if provided
    if (body.scheduleValue !== undefined) {
      const scheduleError = validateScheduleValue(existing.schedule_type, body.scheduleValue);
      if (scheduleError) {
        return c.json({ error: scheduleError }, 400);
      }
    }

    // Validate actionData shape if provided
    if (body.actionData !== undefined) {
      const actionDataError = validateActionData(existing.action_type, body.actionData);
      if (actionDataError) {
        return c.json({ error: actionDataError }, 400);
      }
    }

    // Validate timezone if provided
    if (body.timezone !== undefined) {
      const tzError = validateTimezone(body.timezone);
      if (tzError) return c.json({ error: tzError }, 400);
    }

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description);
    }
    if (body.scheduleValue !== undefined) {
      updates.push('schedule_value = ?');
      values.push(body.scheduleValue);
    }
    if (body.timezone !== undefined) {
      updates.push('timezone = ?');
      values.push(body.timezone);
    }
    if (body.actionData !== undefined) {
      updates.push('action_data = ?');
      values.push(JSON.stringify(body.actionData));
    }
    if (body.deliveryChannel !== undefined) {
      updates.push('delivery_channel = ?');
      values.push(body.deliveryChannel);
    }
    if (body.deliveryAnnounce !== undefined) {
      updates.push('delivery_announce = ?');
      values.push(body.deliveryAnnounce ? 1 : 0);
    }
    if (body.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(body.enabled ? 1 : 0);
    }
    if (body.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(body.metadata));
    }

    values.push(id);

    db.prepare(`UPDATE cron_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const row = db
      .prepare<[string], SchedulerJobRow>('SELECT * FROM cron_jobs WHERE id = ?')
      .get(id);

    if (!row) return c.json({ error: 'Failed to retrieve updated job' }, 500);
    return c.json(rowToJob(row));
  } catch (err) {
    return c.json({ error: 'Failed to update job', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── DELETE /jobs/:id ─────────────────────────────────────────────────

schedulerRouter.delete('/jobs/:id', (c) => {
  const id = c.req.param('id');
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const db = openDb(false);
  try {
    // Explicitly delete runs + job in a transaction (foreign_keys may not cascade reliably)
    const deleteJobWithRuns = db.transaction((jobId: string) => {
      db.prepare('DELETE FROM cron_runs WHERE job_id = ?').run(jobId);
      return db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(jobId);
    });

    const result = deleteJobWithRuns(id);

    if (result.changes === 0) return c.json({ error: 'Job not found' }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete job', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── POST /jobs/:id/trigger ───────────────────────────────────────────

schedulerRouter.post('/jobs/:id/trigger', (c) => {
  const id = c.req.param('id');
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const db = openDb(false);
  try {
    const job = db
      .prepare<[string], SchedulerJobRow>('SELECT * FROM cron_jobs WHERE id = ?')
      .get(id);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Update next_run_at to now so the scheduler picks it up on next tick.
    // Don't create a run record — the scheduler creates its own when it executes.
    const now = new Date().toISOString();

    db.prepare(
      `
      UPDATE cron_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?
    `
    ).run(now, now, id);

    return c.json({ ok: true, message: 'Job scheduled to run on next scheduler tick' });
  } catch (err) {
    return c.json({ error: 'Failed to trigger job', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── GET /runs ────────────────────────────────────────────────────────

schedulerRouter.get('/runs', (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? '50')));
  const jobId = c.req.query('jobId');
  const status = c.req.query('status');

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    const empty: SchedulerRunsResponse = { runs: [], total: 0, page, pageSize };
    return c.json(empty);
  }

  const db = openDb(true);
  try {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (jobId) {
      conditions.push('job_id = ?');
      params.push(jobId);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const countRow = db
      .prepare<
        (string | number)[],
        { count: number }
      >(`SELECT COUNT(*) as count FROM cron_runs ${where}`)
      .get(...params);
    const total = countRow?.count ?? 0;

    const rows = db
      .prepare<
        (string | number)[],
        SchedulerRunRow
      >(`SELECT * FROM cron_runs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);

    const response: SchedulerRunsResponse = {
      runs: rows.map(rowToRun),
      total,
      page,
      pageSize,
    };
    return c.json(response);
  } catch (err) {
    return c.json({ error: 'Failed to list scheduler runs', details: String(err) }, 500);
  } finally {
    db.close();
  }
});

// ── GET /runs/:id ────────────────────────────────────────────────────

schedulerRouter.get('/runs/:id', (c) => {
  const id = c.req.param('id');
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    return c.json({ error: 'Run not found' }, 404);
  }

  const db = openDb(true);
  try {
    const row = db
      .prepare<[string], SchedulerRunRow>('SELECT * FROM cron_runs WHERE id = ?')
      .get(id);

    if (!row) return c.json({ error: 'Run not found' }, 404);
    return c.json(rowToRun(row));
  } catch (err) {
    return c.json({ error: 'Failed to get run', details: String(err) }, 500);
  } finally {
    db.close();
  }
});
