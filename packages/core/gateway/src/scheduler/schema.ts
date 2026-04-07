/**
 * Database schema for scheduler jobs and runs
 */

/**
 * Schema initialization SQL for cron jobs and runs
 */
export const SCHEDULER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    schedule_type TEXT NOT NULL CHECK(schedule_type IN ('at', 'every', 'cron')),
    schedule_value TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    action_type TEXT NOT NULL CHECK(action_type IN ('systemEvent', 'agentTurn')),
    action_data TEXT NOT NULL,
    delivery_channel TEXT,
    delivery_announce INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    session_id TEXT,
    user_id TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cron_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'success', 'failed', 'skipped')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    result TEXT,
    error TEXT,
    duration_ms INTEGER,
    FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_user ON cron_jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_session ON cron_jobs(session_id);
  CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id);
  CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status);
`;
