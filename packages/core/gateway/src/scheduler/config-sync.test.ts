/**
 * Tests for config-defined job sync
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Scheduler } from './scheduler.js';
import { SCHEDULER_SCHEMA } from './schema.js';
import { syncConfigJobs, type ConfigJobDefinition } from './config-sync.js';
import type { SchedulerConfig } from './types.js';

describe('Config Sync', () => {
  let db: Database.Database;
  let scheduler: Scheduler;
  const config: SchedulerConfig = {
    enabled: true,
    checkIntervalSeconds: 1,
    maxConcurrentJobs: 5,
    runMissedOnStartup: false,
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEDULER_SCHEMA);
    scheduler = new Scheduler(db, config);
  });

  afterEach(async () => {
    await scheduler.stop();
    db.close();
  });

  const makeJob = (overrides: Partial<ConfigJobDefinition> = {}): ConfigJobDefinition => ({
    name: 'test-job',
    schedule_type: 'every',
    schedule_value: '60000',
    action_type: 'systemEvent',
    action_text: 'Hello from config',
    ...overrides,
  });

  it('should create new config jobs', async () => {
    const result = await syncConfigJobs(scheduler, [
      makeJob({ name: 'job-a' }),
      makeJob({
        name: 'job-b',
        schedule_type: 'cron',
        schedule_value: '0 9 * * 1-5',
        action_type: 'agentTurn',
        action_prompt: 'Morning check',
      }),
    ]);

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.disabled).toBe(0);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.name).sort()).toEqual(['job-a', 'job-b']);
  });

  it('should update existing config jobs when definition changes', async () => {
    // Initial sync
    await syncConfigJobs(scheduler, [makeJob({ name: 'updatable' })]);

    // Change the schedule value
    const result = await syncConfigJobs(scheduler, [
      makeJob({ name: 'updatable', schedule_value: '120000' }),
    ]);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.scheduleValue).toBe('120000');
  });

  it('should not update if nothing changed', async () => {
    const def = makeJob({ name: 'stable' });
    await syncConfigJobs(scheduler, [def]);

    // Sync again with same definition
    const result = await syncConfigJobs(scheduler, [def]);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.disabled).toBe(0);
  });

  it('should disable removed config jobs', async () => {
    await syncConfigJobs(scheduler, [makeJob({ name: 'keep' }), makeJob({ name: 'remove-me' })]);

    // Sync with only one job
    const result = await syncConfigJobs(scheduler, [makeJob({ name: 'keep' })]);

    expect(result.disabled).toBe(1);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    const removed = jobs.find((j) => j.name === 'remove-me');
    expect(removed?.enabled).toBe(false);
  });

  it('should not touch dynamic (non-config) jobs', async () => {
    // Create a dynamic job
    await scheduler.createJob({
      name: 'user-job',
      scheduleType: 'every',
      scheduleValue: '60000',
      actionType: 'systemEvent',
      actionData: { type: 'systemEvent', text: 'User created' },
      userId: 'user-123',
    });

    // Sync config jobs
    const result = await syncConfigJobs(scheduler, [makeJob({ name: 'config-job' })]);

    expect(result.created).toBe(1);

    // User job should still exist and be enabled
    const allJobs = scheduler.listJobs();
    expect(allJobs).toHaveLength(2);
    const userJob = allJobs.find((j) => j.name === 'user-job');
    expect(userJob?.enabled).toBe(true);
  });

  it('should handle empty config jobs array', async () => {
    const result = await syncConfigJobs(scheduler, []);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.disabled).toBe(0);
  });

  it('should handle agentTurn action type', async () => {
    const result = await syncConfigJobs(scheduler, [
      makeJob({
        name: 'agent-job',
        action_type: 'agentTurn',
        action_prompt: 'Run morning briefing',
      }),
    ]);

    expect(result.created).toBe(1);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs[0]?.actionType).toBe('agentTurn');
    expect(jobs[0]?.actionData).toEqual({ type: 'agentTurn', prompt: 'Run morning briefing' });
  });

  it('should create job with enabled=false when config says disabled', async () => {
    await syncConfigJobs(scheduler, [makeJob({ name: 'disabled-job', enabled: false })]);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.enabled).toBe(false);
  });

  it('should detect and apply description-only changes', async () => {
    await syncConfigJobs(scheduler, [
      makeJob({ name: 'desc-job', description: 'Original description' }),
    ]);

    const result = await syncConfigJobs(scheduler, [
      makeJob({ name: 'desc-job', description: 'Updated description' }),
    ]);

    expect(result.updated).toBe(1);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs[0]?.description).toBe('Updated description');
  });

  it('should recreate job when schedule_type changes', async () => {
    await syncConfigJobs(scheduler, [
      makeJob({ name: 'type-change', schedule_type: 'every', schedule_value: '60000' }),
    ]);

    const result = await syncConfigJobs(scheduler, [
      makeJob({ name: 'type-change', schedule_type: 'cron', schedule_value: '0 9 * * *' }),
    ]);

    expect(result.updated).toBe(1);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.scheduleType).toBe('cron');
    expect(jobs[0]?.scheduleValue).toBe('0 9 * * *');
  });

  it('should recreate job when action_type changes', async () => {
    await syncConfigJobs(scheduler, [
      makeJob({ name: 'action-change', action_type: 'systemEvent', action_text: 'Hello' }),
    ]);

    const result = await syncConfigJobs(scheduler, [
      makeJob({ name: 'action-change', action_type: 'agentTurn', action_prompt: 'Do stuff' }),
    ]);

    expect(result.updated).toBe(1);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.actionType).toBe('agentTurn');
    expect(jobs[0]?.actionData).toEqual({ type: 'agentTurn', prompt: 'Do stuff' });
  });

  it('should disable all config jobs when synced with empty array', async () => {
    await syncConfigJobs(scheduler, [
      makeJob({ name: 'will-be-removed-a' }),
      makeJob({ name: 'will-be-removed-b' }),
    ]);

    const result = await syncConfigJobs(scheduler, []);

    expect(result.disabled).toBe(2);

    const jobs = scheduler.listJobs({ userId: '__config__' });
    expect(jobs.every((j) => !j.enabled)).toBe(true);
  });
});
