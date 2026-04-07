/**
 * Types for the scheduler system
 */

/**
 * Schedule type
 */
export type ScheduleType = 'at' | 'every' | 'cron';

/**
 * Job action type
 */
export type JobActionType = 'systemEvent' | 'agentTurn';

/**
 * Job status
 */
export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/**
 * Cron job definition
 */
export interface CronJob {
  id: string;
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  timezone: string;
  actionType: JobActionType;
  actionData: JobActionData;
  deliveryChannel?: string;
  deliveryAnnounce: boolean;
  enabled: boolean;
  sessionId?: string;
  userId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

/**
 * Action data for system event
 */
export interface SystemEventAction {
  type: 'systemEvent';
  text: string;
}

/**
 * Action data for agent turn
 */
export interface AgentTurnAction {
  type: 'agentTurn';
  prompt: string;
  model?: string;
  temperature?: number;
}

/**
 * Union of action data types
 */
export type JobActionData = SystemEventAction | AgentTurnAction;

/**
 * Cron job run record
 */
export interface CronRun {
  id: string;
  jobId: string;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

/**
 * Options for creating a cron job
 */
export interface CreateCronJobOptions {
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  timezone?: string;
  actionType: JobActionType;
  actionData: JobActionData;
  deliveryChannel?: string;
  deliveryAnnounce?: boolean;
  sessionId?: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options for updating a cron job
 */
export interface UpdateCronJobOptions {
  name?: string;
  description?: string;
  scheduleValue?: string;
  timezone?: string;
  actionData?: JobActionData;
  deliveryChannel?: string;
  deliveryAnnounce?: boolean;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Options for listing cron jobs
 */
export interface ListCronJobsOptions {
  userId?: string;
  sessionId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Options for listing cron runs
 */
export interface ListCronRunsOptions {
  jobId?: string;
  status?: JobStatus;
  limit?: number;
  offset?: number;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  enabled: boolean;
  checkIntervalSeconds: number;
  maxConcurrentJobs: number;
  runMissedOnStartup: boolean;
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  prompt: string;
  channel?: string;
}
