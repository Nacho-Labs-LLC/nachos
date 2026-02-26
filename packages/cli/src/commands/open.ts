/**
 * nachos open command
 * Open a known service endpoint in the default browser
 */

import chalk from 'chalk';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';
import { CLIError } from '../core/errors.js';

interface OpenOptions {
  json?: boolean;
  port?: string;
}

type OpenTarget = 'admin' | 'webchat' | 'gateway' | 'nats' | 'docs';

const TARGETS: Record<OpenTarget, { defaultPort?: number; path?: string; description: string }> = {
  admin: { defaultPort: 8082, description: 'Admin UI' },
  webchat: { defaultPort: 8080, description: 'Webchat UI' },
  gateway: { defaultPort: 3000, description: 'Gateway API' },
  nats: { defaultPort: 8222, description: 'NATS monitoring' },
  docs: { path: 'https://docs.nacho.chat', description: 'Nachos docs' },
};

const ALIASES: Record<string, OpenTarget> = {
  ui: 'admin',
  admin: 'admin',
  webchat: 'webchat',
  gateway: 'gateway',
  nats: 'nats',
  docs: 'docs',
};

export async function openCommand(service: string, options: OpenOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'open', getVersion());

  try {
    const target = ALIASES[service.toLowerCase()];
    if (!target) {
      throw new CLIError(
        `Unknown service: ${service}`,
        'INVALID_SERVICE',
        2,
        'Supported services: admin, webchat, gateway, nats, docs'
      );
    }

    const url = buildUrl(target, options.port);
    const opened = await openBrowser(url);

    if (options.json) {
      output.success({ target, url, opened });
      return;
    }

    prettyOutput.brandedHeader('Open Service');
    prettyOutput.keyValue('Service', TARGETS[target].description);
    prettyOutput.keyValue('URL', chalk.cyan(url));
    prettyOutput.blank();

    if (opened) {
      prettyOutput.success('Opened in browser');
    } else {
      prettyOutput.warn('Unable to open browser automatically');
      prettyOutput.info(`Open manually: ${chalk.cyan(url)}`);
    }

    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  }
}

function buildUrl(target: OpenTarget, portOverride?: string): string {
  const config = TARGETS[target];
  if (config.path) {
    return config.path;
  }

  const parsedPort = portOverride ? Number.parseInt(portOverride, 10) : undefined;
  const port = Number.isFinite(parsedPort) ? parsedPort : config.defaultPort;
  return `http://localhost:${port}`;
}

async function openBrowser(url: string): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const platform = process.platform;
    if (platform === 'darwin') {
      await exec('open', [url]);
    } else if (platform === 'win32') {
      await exec('cmd', ['/c', 'start', '', url]);
    } else {
      await exec('xdg-open', [url]);
    }
    return true;
  } catch {
    return false;
  }
}
