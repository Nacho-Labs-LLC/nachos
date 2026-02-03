import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rename,
  stat,
  unlink,
} from 'node:fs';
import { dirname } from 'node:path';
import type { WriteStream } from 'node:fs';
import type { AuditEvent } from '../types.js';
import type { AuditProvider } from '../provider.js';

const DEFAULT_ROTATE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_BATCH_SIZE = 50;

export interface FileAuditProviderConfig {
  path: string;
  rotateSize?: number;
  maxFiles?: number;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class FileAuditProvider implements AuditProvider {
  readonly name = 'file';
  private stream: WriteStream | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: FileAuditProviderConfig) {}

  async init(): Promise<void> {
    const directory = dirname(this.config.path);
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
    this.stream = createWriteStream(this.config.path, { flags: 'a' });
    const flushIntervalMs = this.config.flushIntervalMs;
    if (flushIntervalMs === undefined) {
      return;
    }
    if (flushIntervalMs <= 0) {
      throw new Error('Audit file flushIntervalMs must be greater than 0');
    }
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, flushIntervalMs);
  }

  async log(event: AuditEvent): Promise<void> {
    this.buffer.push(JSON.stringify(event));
    const batchSize = this.config.batchSize ?? DEFAULT_BATCH_SIZE;
    if (this.buffer.length >= batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (!this.stream || this.buffer.length === 0) {
      return;
    }
    const chunk = `${this.buffer.splice(0).join('\n')}\n`;
    await new Promise<void>((resolve, reject) => {
      this.stream!.write(chunk, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    await this.rotateIfNeeded();
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await new Promise<void>((resolve) => {
      this.stream?.end(() => resolve());
    });
    this.stream = null;
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!this.stream) {
      return;
    }
    const rotateSize = this.config.rotateSize ?? DEFAULT_ROTATE_SIZE;
    const maxFiles = this.config.maxFiles ?? DEFAULT_MAX_FILES;
    let size = 0;
    try {
      size = await new Promise<number>((resolve, reject) => {
        stat(this.config.path, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result.size);
          }
        });
      });
    } catch {
      return;
    }
    if (size < rotateSize) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.stream?.end(() => resolve());
    });
    this.stream = null;

    if (existsSync(`${this.config.path}.${maxFiles}`)) {
      try {
        await new Promise<void>((resolve, reject) => {
          unlink(`${this.config.path}.${maxFiles}`, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } catch {
        // ignore rotation errors to avoid blocking audits
      }
    }

    for (let fileIndex = maxFiles - 1; fileIndex >= 1; fileIndex -= 1) {
      const source = `${this.config.path}.${fileIndex}`;
      const destination = `${this.config.path}.${fileIndex + 1}`;
      if (existsSync(source)) {
        try {
          await new Promise<void>((resolve, reject) => {
            rename(source, destination, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        } catch {
          // ignore rotation errors to avoid blocking audits
        }
      }
    }

    try {
      await new Promise<void>((resolve, reject) => {
        rename(this.config.path, `${this.config.path}.1`, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch {
      // ignore rotation errors to avoid blocking audits
    }

    this.stream = createWriteStream(this.config.path, { flags: 'a' });
  }
}
