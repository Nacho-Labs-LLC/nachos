/**
 * Tests for the scheduler system
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Scheduler } from './scheduler.js';
import { SCHEDULER_SCHEMA } from './schema.js';
import type { SchedulerConfig, CronJob } from './types.js';

describe('Scheduler', () => {
  let db: Database.Database;
  let scheduler: Scheduler;
  const mockConfig: SchedulerConfig = {
    enabled: true,
    checkIntervalSeconds: 1,
    maxConcurrentJobs: 5,
    runMissedOnStartup: false,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEDULER_SCHEMA);
    scheduler = new Scheduler(db, mockConfig);
  });

  afterEach(async () => {
    await scheduler.stop();
    db.close();
  });

  describe('Job Creation', () => {
    it('should create a one-shot job (at)', async () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const job = await scheduler.createJob({
        name: 'Test At Job',
        scheduleType: 'at',
        scheduleValue: futureTime,
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test message' },
        userId: 'test-user',
      });

      expect(job).toBeDefined();
      expect(job.name).toBe('Test At Job');
      expect(job.scheduleType).toBe('at');
      expect(job.enabled).toBe(true);
      expect(job.nextRunAt).toBeDefined();
    });

    it('should create an interval job (every)', async () => {
      const job = await scheduler.createJob({
        name: 'Test Every Job',
        scheduleType: 'every',
        scheduleValue: '60000', // 1 minute
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Recurring message' },
        userId: 'test-user',
      });

      expect(job).toBeDefined();
      expect(job.name).toBe('Test Every Job');
      expect(job.scheduleType).toBe('every');
      expect(job.nextRunAt).toBeDefined();
    });

    it('should create a cron job', async () => {
      const job = await scheduler.createJob({
        name: 'Test Cron Job',
        scheduleType: 'cron',
        scheduleValue: '0 9 * * 1-5', // 9 AM weekdays
        actionType: 'agentTurn',
        actionData: { type: 'agentTurn', prompt: 'Daily check' },
        userId: 'test-user',
      });

      expect(job).toBeDefined();
      expect(job.name).toBe('Test Cron Job');
      expect(job.scheduleType).toBe('cron');
      expect(job.actionType).toBe('agentTurn');
    });
  });

  describe('Job Management', () => {
    it('should list jobs', async () => {
      await scheduler.createJob({
        name: 'Job 1',
        scheduleType: 'every',
        scheduleValue: '60000',
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test' },
        userId: 'user1',
      });

      await scheduler.createJob({
        name: 'Job 2',
        scheduleType: 'every',
        scheduleValue: '120000',
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test' },
        userId: 'user1',
      });

      const jobs = scheduler.listJobs({ userId: 'user1' });
      expect(jobs).toHaveLength(2);
    });

    it('should update a job', async () => {
      const job = await scheduler.createJob({
        name: 'Original Name',
        scheduleType: 'every',
        scheduleValue: '60000',
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test' },
        userId: 'user1',
      });

      const updated = await scheduler.updateJob(job.id, {
        name: 'Updated Name',
        enabled: false,
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.enabled).toBe(false);
    });

    it('should delete a job', async () => {
      const job = await scheduler.createJob({
        name: 'To Delete',
        scheduleType: 'every',
        scheduleValue: '60000',
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test' },
        userId: 'user1',
      });

      const deleted = await scheduler.deleteJob(job.id);
      expect(deleted).toBe(true);

      const retrieved = scheduler.getJob(job.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Job Execution', () => {
    it('should execute a job when triggered manually', async () => {
      let executedJob: CronJob | null = null;

      scheduler.setExecutor(async (job) => {
        executedJob = job;
        return { success: true, result: 'Executed' };
      });

      const job = await scheduler.createJob({
        name: 'Manual Trigger',
        scheduleType: 'every',
        scheduleValue: '60000',
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test' },
        userId: 'user1',
      });

      const result = await scheduler.triggerJob(job.id);
      expect(result.success).toBe(true);
      expect(executedJob).toBeDefined();
      expect(executedJob?.id).toBe(job.id);
    });

    it('should track job runs', async () => {
      scheduler.setExecutor(async () => {
        return { success: true, result: 'Executed' };
      });

      const job = await scheduler.createJob({
        name: 'Track Runs',
        scheduleType: 'every',
        scheduleValue: '60000',
        actionType: 'systemEvent',
        actionData: { type: 'systemEvent', text: 'Test' },
        userId: 'user1',
      });

      await scheduler.triggerJob(job.id);

      const runs = scheduler.listRuns({ jobId: job.id });
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('success');
    });
  });
});
