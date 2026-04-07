/**
 * nachos subagents commands
 */

import chalk from 'chalk';
import { TOPICS, type NachosBusClient } from '@nachos/bus';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { CLIError } from '../core/errors.js';
import { createCliBusClient } from '../core/nats-client.js';
import { getVersion } from '../cli.js';

interface SubagentsListOptions {
  json?: boolean;
  limit?: number;
}

interface SubagentIdOptions {
  json?: boolean;
  limit?: number;
}

interface SubagentFilesListOptions {
  json?: boolean;
  path?: string;
  recursive?: boolean;
  limit?: number;
}

interface SubagentFilesGetOptions {
  json?: boolean;
  path?: string;
  maxBytes?: number;
}

interface SubagentSpawnOptions {
  json?: boolean;
  label?: string;
  profile?: string;
  agentId?: string;
  model?: string;
  thinking?: string;
  timeout?: number;
  cleanup?: string;
}

type GatewayResponse<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

export async function subagentsListCommand(options: SubagentsListOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents list', getVersion());
  const client = await createCliBusClient();

  try {
    const response = await requestGateway<{ runs: Array<Record<string, unknown>>; total: number }>(
      client,
      TOPICS.gateway.subagents.list,
      { limit: options.limit }
    );

    if (options.json) {
      output.success(response);
      return;
    }

    const runs = response.runs ?? [];
    prettyOutput.brandedHeader('Subagent Runs');
    prettyOutput.blank();

    if (runs.length === 0) {
      prettyOutput.warn('No subagent runs found');
      prettyOutput.blank();
      return;
    }

    for (const run of runs) {
      const status = String(run.status ?? 'unknown');
      const statusColor =
        status === 'completed'
          ? chalk.green
          : status === 'running'
            ? chalk.blue
            : status === 'failed'
              ? chalk.red
              : chalk.yellow;
      const runId = String(run.runId ?? '');
      const label = run.label ? ` ${chalk.dim(String(run.label))}` : '';
      const task = run.task ? String(run.task) : '';
      console.log(`  ${statusColor(status.padEnd(9))} ${chalk.cyan(runId)}${label}`);
      if (task) {
        prettyOutput.indent(task, 4);
      }
    }

    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function subagentsSpawnCommand(
  task: string,
  options: SubagentSpawnOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents spawn', getVersion());
  const client = await createCliBusClient();

  try {
    const response = await requestGateway<{ runId: string; childSessionId: string }>(
      client,
      TOPICS.gateway.subagents.spawn,
      {
        task,
        label: options.label,
        profile: options.profile,
        agentId: options.agentId,
        model: options.model,
        thinking: options.thinking,
        runTimeoutSeconds: options.timeout,
        cleanup: options.cleanup,
      }
    );

    if (options.json) {
      output.success(response);
      return;
    }

    prettyOutput.brandedHeader('Subagent Spawned');
    prettyOutput.blank();
    prettyOutput.keyValue('Run ID', response.runId);
    prettyOutput.keyValue('Session', response.childSessionId);
    if (options.profile) {
      prettyOutput.keyValue('Profile', options.profile);
    }
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function subagentsInfoCommand(
  runId: string,
  options: SubagentIdOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents info', getVersion());
  const client = await createCliBusClient();

  try {
    const response = await requestGateway<{ run: Record<string, unknown> | null }>(
      client,
      TOPICS.gateway.subagents.info,
      { runId }
    );

    if (options.json) {
      output.success(response);
      return;
    }

    const run = response.run;
    if (!run) {
      prettyOutput.warn('Subagent run not found');
      prettyOutput.blank();
      return;
    }

    prettyOutput.brandedHeader('Subagent Info');
    prettyOutput.blank();
    prettyOutput.keyValue('Run ID', String(run.runId ?? runId));
    prettyOutput.keyValue('Status', String(run.status ?? 'unknown'));
    if (run.label) {
      prettyOutput.keyValue('Label', String(run.label));
    }
    if (run.task) {
      prettyOutput.keyValue('Task', String(run.task));
    }
    if (run.childSessionId) {
      prettyOutput.keyValue('Session', String(run.childSessionId));
    }
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function subagentsStopCommand(
  runId: string,
  options: SubagentIdOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents stop', getVersion());
  const client = await createCliBusClient();

  try {
    const response = await requestGateway<{ stopped: boolean }>(
      client,
      TOPICS.gateway.subagents.stop,
      { runId }
    );

    if (options.json) {
      output.success(response);
      return;
    }

    if (response.stopped) {
      prettyOutput.success(`Stopped subagent run ${runId}`);
    } else {
      prettyOutput.warn(`Subagent run ${runId} was not stopped`);
    }
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function subagentsLogCommand(
  runId: string,
  options: SubagentIdOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents log', getVersion());
  const client = await createCliBusClient();

  try {
    const response = await requestGateway<{
      runId: string;
      messages: Array<Record<string, unknown>>;
    }>(client, TOPICS.gateway.subagents.log, { runId, limit: options.limit });

    if (options.json) {
      output.success(response);
      return;
    }

    prettyOutput.brandedHeader(`Subagent Log: ${runId}`);
    prettyOutput.blank();

    if (!response.messages || response.messages.length === 0) {
      prettyOutput.warn('No messages found');
      prettyOutput.blank();
      return;
    }

    for (const message of response.messages) {
      const role = String(message.role ?? 'unknown');
      const content = String(message.content ?? '');
      console.log(`  ${chalk.dim(role.padEnd(9))} ${content}`);
    }

    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function subagentsFilesListCommand(
  runId: string,
  options: SubagentFilesListOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents files list', getVersion());
  const client = await createCliBusClient();

  try {
    const response = await requestGateway<{
      runId: string;
      entries: Array<{ name: string; path: string; type: string; size?: number }>;
    }>(client, TOPICS.gateway.subagents.files.list, {
      runId,
      path: options.path,
      recursive: options.recursive,
      limit: options.limit,
    });

    if (options.json) {
      output.success(response);
      return;
    }

    prettyOutput.brandedHeader(`Subagent Files: ${runId}`);
    prettyOutput.blank();

    if (!response.entries || response.entries.length === 0) {
      prettyOutput.warn('No files found');
      prettyOutput.blank();
      return;
    }

    for (const entry of response.entries) {
      const size = entry.size !== undefined ? ` (${entry.size}b)` : '';
      console.log(`  ${entry.type.padEnd(4)} ${entry.path}${size}`);
    }

    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function subagentsFilesGetCommand(
  runId: string,
  options: SubagentFilesGetOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'subagents files get', getVersion());
  const client = await createCliBusClient();

  try {
    const filePath = options.path ?? '';
    if (!filePath.trim()) {
      throw new CLIError('path is required', 'MISSING_ARGUMENT', 2);
    }

    const response = await requestGateway<{
      runId: string;
      file: {
        path: string;
        size: number;
        updatedAtMs: number;
        truncated: boolean;
        encoding: string;
        content: string;
      };
    }>(client, TOPICS.gateway.subagents.files.get, {
      runId,
      path: filePath,
      maxBytes: options.maxBytes,
    });

    if (options.json) {
      output.success(response);
      return;
    }

    prettyOutput.brandedHeader(`Subagent File: ${runId}`);
    prettyOutput.keyValue('Path', response.file.path);
    prettyOutput.keyValue('Size', String(response.file.size));
    prettyOutput.keyValue('Truncated', response.file.truncated ? 'yes' : 'no');
    prettyOutput.blank();
    console.log(response.file.content);
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

async function requestGateway<T>(
  client: NachosBusClient,
  topic: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await client.request<Record<string, unknown>, GatewayResponse<T>>(
    topic,
    payload
  );
  const result = response.payload;
  if (!result.ok) {
    throw new CLIError(result.error?.message ?? 'Gateway request failed', 'GATEWAY_REQUEST_FAILED');
  }
  return result.data as T;
}
