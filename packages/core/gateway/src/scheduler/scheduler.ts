/**
 * Main scheduler service for managing cron jobs
 */
import type Database from 'better-sqlite3';
import { createLogger } from '@nachos/types';
import { TOPICS } from '@nachos/bus';
import type { MessageBus } from '../router.js';
import { SchedulerStorage } from './storage.js';
import { calculateNextRunTime } from './schedule-evaluator.js';
import type {
  CronJob,
  CronRun,
  CreateCronJobOptions,
  UpdateCronJobOptions,
  ListCronJobsOptions,
  ListCronRunsOptions,
  SchedulerConfig,
} from './types.js';

const logger = createLogger('scheduler');

/**
 * Job executor callback
 */
export type JobExecutor = (
  job: CronJob
) => Promise<{ success: boolean; result?: string; error?: string }>;

/**
 * Scheduler service
 */
export class Scheduler {
  private storage: SchedulerStorage;
  private config: SchedulerConfig;
  private running = false;
  private checkInterval?: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private executor?: JobExecutor;
  private messageBus?: MessageBus;

  constructor(
    db: Database.Database,
    config: SchedulerConfig,
    executor?: JobExecutor,
    messageBus?: MessageBus
  ) {
    this.storage = new SchedulerStorage(db);
    this.config = config;
    this.executor = executor;
    this.messageBus = messageBus;
  }

  /**
   * Set the job executor function
   */
  setExecutor(executor: JobExecutor): void {
    this.executor = executor;
  }

  /**
   * Set the message bus for event publishing
   */
  setMessageBus(messageBus: MessageBus): void {
    this.messageBus = messageBus;
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Scheduler is disabled');
      return;
    }

    if (this.running) {
      logger.warn('Scheduler is already running');
      return;
    }

    this.running = true;
    logger.info({ checkIntervalSeconds: this.config.checkIntervalSeconds }, 'Starting scheduler');

    // Calculate next run times for all enabled jobs
    await this.recalculateAllNextRunTimes();

    // Run missed jobs if configured
    if (this.config.runMissedOnStartup) {
      await this.runMissedJobs();
    }

    // Start periodic check
    this.checkInterval = setInterval(
      () => this.checkAndRunJobs(),
      this.config.checkIntervalSeconds * 1000
    );

    // Run initial check
    await this.checkAndRunJobs();
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping scheduler');
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    // Wait for running jobs to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const start = Date.now();
    while (this.runningJobs.size > 0 && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.runningJobs.size > 0) {
      logger.warn(
        { runningJobs: Array.from(this.runningJobs) },
        'Scheduler stopped with running jobs'
      );
    }
  }

  /**
   * Check for due jobs and run them
   */
  private async checkAndRunJobs(): Promise<void> {
    if (!this.running) {
      return;
    }

    const now = new Date();
    const dueJobs = this.storage.getDueJobs(now);

    logger.debug({ count: dueJobs.length }, 'Checking for due jobs');

    for (const job of dueJobs) {
      // Skip if already running
      if (this.runningJobs.has(job.id)) {
        logger.debug({ jobId: job.id }, 'Job is already running');
        continue;
      }

      // Check concurrent job limit
      if (this.runningJobs.size >= this.config.maxConcurrentJobs) {
        logger.warn(
          { maxConcurrent: this.config.maxConcurrentJobs },
          'Max concurrent jobs reached, skipping job execution'
        );
        break;
      }

      // Run job asynchronously
      this.runJob(job).catch((error) => {
        logger.error({ jobId: job.id, error }, 'Error running job');
      });
    }
  }

  /**
   * Run missed jobs (jobs that should have run while scheduler was down)
   */
  private async runMissedJobs(): Promise<void> {
    const now = new Date();
    const missedJobs = this.storage.getDueJobs(now);

    if (missedJobs.length === 0) {
      return;
    }

    logger.info({ count: missedJobs.length }, 'Running missed jobs');

    for (const job of missedJobs) {
      await this.runJob(job);
    }
  }

  /**
   * Recalculate next run times for all enabled jobs
   */
  private async recalculateAllNextRunTimes(): Promise<void> {
    const jobs = this.storage.listJobs({ enabled: true });

    logger.info({ count: jobs.length }, 'Recalculating next run times for all jobs');

    for (const job of jobs) {
      const nextRunAt = calculateNextRunTime(job);
      if (nextRunAt) {
        this.storage.updateJobRunTimes(
          job.id,
          job.lastRunAt ? new Date(job.lastRunAt) : new Date(),
          nextRunAt
        );
      }
    }
  }

  /**
   * Run a specific job
   */
  private async runJob(job: CronJob): Promise<void> {
    if (!this.executor) {
      logger.error({ jobId: job.id }, 'No executor configured');
      return;
    }

    this.runningJobs.add(job.id);
    const run = this.storage.createRun(job.id);

    logger.info({ jobId: job.id, runId: run.id, jobName: job.name }, 'Running job');

    // Publish job fired event
    if (this.messageBus) {
      await this.messageBus.publish(TOPICS.scheduler.jobFired, {
        jobId: job.id,
        runId: run.id,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const result = await this.executor(job);

      this.storage.updateRun(run.id, {
        status: result.success ? 'success' : 'failed',
        result: result.result,
        error: result.error,
      });

      logger.info({ jobId: job.id, runId: run.id, success: result.success }, 'Job completed');

      // Publish job completed event
      if (this.messageBus) {
        await this.messageBus.publish(TOPICS.scheduler.jobCompleted, {
          jobId: job.id,
          runId: run.id,
          status: result.success ? 'success' : 'failed',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error({ jobId: job.id, runId: run.id, error }, 'Job execution failed');

      this.storage.updateRun(run.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.runningJobs.delete(job.id);

      // Calculate and update next run time
      const now = new Date();
      const nextRunAt = calculateNextRunTime(job, now);

      this.storage.updateJobRunTimes(job.id, now, nextRunAt ?? undefined);

      // If it's a one-shot job (at) and it's done, disable it
      if (job.scheduleType === 'at' && !nextRunAt) {
        this.storage.updateJob(job.id, { enabled: false });
        logger.info({ jobId: job.id }, 'One-shot job completed, disabled');
      }
    }
  }

  /**
   * Create a new cron job
   */
  async createJob(options: CreateCronJobOptions): Promise<CronJob> {
    const job = this.storage.createJob(options);

    // Calculate initial next run time
    const nextRunAt = calculateNextRunTime(job);
    if (nextRunAt) {
      this.storage.updateJobRunTimes(job.id, new Date(), nextRunAt);
    }

    logger.info({ jobId: job.id, jobName: job.name }, 'Created cron job');

    // Publish job created event
    if (this.messageBus) {
      await this.messageBus.publish(TOPICS.scheduler.jobCreated, {
        jobId: job.id,
        timestamp: new Date().toISOString(),
      });
    }

    return this.storage.getJob(job.id) || job;
  }

  /**
   * Update a cron job
   */
  async updateJob(id: string, options: UpdateCronJobOptions): Promise<CronJob | null> {
    const updated = this.storage.updateJob(id, options);

    if (!updated) {
      return null;
    }

    // Recalculate next run time if schedule changed
    if (options.scheduleValue || options.timezone) {
      const nextRunAt = calculateNextRunTime(updated);
      if (nextRunAt) {
        this.storage.updateJobRunTimes(updated.id, new Date(), nextRunAt);
      }
    }

    logger.info({ jobId: id }, 'Updated cron job');

    // Publish job updated event
    if (this.messageBus) {
      await this.messageBus.publish(TOPICS.scheduler.jobUpdated, {
        jobId: id,
        timestamp: new Date().toISOString(),
      });
    }

    return this.storage.getJob(id);
  }

  /**
   * Delete a cron job
   */
  async deleteJob(id: string): Promise<boolean> {
    const deleted = this.storage.deleteJob(id);

    if (deleted) {
      logger.info({ jobId: id }, 'Deleted cron job');

      // Publish job deleted event
      if (this.messageBus) {
        await this.messageBus.publish(TOPICS.scheduler.jobDeleted, {
          jobId: id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return deleted;
  }

  /**
   * Get a cron job by ID
   */
  getJob(id: string): CronJob | null {
    return this.storage.getJob(id);
  }

  /**
   * List cron jobs
   */
  listJobs(options?: ListCronJobsOptions): CronJob[] {
    return this.storage.listJobs(options);
  }

  /**
   * List cron runs
   */
  listRuns(options?: ListCronRunsOptions): CronRun[] {
    return this.storage.listRuns(options);
  }

  /**
   * Manually trigger a job run
   */
  async triggerJob(id: string): Promise<{ success: boolean; runId?: string; error?: string }> {
    const job = this.storage.getJob(id);

    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    if (!this.executor) {
      return { success: false, error: 'No executor configured' };
    }

    const run = this.storage.createRun(job.id);

    try {
      const result = await this.executor(job);

      this.storage.updateRun(run.id, {
        status: result.success ? 'success' : 'failed',
        result: result.result,
        error: result.error,
      });

      return { success: result.success, runId: run.id, error: result.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      this.storage.updateRun(run.id, {
        status: 'failed',
        error: errorMsg,
      });

      return { success: false, runId: run.id, error: errorMsg };
    }
  }
}
