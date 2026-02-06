/**
 * nachos logs command
 * View service logs
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getProjectRoot } from '../core/config-discovery.js';
import { OutputFormatter } from '../core/output.js';
import { DockerClient } from '../core/docker-client.js';
import { getVersion } from '../cli.js';
import {
  DockerNotAvailableError,
  DockerComposeNotAvailableError,
  CLIError,
} from '../core/errors.js';

interface LogsOptions {
  json?: boolean;
  follow?: boolean;
  tail?: string;
  timestamps?: boolean;
}

export async function logsCommand(
  service: string | undefined,
  options: LogsOptions
): Promise<void> {
  const docker = new DockerClient();
  const output = new OutputFormatter(options.json ?? false, 'logs', getVersion());

  try {
    // Check Docker availability
    const dockerAvailable = await docker.isDockerAvailable();
    if (!dockerAvailable) {
      throw new DockerNotAvailableError();
    }

    const composeAvailable = await docker.isComposeAvailable();
    if (!composeAvailable) {
      throw new DockerComposeNotAvailableError();
    }

    // Find compose file
    const projectRoot = getProjectRoot();
    const composePath = join(projectRoot, 'docker-compose.generated.yml');

    if (!existsSync(composePath)) {
      throw new CLIError(
        'No generated compose file found',
        'COMPOSE_FILE_NOT_FOUND',
        1,
        'Run "nachos up" to start the stack.'
      );
    }

    // Stream logs (this will block until user interrupts)
    await docker.logs(composePath, service, {
      follow: options.follow,
      tail: options.tail ? parseInt(options.tail, 10) : undefined,
      timestamps: options.timestamps,
    });
  } catch (error) {
    output.error(error as Error);
  }
}
