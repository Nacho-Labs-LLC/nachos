/**
 * nachos ui command
 * Open the Admin UI in the browser
 */

import chalk from 'chalk';
import { prettyOutput } from '../core/output.js';

interface UiOptions {
  port?: number;
}

export async function uiCommand(options: UiOptions): Promise<void> {
  const port = options.port ?? getAdminPort();
  const url = `http://localhost:${port}`;

  // Check if admin UI is reachable
  const reachable = await checkHealth(url);

  prettyOutput.brandedHeader('Nachos Admin UI');
  prettyOutput.blank();

  if (!reachable) {
    prettyOutput.warn('Admin UI is not running.');
    prettyOutput.blank();
    prettyOutput.info('Start the stack first:  nachos up');
    prettyOutput.info(`Admin URL will be:       ${chalk.cyan(url)}`);
    prettyOutput.blank();
    return;
  }

  prettyOutput.success(`Admin UI is running at ${chalk.cyan(url)}`);
  prettyOutput.blank();

  const opened = await openBrowser(url);
  if (!opened) {
    prettyOutput.info(`Open manually: ${chalk.cyan(url)}`);
  }
  prettyOutput.blank();
}

function getAdminPort(): number {
  try {
    // Prefer env var set by CLI from nachos.toml
    const fromEnv = process.env['NACHOS_ADMIN_PORT'];
    if (fromEnv) return Number(fromEnv);
  } catch {
    // ignore
  }
  return 8082;
}

async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
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
