/**
 * nachos sandbox commands
 */

import { TOPICS, type NachosBusClient } from '@nachos/bus';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { CLIError } from '../core/errors.js';
import { createCliBusClient } from '../core/nats-client.js';
import { getVersion } from '../cli.js';

interface SandboxOptions {
  json?: boolean;
}

type GatewayResponse<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

type SandboxExplainData = {
  config: Record<string, unknown> | null;
  decisions?: {
    main: { enabled: boolean; config?: unknown };
    subagent: { enabled: boolean; config?: unknown };
  } | null;
};

type SandboxListData = {
  config: Record<string, unknown> | null;
  decisions?: {
    main: { enabled: boolean; config?: unknown };
    subagent: { enabled: boolean; config?: unknown };
  } | null;
  subagentRuns: Array<Record<string, unknown>>;
};

export async function sandboxExplainCommand(options: SandboxOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'sandbox explain', getVersion());
  const client = await createCliBusClient();

  try {
    const data = await requestGateway<SandboxExplainData>(
      client,
      TOPICS.gateway.sandbox.explain,
      {}
    );

    if (options.json) {
      output.success(data);
      return;
    }

    prettyOutput.brandedHeader('Sandbox Configuration');
    prettyOutput.blank();

    if (!data.config) {
      prettyOutput.warn('No sandbox configuration found');
      prettyOutput.blank();
      return;
    }

    prettyOutput.keyValue('mode', String(data.config.mode ?? 'off'));
    prettyOutput.keyValue('scope', String(data.config.scope ?? 'session'));
    prettyOutput.keyValue('workspace_access', String(data.config.workspace_access ?? 'rw'));
    if (data.config.network) {
      prettyOutput.keyValue('network', String(data.config.network));
    }
    if (data.config.setup_command) {
      prettyOutput.keyValue('setup_command', String(data.config.setup_command));
    }
    if (Array.isArray(data.config.extra_binds)) {
      prettyOutput.keyValue('extra_binds', String(data.config.extra_binds.length));
    }
    if (data.config.env && typeof data.config.env === 'object') {
      prettyOutput.keyValue('env_keys', String(Object.keys(data.config.env).length));
    }
    if (data.decisions) {
      prettyOutput.blank();
      prettyOutput.header('Decisions:');
      prettyOutput.keyValue('main', data.decisions.main.enabled ? 'enabled' : 'disabled');
      prettyOutput.keyValue('subagent', data.decisions.subagent.enabled ? 'enabled' : 'disabled');
    }
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function sandboxListCommand(options: SandboxOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'sandbox list', getVersion());
  const client = await createCliBusClient();

  try {
    const data = await requestGateway<SandboxListData>(client, TOPICS.gateway.sandbox.list, {});

    if (options.json) {
      output.success(data);
      return;
    }

    prettyOutput.brandedHeader('Sandbox Status');
    prettyOutput.blank();
    prettyOutput.keyValue('mode', String(data.config?.mode ?? 'off'));
    prettyOutput.keyValue('scope', String(data.config?.scope ?? 'session'));
    prettyOutput.keyValue('workspace_access', String(data.config?.workspace_access ?? 'rw'));
    if (data.config?.network) {
      prettyOutput.keyValue('network', String(data.config.network));
    }
    if (data.decisions) {
      prettyOutput.keyValue('main_decision', data.decisions.main.enabled ? 'enabled' : 'disabled');
      prettyOutput.keyValue(
        'subagent_decision',
        data.decisions.subagent.enabled ? 'enabled' : 'disabled'
      );
    }
    prettyOutput.blank();

    if (!data.subagentRuns || data.subagentRuns.length === 0) {
      prettyOutput.warn('No subagent runs available');
      prettyOutput.blank();
      return;
    }

    prettyOutput.header('Subagent Runs:');
    for (const run of data.subagentRuns) {
      const runId = String(run.runId ?? '');
      const status = String(run.status ?? 'unknown');
      console.log(`  ${runId} ${status}`);
    }
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  } finally {
    await client.disconnect();
  }
}

export async function sandboxRecreateCommand(options: SandboxOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'sandbox recreate', getVersion());
  const client = await createCliBusClient();

  try {
    const data = await requestGateway<{ message?: string }>(
      client,
      TOPICS.gateway.sandbox.recreate,
      {}
    );

    if (options.json) {
      output.success(data);
      return;
    }

    prettyOutput.success(data.message ?? 'Sandbox recreated');
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
