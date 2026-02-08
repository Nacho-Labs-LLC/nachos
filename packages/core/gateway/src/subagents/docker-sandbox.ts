/**
 * Docker-based subagent sandbox runner.
 */

import Docker from 'dockerode';
import type { SubagentResult, SubagentTask, DockerSandboxConfig } from './types.js';

export class DockerSubagentSandbox {
  private docker: Docker;

  constructor(
    private config: DockerSandboxConfig,
    docker?: Docker
  ) {
    this.docker = docker ?? new Docker();
  }

  async run(task: SubagentTask): Promise<SubagentResult> {
    const start = Date.now();
    const payload = JSON.stringify(task.request);

    const env = [
      `SUBAGENT_TASK=${payload}`,
      `NATS_URL=${process.env.NATS_URL ?? 'nats://localhost:4222'}`,
    ];

    if (this.config.env) {
      for (const [key, value] of Object.entries(this.config.env)) {
        env.push(`${key}=${value}`);
      }
    }

    const binds: string[] = [];
    if (this.config.workspaceDir) {
      binds.push(`${this.config.workspaceDir}:/workspace:rw`);
    }
    if (this.config.configDir) {
      binds.push(`${this.config.configDir}:/config:ro`);
    }
    if (this.config.stateDir) {
      binds.push(`${this.config.stateDir}:/state:rw`);
    }

    const networkMode =
      this.config.network === 'none'
        ? 'none'
        : this.config.network === 'full'
          ? 'bridge'
          : undefined;

    const container = await this.docker.createContainer({
      Image: this.config.image,
      Env: env,
      HostConfig: {
        AutoRemove: true,
        Binds: binds,
        NetworkMode: networkMode,
      },
    });

    const output: Buffer[] = [];
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    stream.on('data', (chunk: Buffer) => output.push(chunk));

    await container.start();

    const timeoutMs = task.timeoutMs ?? this.config.timeoutMs;
    const waitPromise = container.wait();

    if (timeoutMs) {
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Subagent sandbox timeout')), timeoutMs)
      );
      await Promise.race([waitPromise, timeout]).catch(async (error) => {
        try {
          await container.kill();
        } catch {
          // Ignore kill errors.
        }
        throw error;
      });
    } else {
      await waitPromise;
    }

    const combined = Buffer.concat(output).toString('utf-8').trim();
    const parsed = parseJsonFromOutput(combined);

    if (!parsed) {
      return {
        success: false,
        error: {
          code: 'SUBAGENT_SANDBOX_ERROR',
          message: 'Sandbox returned non-JSON output',
          details: combined,
        },
        durationMs: Date.now() - start,
        sandboxed: true,
      };
    }

    return {
      success: true,
      response: parsed as SubagentResult['response'],
      durationMs: Date.now() - start,
      sandboxed: true,
    };
  }
}

function parseJsonFromOutput(output: string): unknown | null {
  if (!output) return null;
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i] ?? '');
    } catch {
      // continue
    }
  }
  return null;
}
