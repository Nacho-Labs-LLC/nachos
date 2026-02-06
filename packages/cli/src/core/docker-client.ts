/**
 * Docker client wrapper
 * Provides high-level interface to Docker and Docker Compose commands
 */

import { spawn, spawnSync } from 'node:child_process';
import type { ContainerStatus } from './types.js';
import {
  DockerNotAvailableError,
  DockerComposeNotAvailableError,
  DockerCommandError,
} from './errors.js';

export class DockerClient {
  /**
   * Check if Docker is available
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      const result = spawnSync('docker', ['--version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker Compose V2 is available
   */
  async isComposeAvailable(): Promise<boolean> {
    try {
      const result = spawnSync('docker', ['compose', 'version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker version
   */
  async getDockerVersion(): Promise<string> {
    const result = spawnSync('docker', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      throw new DockerNotAvailableError();
    }

    // Extract version from "Docker version 24.0.7, build afdd53b"
    const match = result.stdout.match(/Docker version ([\d.]+)/);
    return match && match[1] ? match[1] : result.stdout.trim();
  }

  /**
   * Get Docker Compose version
   */
  async getComposeVersion(): Promise<string> {
    const result = spawnSync('docker', ['compose', 'version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      throw new DockerComposeNotAvailableError();
    }

    // Extract version from "Docker Compose version v2.23.0"
    const match = result.stdout.match(/version (v?[\d.]+)/);
    return match && match[1] ? match[1] : result.stdout.trim();
  }

  /**
   * Start services using docker compose up
   */
  async up(
    composeFile: string,
    options: { detach?: boolean; build?: boolean } = {}
  ): Promise<void> {
    const args = ['compose', '-f', composeFile, 'up'];

    if (options.detach) {
      args.push('-d');
    }

    if (options.build) {
      args.push('--build');
    }

    await this.exec('docker', args);
  }

  /**
   * Stop and remove services using docker compose down
   */
  async down(
    composeFile: string,
    options: { volumes?: boolean; removeOrphans?: boolean } = {}
  ): Promise<void> {
    const args = ['compose', '-f', composeFile, 'down'];

    if (options.volumes) {
      args.push('--volumes');
    }

    if (options.removeOrphans) {
      args.push('--remove-orphans');
    }

    await this.exec('docker', args);
  }

  /**
   * Restart services (down + up)
   */
  async restart(composeFile: string): Promise<void> {
    await this.down(composeFile);
    await this.up(composeFile, { detach: true });
  }

  /**
   * View service logs
   */
  async logs(
    composeFile: string,
    service?: string,
    options: { follow?: boolean; tail?: number; timestamps?: boolean } = {}
  ): Promise<void> {
    const args = ['compose', '-f', composeFile, 'logs'];

    if (options.follow) {
      args.push('-f');
    }

    if (options.tail !== undefined) {
      args.push('--tail', String(options.tail));
    }

    if (options.timestamps) {
      args.push('-t');
    }

    if (service) {
      args.push(service);
    }

    await this.exec('docker', args);
  }

  /**
   * Get container status for services
   */
  async ps(composeFile: string): Promise<ContainerStatus[]> {
    const result = spawnSync(
      'docker',
      ['compose', '-f', composeFile, 'ps', '--format', 'json', '--all'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    if (result.status !== 0) {
      throw new DockerCommandError(`docker compose ps`, result.stderr);
    }

    if (!result.stdout.trim()) {
      return [];
    }

    // Docker compose ps --format json outputs NDJSON (newline-delimited JSON)
    // Each line is a separate JSON object
    const lines = result.stdout.trim().split('\n');
    const containers: ContainerStatus[] = [];

    for (const line of lines) {
      if (line.trim()) {
        try {
          containers.push(JSON.parse(line));
        } catch (error) {
          // Skip invalid JSON lines
        }
      }
    }

    return containers;
  }

  /**
   * Execute a Docker command with inherited stdio (interactive)
   */
  private async exec(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: 'inherit',
        shell: false,
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new DockerCommandError(`${command} ${args.join(' ')}`, `Exit code: ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(new DockerCommandError(`${command} ${args.join(' ')}`, error.message));
      });
    });
  }

  /**
   * Pull images for services
   */
  async pull(composeFile: string): Promise<void> {
    await this.exec('docker', ['compose', '-f', composeFile, 'pull']);
  }

  /**
   * Build service images
   */
  async build(composeFile: string): Promise<void> {
    await this.exec('docker', ['compose', '-f', composeFile, 'build']);
  }
}
