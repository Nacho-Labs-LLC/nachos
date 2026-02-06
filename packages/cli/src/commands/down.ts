/**
 * nachos down command
 * Stop the Nachos stack
 */

import ora from 'ora';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getProjectRoot } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { DockerClient } from '../core/docker-client.js';
import { getVersion } from '../cli.js';
import {
  DockerNotAvailableError,
  DockerComposeNotAvailableError,
  CLIError,
} from '../core/errors.js';

interface DownOptions {
  json?: boolean;
  volumes?: boolean;
}

export async function downCommand(options: DownOptions): Promise<void> {
  const docker = new DockerClient();
  const output = new OutputFormatter(options.json ?? false, 'down', getVersion());

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

    // Find project root and compose file
    const projectRoot = getProjectRoot();
    const composePath = join(projectRoot, 'docker-compose.generated.yml');

    if (!existsSync(composePath)) {
      throw new CLIError(
        'No generated compose file found',
        'COMPOSE_FILE_NOT_FOUND',
        1,
        'The stack may not be running, or was started manually. Run "nachos up" to start the stack.'
      );
    }

    if (!options.json) {
      prettyOutput.brandedHeader('Stopping Nachos');
      prettyOutput.blank();
    }

    // Stop stack
    const spinner = !options.json ? ora('Stopping services...').start() : null;
    await docker.down(composePath, {
      volumes: options.volumes,
      removeOrphans: true,
    });
    spinner?.succeed('Services stopped');

    // Display results
    if (options.json) {
      output.success({
        stopped: true,
        volumes_removed: options.volumes ?? false,
      });
    } else {
      prettyOutput.blank();
      prettyOutput.success('Nachos stopped');
      if (options.volumes) {
        prettyOutput.info('Volumes removed');
      }
      prettyOutput.blank();
    }
  } catch (error) {
    output.error(error as Error);
  }
}
