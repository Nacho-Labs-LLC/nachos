/**
 * Cron scheduler tool schemas and execution
 */
import type { ToolCall, ToolResult } from '@nachos/types';
import { createLogger } from '@nachos/types';
import type { Scheduler } from '../scheduler/scheduler.js';
import type { CreateCronJobOptions, UpdateCronJobOptions } from '../scheduler/types.js';
import { validateScheduleValue } from '../scheduler/schedule-evaluator.js';

const logger = createLogger('cron-tools');

/**
 * nachos_cron_add tool schema
 */
export const CronAddToolSchema = {
  $id: 'nachos_cron_add',
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name for this cron job',
    },
    description: {
      type: 'string',
      description: 'Optional description of what this job does',
    },
    scheduleType: {
      type: 'string',
      enum: ['at', 'every', 'cron'],
      description:
        'Schedule type: "at" (one-shot at timestamp), "every" (interval in ms), "cron" (cron expression)',
    },
    scheduleValue: {
      type: 'string',
      description:
        'Schedule value: ISO timestamp for "at", milliseconds for "every", cron expression for "cron" (e.g., "0 9 * * 1-5")',
    },
    timezone: {
      type: 'string',
      description: 'Timezone for schedule (e.g., "America/New_York"). Default: UTC',
      default: 'UTC',
    },
    actionType: {
      type: 'string',
      enum: ['systemEvent', 'agentTurn'],
      description:
        'Action type: "systemEvent" (inject text into session) or "agentTurn" (spawn isolated agent run)',
    },
    actionPrompt: {
      type: 'string',
      description: 'Prompt/text for the action',
    },
    deliveryChannel: {
      type: 'string',
      description: 'Optional channel to deliver results to (e.g., "discord")',
    },
    deliveryAnnounce: {
      type: 'boolean',
      description: 'Whether to announce the job execution to the channel',
      default: false,
    },
  },
  required: ['name', 'scheduleType', 'scheduleValue', 'actionType', 'actionPrompt'],
};

/**
 * nachos_cron_list tool schema
 */
export const CronListToolSchema = {
  $id: 'nachos_cron_list',
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      description: 'Filter by enabled status (optional)',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of jobs to return',
      default: 50,
    },
  },
};

/**
 * nachos_cron_remove tool schema
 */
export const CronRemoveToolSchema = {
  $id: 'nachos_cron_remove',
  type: 'object',
  properties: {
    jobId: {
      type: 'string',
      description: 'ID of the job to remove',
    },
  },
  required: ['jobId'],
};

/**
 * nachos_cron_update tool schema
 */
export const CronUpdateToolSchema = {
  $id: 'nachos_cron_update',
  type: 'object',
  properties: {
    jobId: {
      type: 'string',
      description: 'ID of the job to update',
    },
    name: {
      type: 'string',
      description: 'New name for the job',
    },
    description: {
      type: 'string',
      description: 'New description',
    },
    scheduleValue: {
      type: 'string',
      description: 'New schedule value',
    },
    timezone: {
      type: 'string',
      description: 'New timezone',
    },
    actionPrompt: {
      type: 'string',
      description: 'New prompt/text for the action',
    },
    enabled: {
      type: 'boolean',
      description: 'Enable or disable the job',
    },
    deliveryChannel: {
      type: 'string',
      description: 'New delivery channel',
    },
    deliveryAnnounce: {
      type: 'boolean',
      description: 'New delivery announce setting',
    },
  },
  required: ['jobId'],
};

/**
 * nachos_cron_run tool schema
 */
export const CronRunToolSchema = {
  $id: 'nachos_cron_run',
  type: 'object',
  properties: {
    jobId: {
      type: 'string',
      description: 'ID of the job to run manually',
    },
  },
  required: ['jobId'],
};

/**
 * Execute nachos_cron_add tool
 */
export async function executeCronAdd(
  call: ToolCall,
  scheduler: Scheduler,
  userId: string,
  sessionId?: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      name: string;
      description?: string;
      scheduleType: 'at' | 'every' | 'cron';
      scheduleValue: string;
      timezone?: string;
      actionType: 'systemEvent' | 'agentTurn';
      actionPrompt: string;
      deliveryChannel?: string;
      deliveryAnnounce?: boolean;
    };

    // Validate schedule value
    if (!validateScheduleValue(params.scheduleType, params.scheduleValue)) {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_SCHEDULE',
          message: `Invalid schedule value for type "${params.scheduleType}": ${params.scheduleValue}`,
        },
      };
    }

    const jobOptions: CreateCronJobOptions = {
      name: params.name,
      description: params.description,
      scheduleType: params.scheduleType,
      scheduleValue: params.scheduleValue,
      timezone: params.timezone ?? 'UTC',
      actionType: params.actionType,
      actionData:
        params.actionType === 'systemEvent'
          ? { type: 'systemEvent', text: params.actionPrompt }
          : { type: 'agentTurn', prompt: params.actionPrompt },
      deliveryChannel: params.deliveryChannel,
      deliveryAnnounce: params.deliveryAnnounce ?? false,
      userId,
      sessionId,
    };

    const job = await scheduler.createJob(jobOptions);

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Created cron job "${job.name}" (ID: ${job.id})\nSchedule: ${job.scheduleType} ${job.scheduleValue}\nNext run: ${job.nextRunAt || 'not scheduled'}`,
        },
      ],
    };
  } catch (error) {
    logger.error({ error }, 'Failed to create cron job');
    return {
      success: false,
      content: [],
      error: {
        code: 'CRON_ADD_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Execute nachos_cron_list tool
 */
export async function executeCronList(
  call: ToolCall,
  scheduler: Scheduler,
  userId: string,
  sessionId?: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      enabled?: boolean;
      limit?: number;
    };

    const jobs = scheduler.listJobs({
      userId,
      sessionId,
      enabled: params.enabled,
      limit: params.limit ?? 50,
    });

    if (jobs.length === 0) {
      return {
        success: true,
        content: [
          {
            type: 'text',
            text: 'No cron jobs found.',
          },
        ],
      };
    }

    const jobsList = jobs
      .map((job, idx) => {
        const status = job.enabled ? '✓' : '✗';
        const schedule = `${job.scheduleType}:${job.scheduleValue}`;
        const nextRun = job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'not scheduled';
        return `${idx + 1}. [${status}] ${job.name} (${job.id})\n   Schedule: ${schedule}\n   Next run: ${nextRun}\n   Action: ${job.actionType}`;
      })
      .join('\n\n');

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Found ${jobs.length} cron job(s):\n\n${jobsList}`,
        },
      ],
    };
  } catch (error) {
    logger.error({ error }, 'Failed to list cron jobs');
    return {
      success: false,
      content: [],
      error: {
        code: 'CRON_LIST_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Execute nachos_cron_remove tool
 */
export async function executeCronRemove(
  call: ToolCall,
  scheduler: Scheduler,
  userId: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      jobId: string;
    };

    // Verify job exists and belongs to user
    const job = scheduler.getJob(params.jobId);
    if (!job) {
      return {
        success: false,
        content: [],
        error: {
          code: 'JOB_NOT_FOUND',
          message: `Job ${params.jobId} not found`,
        },
      };
    }

    if (job.userId !== userId && job.userId !== '__system__') {
      return {
        success: false,
        content: [],
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to remove this job',
        },
      };
    }

    const deleted = await scheduler.deleteJob(params.jobId);

    if (!deleted) {
      return {
        success: false,
        content: [],
        error: {
          code: 'CRON_REMOVE_FAILED',
          message: 'Failed to delete job',
        },
      };
    }

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Deleted cron job "${job.name}" (${job.id})`,
        },
      ],
    };
  } catch (error) {
    logger.error({ error }, 'Failed to remove cron job');
    return {
      success: false,
      content: [],
      error: {
        code: 'CRON_REMOVE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Execute nachos_cron_update tool
 */
export async function executeCronUpdate(
  call: ToolCall,
  scheduler: Scheduler,
  userId: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      jobId: string;
      name?: string;
      description?: string;
      scheduleValue?: string;
      timezone?: string;
      actionPrompt?: string;
      enabled?: boolean;
      deliveryChannel?: string;
      deliveryAnnounce?: boolean;
    };

    // Verify job exists and belongs to user
    const job = scheduler.getJob(params.jobId);
    if (!job) {
      return {
        success: false,
        content: [],
        error: {
          code: 'JOB_NOT_FOUND',
          message: `Job ${params.jobId} not found`,
        },
      };
    }

    if (job.userId !== userId && job.userId !== '__system__') {
      return {
        success: false,
        content: [],
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to update this job',
        },
      };
    }

    // Validate schedule value if provided
    if (params.scheduleValue && !validateScheduleValue(job.scheduleType, params.scheduleValue)) {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_SCHEDULE',
          message: `Invalid schedule value for type "${job.scheduleType}": ${params.scheduleValue}`,
        },
      };
    }

    const updateOptions: UpdateCronJobOptions = {
      name: params.name,
      description: params.description,
      scheduleValue: params.scheduleValue,
      timezone: params.timezone,
      enabled: params.enabled,
      deliveryChannel: params.deliveryChannel,
      deliveryAnnounce: params.deliveryAnnounce,
    };

    // Update action data if prompt changed
    if (params.actionPrompt) {
      updateOptions.actionData =
        job.actionType === 'systemEvent'
          ? { type: 'systemEvent', text: params.actionPrompt }
          : { type: 'agentTurn', prompt: params.actionPrompt };
    }

    const updated = await scheduler.updateJob(params.jobId, updateOptions);

    if (!updated) {
      return {
        success: false,
        content: [],
        error: {
          code: 'CRON_UPDATE_FAILED',
          message: 'Failed to update job',
        },
      };
    }

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Updated cron job "${updated.name}" (${updated.id})\nNext run: ${updated.nextRunAt || 'not scheduled'}`,
        },
      ],
    };
  } catch (error) {
    logger.error({ error }, 'Failed to update cron job');
    return {
      success: false,
      content: [],
      error: {
        code: 'CRON_UPDATE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Execute nachos_cron_run tool
 */
export async function executeCronRun(
  call: ToolCall,
  scheduler: Scheduler,
  userId: string
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      jobId: string;
    };

    // Verify job exists and belongs to user
    const job = scheduler.getJob(params.jobId);
    if (!job) {
      return {
        success: false,
        content: [],
        error: {
          code: 'JOB_NOT_FOUND',
          message: `Job ${params.jobId} not found`,
        },
      };
    }

    if (job.userId !== userId && job.userId !== '__system__') {
      return {
        success: false,
        content: [],
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to run this job',
        },
      };
    }

    const result = await scheduler.triggerJob(params.jobId);

    if (!result.success) {
      return {
        success: false,
        content: [],
        error: {
          code: 'CRON_RUN_FAILED',
          message: result.error || 'Failed to run job',
        },
      };
    }

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Manually triggered cron job "${job.name}" (run ID: ${result.runId})`,
        },
      ],
    };
  } catch (error) {
    logger.error({ error }, 'Failed to run cron job');
    return {
      success: false,
      content: [],
      error: {
        code: 'CRON_RUN_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
