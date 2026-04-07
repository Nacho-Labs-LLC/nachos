/**
 * Schedule evaluation logic for different schedule types
 *
 * Uses the cron-parser library for robust cron expression parsing
 * instead of a hand-rolled implementation.
 */
import { DateTime } from 'luxon';
import { CronExpressionParser } from 'cron-parser';
import { createLogger } from '@nachos/types';
import type { CronJob } from './types.js';

const logger = createLogger('schedule-evaluator');

/**
 * Parse cron expression and get next run time using cron-parser library.
 * Supports standard 5-field cron format: minute hour day month weekday
 * Example: "0 9 * * 1-5" = 9:00 AM on weekdays
 */
function parseCronExpression(expression: string, timezone: string, fromTime?: Date): Date | null {
  try {
    const expr = CronExpressionParser.parse(expression, {
      tz: timezone,
      currentDate: fromTime ?? new Date(),
    });

    const next = expr.next();
    return next.toDate();
  } catch (error) {
    logger.error({ expression, timezone, error }, 'Error parsing cron expression');
    return null;
  }
}

/**
 * Calculate the next run time for a cron job
 */
export function calculateNextRunTime(job: CronJob, fromTime?: Date): Date | null {
  const now = fromTime || new Date();

  switch (job.scheduleType) {
    case 'at': {
      // One-shot at specific timestamp
      const targetTime = DateTime.fromISO(job.scheduleValue, { zone: job.timezone });
      if (!targetTime.isValid) {
        logger.warn({ jobId: job.id, scheduleValue: job.scheduleValue }, 'Invalid ISO timestamp');
        return null;
      }

      // If target time is in the past, don't run
      if (targetTime.toJSDate() <= now) {
        return null;
      }

      return targetTime.toJSDate();
    }

    case 'every': {
      // Interval in milliseconds
      const intervalMs = parseInt(job.scheduleValue, 10);
      if (isNaN(intervalMs) || intervalMs <= 0) {
        logger.warn({ jobId: job.id, scheduleValue: job.scheduleValue }, 'Invalid interval');
        return null;
      }

      // If job has never run, schedule it now + interval
      if (!job.lastRunAt) {
        return new Date(now.getTime() + intervalMs);
      }

      // Schedule next run based on last run time
      const lastRun = new Date(job.lastRunAt);
      return new Date(lastRun.getTime() + intervalMs);
    }

    case 'cron': {
      // Cron expression — delegated to cron-parser
      return parseCronExpression(job.scheduleValue, job.timezone, now);
    }

    default:
      logger.warn({ jobId: job.id, scheduleType: job.scheduleType }, 'Unknown schedule type');
      return null;
  }
}

/**
 * Check if a job should run now
 */
export function shouldRunNow(job: CronJob, currentTime: Date = new Date()): boolean {
  if (!job.enabled) {
    return false;
  }

  if (!job.nextRunAt) {
    return false;
  }

  const nextRun = new Date(job.nextRunAt);
  return nextRun <= currentTime;
}

/**
 * Validate schedule value for a given schedule type.
 * Returns true if the value is syntactically valid.
 */
export function validateScheduleValue(scheduleType: string, scheduleValue: string): boolean {
  switch (scheduleType) {
    case 'at': {
      // Must be valid ISO timestamp
      const dt = DateTime.fromISO(scheduleValue);
      return dt.isValid;
    }

    case 'every': {
      // Must be positive integer (milliseconds)
      const interval = parseInt(scheduleValue, 10);
      return !isNaN(interval) && interval > 0;
    }

    case 'cron': {
      // Use cron-parser to validate
      try {
        CronExpressionParser.parse(scheduleValue);
        return true;
      } catch {
        return false;
      }
    }

    default:
      return false;
  }
}
