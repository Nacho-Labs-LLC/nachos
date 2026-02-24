/**
 * Storage layer for cron jobs and runs
 */
import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type {
  CronJob,
  CronRun,
  CreateCronJobOptions,
  UpdateCronJobOptions,
  ListCronJobsOptions,
  ListCronRunsOptions,
  JobActionData,
} from './types.js';

/**
 * Database row types
 */
interface CronJobRow {
  id: string;
  name: string;
  description: string | null;
  schedule_type: string;
  schedule_value: string;
  timezone: string;
  action_type: string;
  action_data: string;
  delivery_channel: string | null;
  delivery_announce: number;
  enabled: number;
  session_id: string | null;
  user_id: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface CronRunRow {
  id: string;
  job_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
}

/**
 * Scheduler storage class
 */
export class SchedulerStorage {
  constructor(private db: Database.Database) {}

  /**
   * Convert database row to CronJob object
   */
  private rowToCronJob(row: CronJobRow): CronJob {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      scheduleType: row.schedule_type as 'at' | 'every' | 'cron',
      scheduleValue: row.schedule_value,
      timezone: row.timezone,
      actionType: row.action_type as 'systemEvent' | 'agentTurn',
      actionData: JSON.parse(row.action_data) as JobActionData,
      deliveryChannel: row.delivery_channel ?? undefined,
      deliveryAnnounce: Boolean(row.delivery_announce),
      enabled: Boolean(row.enabled),
      sessionId: row.session_id ?? undefined,
      userId: row.user_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunAt: row.last_run_at ?? undefined,
      nextRunAt: row.next_run_at ?? undefined,
    };
  }

  /**
   * Convert database row to CronRun object
   */
  private rowToCronRun(row: CronRunRow): CronRun {
    return {
      id: row.id,
      jobId: row.job_id,
      status: row.status as CronRun['status'],
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      durationMs: row.duration_ms ?? undefined,
    };
  }

  /**
   * Create a new cron job
   */
  createJob(options: CreateCronJobOptions): CronJob {
    const now = new Date().toISOString();
    const id = uuid();

    const stmt = this.db.prepare(`
      INSERT INTO cron_jobs (
        id, name, description, schedule_type, schedule_value, timezone,
        action_type, action_data, delivery_channel, delivery_announce,
        enabled, session_id, user_id, metadata, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      options.name,
      options.description ?? null,
      options.scheduleType,
      options.scheduleValue,
      options.timezone ?? 'UTC',
      options.actionType,
      JSON.stringify(options.actionData),
      options.deliveryChannel ?? null,
      options.deliveryAnnounce ? 1 : 0,
      1, // enabled by default
      options.sessionId ?? null,
      options.userId,
      options.metadata ? JSON.stringify(options.metadata) : null,
      now,
      now
    );

    return {
      id,
      name: options.name,
      description: options.description,
      scheduleType: options.scheduleType,
      scheduleValue: options.scheduleValue,
      timezone: options.timezone ?? 'UTC',
      actionType: options.actionType,
      actionData: options.actionData,
      deliveryChannel: options.deliveryChannel,
      deliveryAnnounce: options.deliveryAnnounce ?? false,
      enabled: true,
      sessionId: options.sessionId,
      userId: options.userId,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a cron job by ID
   */
  getJob(id: string): CronJob | null {
    const stmt = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?');
    const row = stmt.get(id) as CronJobRow | undefined;
    return row ? this.rowToCronJob(row) : null;
  }

  /**
   * Update a cron job
   */
  updateJob(id: string, options: UpdateCronJobOptions): CronJob | null {
    const existing = this.getJob(id);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (options.name !== undefined) {
      updates.push('name = ?');
      values.push(options.name);
    }
    if (options.description !== undefined) {
      updates.push('description = ?');
      values.push(options.description);
    }
    if (options.scheduleValue !== undefined) {
      updates.push('schedule_value = ?');
      values.push(options.scheduleValue);
    }
    if (options.timezone !== undefined) {
      updates.push('timezone = ?');
      values.push(options.timezone);
    }
    if (options.actionData !== undefined) {
      updates.push('action_data = ?');
      values.push(JSON.stringify(options.actionData));
    }
    if (options.deliveryChannel !== undefined) {
      updates.push('delivery_channel = ?');
      values.push(options.deliveryChannel);
    }
    if (options.deliveryAnnounce !== undefined) {
      updates.push('delivery_announce = ?');
      values.push(options.deliveryAnnounce ? 1 : 0);
    }
    if (options.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(options.enabled ? 1 : 0);
    }
    if (options.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(options.metadata));
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE cron_jobs
      SET ${updates.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);
    return this.getJob(id);
  }

  /**
   * Delete a cron job
   */
  deleteJob(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM cron_jobs WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * List cron jobs with optional filtering
   */
  listJobs(options?: ListCronJobsOptions): CronJob[] {
    let query = 'SELECT * FROM cron_jobs WHERE 1=1';
    const params: unknown[] = [];

    if (options?.userId) {
      query += ' AND user_id = ?';
      params.push(options.userId);
    }
    if (options?.sessionId) {
      query += ' AND session_id = ?';
      params.push(options.sessionId);
    }
    if (options?.enabled !== undefined) {
      query += ' AND enabled = ?';
      params.push(options.enabled ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as CronJobRow[];
    return rows.map(row => this.rowToCronJob(row));
  }

  /**
   * Get jobs that are due to run
   */
  getDueJobs(beforeTime: Date): CronJob[] {
    const stmt = this.db.prepare(`
      SELECT * FROM cron_jobs
      WHERE enabled = 1
      AND next_run_at IS NOT NULL
      AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `);

    const rows = stmt.all(beforeTime.toISOString()) as CronJobRow[];
    return rows.map(row => this.rowToCronJob(row));
  }

  /**
   * Update job run times
   */
  updateJobRunTimes(id: string, lastRunAt: Date, nextRunAt?: Date): void {
    const stmt = this.db.prepare(`
      UPDATE cron_jobs
      SET last_run_at = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      lastRunAt.toISOString(),
      nextRunAt ? nextRunAt.toISOString() : null,
      new Date().toISOString(),
      id
    );
  }

  /**
   * Create a cron run record
   */
  createRun(jobId: string): CronRun {
    const now = new Date().toISOString();
    const id = uuid();

    const stmt = this.db.prepare(`
      INSERT INTO cron_runs (id, job_id, status, started_at)
      VALUES (?, ?, 'running', ?)
    `);

    stmt.run(id, jobId, now);

    return {
      id,
      jobId,
      status: 'running',
      startedAt: now,
    };
  }

  /**
   * Update a cron run record
   */
  updateRun(
    id: string,
    options: {
      status: CronRun['status'];
      result?: string;
      error?: string;
    }
  ): void {
    const now = new Date().toISOString();
    const startTime = this.db
      .prepare('SELECT started_at FROM cron_runs WHERE id = ?')
      .get(id) as { started_at: string } | undefined;

    const durationMs = startTime
      ? new Date(now).getTime() - new Date(startTime.started_at).getTime()
      : undefined;

    const stmt = this.db.prepare(`
      UPDATE cron_runs
      SET status = ?, completed_at = ?, result = ?, error = ?, duration_ms = ?
      WHERE id = ?
    `);

    stmt.run(
      options.status,
      now,
      options.result ?? null,
      options.error ?? null,
      durationMs ?? null,
      id
    );
  }

  /**
   * List cron runs with optional filtering
   */
  listRuns(options?: ListCronRunsOptions): CronRun[] {
    let query = 'SELECT * FROM cron_runs WHERE 1=1';
    const params: unknown[] = [];

    if (options?.jobId) {
      query += ' AND job_id = ?';
      params.push(options.jobId);
    }
    if (options?.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY started_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as CronRunRow[];
    return rows.map(row => this.rowToCronRun(row));
  }
}
