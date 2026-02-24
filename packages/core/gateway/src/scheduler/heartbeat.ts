/**
 * Heartbeat system - periodic proactive checks using the scheduler
 */
import { createLogger } from '@nachos/types';
import type { Scheduler } from './scheduler.js';
import type { HeartbeatConfig } from './types.js';

const logger = createLogger('heartbeat');

const HEARTBEAT_JOB_NAME = '__system_heartbeat__';
const HEARTBEAT_USER_ID = '__system__';

/**
 * Heartbeat manager
 */
export class HeartbeatManager {
  private scheduler: Scheduler;
  private config: HeartbeatConfig;
  private jobId?: string;

  constructor(scheduler: Scheduler, config: HeartbeatConfig) {
    this.scheduler = scheduler;
    this.config = config;
  }

  /**
   * Start the heartbeat system
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Heartbeat is disabled');
      return;
    }

    logger.info(
      { intervalMinutes: this.config.intervalMinutes },
      'Starting heartbeat system'
    );

    // Check if heartbeat job already exists
    const existingJobs = this.scheduler.listJobs({
      userId: HEARTBEAT_USER_ID,
    });

    const existingJob = existingJobs.find(j => j.name === HEARTBEAT_JOB_NAME);

    if (existingJob) {
      // Update existing job with current config
      const updated = await this.scheduler.updateJob(existingJob.id, {
        scheduleValue: (this.config.intervalMinutes * 60 * 1000).toString(),
        actionData: {
          type: 'systemEvent',
          text: this.config.prompt,
        },
        deliveryChannel: this.config.channel,
        enabled: true,
      });

      if (updated) {
        this.jobId = updated.id;
        logger.info({ jobId: this.jobId }, 'Updated existing heartbeat job');
      }
    } else {
      // Create new heartbeat job
      const job = await this.scheduler.createJob({
        name: HEARTBEAT_JOB_NAME,
        description: 'System heartbeat for proactive assistant checks',
        scheduleType: 'every',
        scheduleValue: (this.config.intervalMinutes * 60 * 1000).toString(),
        timezone: 'UTC',
        actionType: 'systemEvent',
        actionData: {
          type: 'systemEvent',
          text: this.config.prompt,
        },
        deliveryChannel: this.config.channel,
        deliveryAnnounce: false, // Heartbeat shouldn't announce
        userId: HEARTBEAT_USER_ID,
        metadata: {
          system: true,
          heartbeat: true,
        },
      });

      this.jobId = job.id;
      logger.info({ jobId: this.jobId }, 'Created heartbeat job');
    }
  }

  /**
   * Stop the heartbeat system
   */
  async stop(): Promise<void> {
    if (!this.jobId) {
      return;
    }

    logger.info({ jobId: this.jobId }, 'Stopping heartbeat system');

    // Disable the heartbeat job (don't delete it in case we want to resume)
    await this.scheduler.updateJob(this.jobId, { enabled: false });
    this.jobId = undefined;
  }

  /**
   * Update heartbeat configuration
   */
  async updateConfig(config: Partial<HeartbeatConfig>): Promise<void> {
    this.config = { ...this.config, ...config };

    if (!this.jobId) {
      return;
    }

    // Update the job with new config
    await this.scheduler.updateJob(this.jobId, {
      scheduleValue: ((config.intervalMinutes ?? this.config.intervalMinutes) * 60 * 1000).toString(),
      actionData: {
        type: 'systemEvent',
        text: config.prompt ?? this.config.prompt,
      },
      deliveryChannel: config.channel ?? this.config.channel,
      enabled: config.enabled ?? this.config.enabled,
    });

    logger.info({ jobId: this.jobId }, 'Updated heartbeat configuration');
  }

  /**
   * Manually trigger a heartbeat
   */
  async trigger(): Promise<{ success: boolean; error?: string }> {
    if (!this.jobId) {
      return { success: false, error: 'Heartbeat job not initialized' };
    }

    logger.info({ jobId: this.jobId }, 'Manually triggering heartbeat');
    return await this.scheduler.triggerJob(this.jobId);
  }

  /**
   * Get heartbeat job status
   */
  getStatus(): {
    enabled: boolean;
    jobId?: string;
    lastRun?: string;
    nextRun?: string;
  } {
    if (!this.jobId) {
      return { enabled: false };
    }

    const job = this.scheduler.getJob(this.jobId);
    if (!job) {
      return { enabled: false };
    }

    return {
      enabled: job.enabled,
      jobId: job.id,
      lastRun: job.lastRunAt,
      nextRun: job.nextRunAt,
    };
  }
}
