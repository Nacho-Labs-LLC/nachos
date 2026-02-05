/**
 * Docker-related health checks
 */

import { DockerClient } from '../../../core/docker-client.js';
import type { DoctorCheck } from '../types.js';

const docker = new DockerClient();

/**
 * Check if Docker is installed and running
 */
export async function checkDocker(): Promise<DoctorCheck> {
  const isAvailable = await docker.isDockerAvailable();

  if (!isAvailable) {
    return {
      id: 'docker',
      name: 'Docker',
      status: 'fail',
      message: 'Docker is not available',
      suggestion: 'Install Docker Desktop or Docker Engine: https://docs.docker.com/get-docker/',
    };
  }

  try {
    const version = await docker.getDockerVersion();
    return {
      id: 'docker',
      name: 'Docker',
      status: 'pass',
      message: `v${version} (OK)`,
    };
  } catch (error) {
    return {
      id: 'docker',
      name: 'Docker',
      status: 'fail',
      message: 'Failed to get Docker version',
      suggestion: 'Ensure Docker daemon is running',
    };
  }
}

/**
 * Check if Docker Compose V2 is available
 */
export async function checkDockerCompose(): Promise<DoctorCheck> {
  const isAvailable = await docker.isComposeAvailable();

  if (!isAvailable) {
    return {
      id: 'docker-compose',
      name: 'Docker Compose',
      status: 'fail',
      message: 'Docker Compose V2 is not available',
      suggestion: 'Update to Docker Compose V2. Run: docker compose version',
    };
  }

  try {
    const version = await docker.getComposeVersion();
    return {
      id: 'docker-compose',
      name: 'Docker Compose',
      status: 'pass',
      message: `${version} (OK)`,
    };
  } catch (error) {
    return {
      id: 'docker-compose',
      name: 'Docker Compose',
      status: 'fail',
      message: 'Failed to get Docker Compose version',
      suggestion: 'Ensure Docker Compose is properly installed',
    };
  }
}
