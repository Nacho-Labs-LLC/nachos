/**
 * nachos restart command
 * Restart the Nachos stack (down + up with fresh compose)
 */

import ora from 'ora';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadAndValidateConfig } from '@nachos/config';
import { findConfigFileOrThrow, getProjectRoot } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { DockerClient } from '../core/docker-client.js';
import { generateAndWriteComposeFile } from '../core/compose-generator.js';
import { getVersion } from '../cli.js';
import { DockerNotAvailableError, DockerComposeNotAvailableError } from '../core/errors.js';

interface RestartOptions {
  json?: boolean;
}

export async function restartCommand(options: RestartOptions): Promise<void> {
  const docker = new DockerClient();
  const output = new OutputFormatter(options.json ?? false, 'restart', getVersion());

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

    // Find config and project root
    const configPath = findConfigFileOrThrow();
    const projectRoot = getProjectRoot();
    const composePath = join(projectRoot, 'docker-compose.generated.yml');

    if (!options.json) {
      prettyOutput.brandedHeader('Restarting Nachos');
      prettyOutput.info(`Config: ${configPath}`);
      prettyOutput.blank();
    }

    // Stop existing stack if running
    if (existsSync(composePath)) {
      const spinner = !options.json ? ora('Stopping services...').start() : null;
      await docker.down(composePath, { removeOrphans: true });
      spinner?.succeed('Services stopped');
    }

    // Load and validate configuration (may have changed)
    const spinner = !options.json ? ora('Loading configuration...').start() : null;
    const config = await loadAndValidateConfig({ configPath });
    spinner?.succeed('Configuration loaded and validated');

    // Generate fresh docker-compose file
    spinner?.start('Generating docker-compose file...');
    generateAndWriteComposeFile(config, projectRoot);
    spinner?.succeed(`Generated: ${composePath}`);

    // Start stack
    spinner?.start('Starting services...');
    await docker.up(composePath, { detach: true });
    spinner?.succeed('Services started');

    // Get service status
    const containers = await docker.ps(composePath);

    // Display results
    if (options.json) {
      output.success({
        compose_path: composePath,
        containers: containers.length,
        services: containers.map((c) => ({
          name: c.Service,
          state: c.State,
        })),
      });
    } else {
      prettyOutput.blank();
      prettyOutput.success('Nachos restarted!');
      prettyOutput.blank();
      prettyOutput.info('Run "nachos status" to see service health');
      prettyOutput.info('Run "nachos logs" to view service logs');
      prettyOutput.blank();
    }
  } catch (error) {
    output.error(error as Error);
  }
}
