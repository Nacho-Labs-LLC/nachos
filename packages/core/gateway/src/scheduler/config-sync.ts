/**
 * Config-defined job sync
 *
 * On gateway startup, syncs jobs declared in nachos.toml [[scheduler.jobs]]
 * to the scheduler's SQLite registry. Config is source of truth for static
 * jobs; dynamically-created jobs (via API/tool) are left untouched.
 */
import { createLogger } from '@nachos/types';
import type { Scheduler } from './scheduler.js';
import type { CronJob } from './types.js';

const logger = createLogger('scheduler-config-sync');

/** Source marker — stored in job metadata to distinguish config vs dynamic */
const CONFIG_SOURCE = 'config';
const CONFIG_USER_ID = '__config__';

export interface ConfigJobDefinition {
  name: string;
  description?: string;
  schedule_type: 'at' | 'every' | 'cron';
  schedule_value: string;
  timezone?: string;
  action_type: 'systemEvent' | 'agentTurn';
  action_text?: string;
  action_prompt?: string;
  delivery_channel?: string;
  enabled?: boolean;
}

/**
 * Sync config-defined jobs to the scheduler registry.
 *
 * - Creates new jobs for config entries that don't exist yet
 * - Updates existing config jobs if their definition changed
 * - Recreates jobs when scheduleType or actionType changes (not updatable)
 * - Disables config jobs that were removed from config
 */
export async function syncConfigJobs(
  scheduler: Scheduler,
  configJobs: ConfigJobDefinition[]
): Promise<{ created: number; updated: number; disabled: number }> {
  const stats = { created: 0, updated: 0, disabled: 0 };

  // Get all existing config-sourced jobs
  const existingJobs = scheduler.listJobs({ userId: CONFIG_USER_ID });
  const existingByName = new Map<string, CronJob>();
  for (const job of existingJobs) {
    existingByName.set(job.name, job);
  }

  const configJobNames = new Set<string>();

  for (const def of configJobs) {
    configJobNames.add(def.name);

    const actionData =
      def.action_type === 'systemEvent'
        ? { type: 'systemEvent' as const, text: def.action_text ?? '' }
        : { type: 'agentTurn' as const, prompt: def.action_prompt ?? '' };

    const existing = existingByName.get(def.name);

    if (existing) {
      // If scheduleType or actionType changed, we must delete+recreate
      // because UpdateCronJobOptions cannot change these fields
      const scheduleTypeChanged = existing.scheduleType !== def.schedule_type;
      const actionTypeChanged = existing.actionType !== def.action_type;

      if (scheduleTypeChanged || actionTypeChanged) {
        await scheduler.deleteJob(existing.id);
        await scheduler.createJob({
          name: def.name,
          description: def.description,
          scheduleType: def.schedule_type,
          scheduleValue: def.schedule_value,
          timezone: def.timezone ?? 'UTC',
          actionType: def.action_type,
          actionData,
          deliveryChannel: def.delivery_channel,
          userId: CONFIG_USER_ID,
          metadata: { source: CONFIG_SOURCE },
        });
        // If config says disabled, immediately disable the recreated job
        if (def.enabled === false) {
          const recreated = scheduler
            .listJobs({ userId: CONFIG_USER_ID })
            .find((j) => j.name === def.name);
          if (recreated) {
            await scheduler.updateJob(recreated.id, { enabled: false });
          }
        }
        stats.updated++;
        logger.info({ jobName: def.name }, 'Recreated config-defined job (type changed)');
        continue;
      }

      // Check if any other fields changed
      const needsUpdate =
        existing.scheduleValue !== def.schedule_value ||
        existing.timezone !== (def.timezone ?? 'UTC') ||
        JSON.stringify(existing.actionData) !== JSON.stringify(actionData) ||
        existing.deliveryChannel !== def.delivery_channel ||
        (existing.description ?? '') !== (def.description ?? '') ||
        existing.enabled !== (def.enabled ?? true);

      if (needsUpdate) {
        await scheduler.updateJob(existing.id, {
          scheduleValue: def.schedule_value,
          timezone: def.timezone ?? 'UTC',
          actionData,
          deliveryChannel: def.delivery_channel,
          enabled: def.enabled ?? true,
          description: def.description,
          metadata: { source: CONFIG_SOURCE },
        });
        stats.updated++;
        logger.info({ jobName: def.name }, 'Updated config-defined job');
      }
    } else {
      // Create new job
      const job = await scheduler.createJob({
        name: def.name,
        description: def.description,
        scheduleType: def.schedule_type,
        scheduleValue: def.schedule_value,
        timezone: def.timezone ?? 'UTC',
        actionType: def.action_type,
        actionData,
        deliveryChannel: def.delivery_channel,
        userId: CONFIG_USER_ID,
        metadata: { source: CONFIG_SOURCE },
      });
      // createJob always sets enabled=true; honor config's enabled flag
      if (def.enabled === false) {
        await scheduler.updateJob(job.id, { enabled: false });
      }
      stats.created++;
      logger.info({ jobName: def.name }, 'Created config-defined job');
    }
  }

  // Disable config jobs that were removed from config
  for (const [name, job] of existingByName) {
    if (!configJobNames.has(name) && job.enabled) {
      await scheduler.updateJob(job.id, { enabled: false });
      stats.disabled++;
      logger.info({ jobName: name }, 'Disabled removed config job');
    }
  }

  logger.info(stats, 'Config job sync complete');
  return stats;
}
