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

/**
 * Patterns that indicate a transient Docker daemon failure worth retrying.
 * These are errors that may resolve on their own (daemon busy, socket hiccup).
 */
const TRANSIENT_ERROR_PATTERNS = [
  /connection reset by peer/i,
  /connection refused/i,
  /EOF/,
  /context deadline exceeded/i,
  /i\/o timeout/i,
  /dial unix.*docker\.sock.*connect: no such file/i, // daemon momentarily gone
  /socket: too many open files/i,
];

/**
 * Default retry configuration for transient Docker failures.
 */
export interface DockerRetryOptions {
  /** Maximum number of attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Initial delay in ms between retries. Doubles each attempt. Default: 500. */
  initialDelayMs?: number;
}

function isTransient(stderr: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(stderr));
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DockerClient {
  private maxAttempts: number;
  private initialDelayMs: number;

  constructor(retry: DockerRetryOptions = {}) {
    this.maxAttempts = retry.maxAttempts ?? 3;
    this.initialDelayMs = retry.initialDelayMs ?? 500;
  }
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
    options: { detach?: boolean; build?: boolean; services?: string[] } = {}
  ): Promise<void> {
    const args = ['compose', '-f', composeFile, 'up'];

    if (options.detach) {
      args.push('-d');
    }

    if (options.build) {
      args.push('--build');
    }

    // Service names must come last in docker compose up
    if (options.services?.length) {
      args.push(...options.services);
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
        } catch {
          // Skip invalid JSON lines
        }
      }
    }

    return containers;
  }

  /**
   * Execute a Docker command with inherited stdio (interactive).
   * Retries up to `maxAttempts` times on transient daemon errors.
   */
  private async exec(command: string, args: string[]): Promise<void> {
    let lastError: DockerCommandError | undefined;
    let delayMs = this.initialDelayMs;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await this.execOnce(command, args);
        return; // success
      } catch (err) {
        if (!(err instanceof DockerCommandError)) throw err;
        lastError = err;

        // Only retry on known transient failures.
        // The DockerCommandError message contains the stderr text or the spawn
        // error message, both of which are good signals for transient detection.
        const errorText = err.message + ' ' + (err.suggestion ?? '');
        if (!isTransient(errorText) || attempt === this.maxAttempts) {
          throw err;
        }

        await delay(delayMs);
        delayMs *= 2; // exponential backoff
      }
    }

    // Should not be reachable, but keeps TypeScript happy
    throw lastError;
  }

  /**
   * Single attempt to run a Docker command.
   *
   * Uses `pipe` for stderr so we can capture error text for:
   *   1. Enriched suggestions (DockerCommandError.buildSuggestion)
   *   2. Transient-failure detection for retry
   *
   * Captured stderr is also forwarded to process.stderr so the user still
   * sees Docker's raw output (matching previous `stdio: 'inherit'` behaviour
   * for the error stream).
   *
   * stdout remains inherited so streaming output (e.g. `docker compose up`
   * build logs) goes directly to the terminal.
   */
  private execOnce(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['inherit', 'inherit', 'pipe'],
        shell: false,
      });

      let stderrBuf = '';

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderrBuf += text;
        // Mirror to terminal so the user sees Docker errors in real time
        process.stderr.write(text);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new DockerCommandError(
              `${command} ${args.join(' ')}`,
              stderrBuf.trim() || `Exit code: ${code}`
            )
          );
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
