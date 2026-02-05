/**
 * nachos status command
 * Show stack status
 */

import chalk from 'chalk';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getProjectRoot } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { DockerClient } from '../core/docker-client.js';
import { getVersion } from '../cli.js';
import type { StackStatus } from '../core/types.js';
import { DockerNotAvailableError, DockerComposeNotAvailableError, CLIError } from '../core/errors.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const docker = new DockerClient();
  const output = new OutputFormatter(
    options.json ?? false,
    'status',
    getVersion(),
  );

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
        'Run "nachos up" to start the stack.',
      );
    }

    // Get container status
    const containers = await docker.ps(composePath);

    // Build status
    const running = containers.some((c) => c.State === 'running');
    const status: StackStatus = {
      running,
      containers,
      urls: {
        gateway: 'http://localhost:3000',
        webchat: 'http://localhost:8080',
        nats_monitoring: 'http://localhost:8222',
      },
    };

    // Display results
    if (options.json) {
      output.success(status);
    } else {
      prettyOutput.brandedHeader('Nachos Status');
      prettyOutput.blank();

      if (!running) {
        prettyOutput.warn('Stack is not running');
        prettyOutput.blank();
        prettyOutput.info('Run "nachos up" to start the stack');
        prettyOutput.blank();
        return;
      }

      // Show container status
      prettyOutput.header('Services:');
      for (const container of containers) {
        const statusIcon = getStatusIcon(container.State, container.Health);
        const healthText = container.Health ? ` (${container.Health})` : '';
        console.log(
          `  ${statusIcon} ${chalk.cyan(container.Service.padEnd(15))} ${container.State}${healthText}`,
        );
      }

      // Show URLs
      prettyOutput.blank();
      prettyOutput.header('Service URLs:');
      prettyOutput.keyValue('Gateway', status.urls.gateway || 'N/A');
      prettyOutput.keyValue('Webchat', status.urls.webchat || 'N/A');
      prettyOutput.keyValue('NATS Monitoring', status.urls.nats_monitoring || 'N/A');
      prettyOutput.blank();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

/**
 * Get status icon for container state
 */
function getStatusIcon(state: string, health?: string): string {
  if (state !== 'running') {
    return chalk.red('●');
  }

  if (!health || health === 'healthy') {
    return chalk.green('●');
  }

  if (health === 'starting') {
    return chalk.yellow('●');
  }

  return chalk.red('●');
}
