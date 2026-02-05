/**
 * nachos up command
 * Start the Nachos stack
 */

import ora from 'ora';
import { loadAndValidateConfig } from '@nachos/config';
import { findConfigFileOrThrow, getProjectRoot } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { DockerClient } from '../core/docker-client.js';
import { generateAndWriteComposeFile } from '../core/compose-generator.js';
import { getVersion } from '../cli.js';
import { DockerNotAvailableError, DockerComposeNotAvailableError } from '../core/errors.js';

interface UpOptions {
  json?: boolean;
  build?: boolean;
  wait?: boolean;
}

export async function upCommand(options: UpOptions): Promise<void> {
  const docker = new DockerClient();
  const output = new OutputFormatter(
    options.json ?? false,
    'up',
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

    // Find and load config
    const configPath = findConfigFileOrThrow();
    const projectRoot = getProjectRoot();

    if (!options.json) {
      prettyOutput.brandedHeader('Starting Nachos');
      prettyOutput.info(`Config: ${configPath}`);
      prettyOutput.blank();
    }

    // Load and validate configuration
    const spinner = !options.json ? ora('Loading configuration...').start() : null;
    const config = await loadAndValidateConfig({ configPath });
    spinner?.succeed('Configuration loaded and validated');

    // Generate docker-compose file
    spinner?.start('Generating docker-compose file...');
    const composePath = generateAndWriteComposeFile(config, projectRoot);
    spinner?.succeed(`Generated: ${composePath}`);

    // Build images if requested
    if (options.build) {
      spinner?.start('Building images...');
      await docker.build(composePath);
      spinner?.succeed('Images built');
    }

    // Start stack
    spinner?.start('Starting services...');
    await docker.up(composePath, { detach: true, build: options.build });
    spinner?.succeed('Services started');

    // Wait for health checks if requested
    if (options.wait) {
      spinner?.start('Waiting for services to be healthy...');
      await waitForHealthy(docker, composePath, 60);
      spinner?.succeed('All services healthy');
    }

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
          health: c.Health,
        })),
        urls: buildServiceUrls(config),
      });
    } else {
      prettyOutput.blank();
      prettyOutput.success('Nachos is running!');
      prettyOutput.blank();

      // Show service URLs
      prettyOutput.header('Service URLs:');
      const urls = buildServiceUrls(config);
      if (urls.gateway) {
        prettyOutput.keyValue('Gateway', urls.gateway);
      }
      if (urls.webchat) {
        prettyOutput.keyValue('Webchat', urls.webchat);
      }
      if (urls.nats_monitoring) {
        prettyOutput.keyValue('NATS Monitoring', urls.nats_monitoring);
      }

      prettyOutput.blank();
      prettyOutput.info('Run "nachos status" to see service health');
      prettyOutput.info('Run "nachos logs" to view service logs');
      prettyOutput.blank();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

/**
 * Wait for services to become healthy
 */
async function waitForHealthy(
  docker: DockerClient,
  composePath: string,
  timeoutSeconds: number,
): Promise<void> {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (true) {
    const containers = await docker.ps(composePath);
    const runningContainers = containers.filter((c) => c.State === 'running');

    // Check if all running containers are healthy (or don't have health checks)
    const allHealthy = runningContainers.every(
      (c) => !c.Health || c.Health === 'healthy',
    );

    if (allHealthy && runningContainers.length > 0) {
      return;
    }

    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timeout waiting for services to become healthy after ${timeoutSeconds}s`,
      );
    }

    // Wait 2 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Build service URLs from configuration
 */
function buildServiceUrls(config: any): {
  gateway?: string;
  webchat?: string;
  nats_monitoring?: string;
} {
  return {
    gateway: 'http://localhost:3000',
    webchat: config.channels?.webchat?.enabled
      ? `http://localhost:${config.channels.webchat.port || 8080}`
      : undefined,
    nats_monitoring: 'http://localhost:8222',
  };
}
