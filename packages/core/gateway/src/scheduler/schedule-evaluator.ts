/**
 * Schedule evaluation logic for different schedule types
 */
import { DateTime } from 'luxon';
import { createLogger } from '@nachos/types';
import type { CronJob } from './types.js';

const logger = createLogger('schedule-evaluator');

/**
 * Parse cron expression and get next run time
 * Supports standard cron format: minute hour day month weekday
 * Example: "0 9 * * 1-5" = 9:00 AM on weekdays
 */
function parseCronExpression(expression: string, timezone: string, fromTime?: Date): Date | null {
  try {
    // Simple cron parser - for production, consider using a library like 'cron-parser'
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      logger.warn({ expression }, 'Invalid cron expression format');
      return null;
    }

    const [minute = '*', hour = '*', dayOfMonth = '*', month = '*', dayOfWeek = '*'] = parts;
    const now = fromTime
      ? DateTime.fromJSDate(fromTime).setZone(timezone)
      : DateTime.now().setZone(timezone);

    // Start from next minute
    let candidate = now.plus({ minutes: 1 }).startOf('minute');

    // Find next matching time (max 1000 iterations to prevent infinite loops)
    for (let i = 0; i < 1000; i++) {
      if (
        matchesCronPart(minute, candidate.minute) &&
        matchesCronPart(hour, candidate.hour) &&
        matchesCronPart(dayOfMonth, candidate.day) &&
        matchesCronPart(month, candidate.month) &&
        matchesCronPart(dayOfWeek, candidate.weekday % 7) // 0=Sunday
      ) {
        return candidate.toJSDate();
      }

      // Move to next minute
      candidate = candidate.plus({ minutes: 1 });
    }

    logger.warn({ expression }, 'Could not find next cron match within 1000 iterations');
    return null;
  } catch (error) {
    logger.error({ expression, error }, 'Error parsing cron expression');
    return null;
  }
}

/**
 * Check if a value matches a cron part (supports *, ranges, lists, steps)
 */
function matchesCronPart(part: string, value: number): boolean {
  // * matches everything
  if (part === '*') {
    return true;
  }

  // Handle step values (e.g., */5)
  if (part.includes('/')) {
    const [range, step] = part.split('/');
    const stepNum = parseInt(step ?? '1', 10);
    if (range === '*') {
      return value % stepNum === 0;
    }
  }

  // Handle ranges (e.g., 1-5)
  if (part.includes('-')) {
    const rangeParts = part.split('-');
    const start = parseInt(rangeParts[0] ?? '0', 10);
    const end = parseInt(rangeParts[1] ?? '0', 10);
    return value >= start && value <= end;
  }

  // Handle lists (e.g., 1,3,5)
  if (part.includes(',')) {
    const values = part.split(',').map(n => parseInt(n, 10));
    return values.includes(value);
  }

  // Exact match
  return parseInt(part, 10) === value;
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
      // Cron expression
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
 * Validate schedule value for a given schedule type
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
      // Must be valid cron expression (5 parts)
      const parts = scheduleValue.trim().split(/\s+/);
      return parts.length === 5;
    }

    default:
      return false;
  }
}
