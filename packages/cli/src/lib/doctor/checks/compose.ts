/**
 * Docker Compose file health checks
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot } from '../../../core/config-discovery.js';
import { DockerClient } from '../../../core/docker-client.js';
import type { DoctorCheck } from '../types.js';

/**
 * Check if generated compose file exists
 */
export async function checkComposeExists(): Promise<DoctorCheck> {
  try {
    const projectRoot = getProjectRoot();
    const composePath = join(projectRoot, 'docker-compose.generated.yml');

    if (!existsSync(composePath)) {
      return {
        id: 'compose-exists',
        name: 'Compose File',
        status: 'warn',
        message: 'No generated compose file found',
        suggestion: 'Run: nachos up',
      };
    }

    return {
      id: 'compose-exists',
      name: 'Compose File',
      status: 'pass',
      message: 'docker-compose.generated.yml exists',
    };
  } catch (error) {
    return {
      id: 'compose-exists',
      name: 'Compose File',
      status: 'warn',
      message: `Could not check: ${(error as Error).message}`,
    };
  }
}

/**
 * Check container health if stack is running
 */
export async function checkContainerHealth(): Promise<DoctorCheck> {
  try {
    const projectRoot = getProjectRoot();
    const composePath = join(projectRoot, 'docker-compose.generated.yml');

    if (!existsSync(composePath)) {
      return {
        id: 'container-health',
        name: 'Containers',
        status: 'warn',
        message: 'Stack not running',
        suggestion: 'Run: nachos up',
      };
    }

    const docker = new DockerClient();
    const containers = await docker.ps(composePath);

    if (containers.length === 0) {
      return {
        id: 'container-health',
        name: 'Containers',
        status: 'warn',
        message: 'Stack not running',
        suggestion: 'Run: nachos up',
      };
    }

    const running = containers.filter((c) => c.State === 'running');
    const unhealthy = running.filter(
      (c) => c.Health && c.Health !== 'healthy' && c.Health !== 'starting'
    );

    if (unhealthy.length > 0) {
      const names = unhealthy.map((c) => c.Service).join(', ');
      return {
        id: 'container-health',
        name: 'Containers',
        status: 'fail',
        message: `Unhealthy: ${names}`,
        suggestion: 'Run: nachos logs <service> to investigate',
      };
    }

    if (running.length < containers.length) {
      return {
        id: 'container-health',
        name: 'Containers',
        status: 'warn',
        message: `${running.length}/${containers.length} running`,
        suggestion: 'Some containers have stopped. Run: nachos status',
      };
    }

    return {
      id: 'container-health',
      name: 'Containers',
      status: 'pass',
      message: `All ${containers.length} containers healthy`,
    };
  } catch (error) {
    return {
      id: 'container-health',
      name: 'Containers',
      status: 'warn',
      message: `Could not check: ${(error as Error).message}`,
    };
  }
}
