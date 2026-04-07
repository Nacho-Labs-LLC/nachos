import { createWriteStream, existsSync, mkdirSync, rename, stat, unlink } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { createValidationError, createLogger } from '@nachos/types';

const auditLogger = createLogger('audit-file');
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
  private isClosing = false;
  private flushPromise: Promise<void> | null = null;
  private hmacSecret: string | undefined;
  private hmacWarningLogged = false;

  constructor(private readonly config: FileAuditProviderConfig) {
    this.hmacSecret = process.env['NACHOS_AUDIT_HMAC_SECRET'];
  }

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
      throw createValidationError('Audit file flushIntervalMs must be greater than 0', {
        component: 'gateway',
      });
    }
    this.flushTimer = setInterval(() => {
      if (this.isClosing) {
        return;
      }
      void this.flush().catch((error) => {
        auditLogger.error(
          {
            err: error,
            path: this.config.path,
            bufferSize: this.buffer.length,
            note: 'Audit events will retry on the next flush; persistent failures may drop events.',
          },
          'Failed to flush file audit buffer'
        );
      });
    }, flushIntervalMs);
    this.flushTimer.unref();
  }

  async log(event: AuditEvent): Promise<void> {
    const serialized = JSON.stringify(event);

    if (this.hmacSecret) {
      const hmac = createHmac('sha256', this.hmacSecret).update(serialized).digest('hex');
      this.buffer.push(JSON.stringify({ ...event, _hmac: hmac }));
    } else {
      if (!this.hmacWarningLogged) {
        auditLogger.warn('NACHOS_AUDIT_HMAC_SECRET not set — audit entries will not be signed');
        this.hmacWarningLogged = true;
      }
      this.buffer.push(serialized);
    }

    const batchSize = this.config.batchSize ?? DEFAULT_BATCH_SIZE;
    if (this.buffer.length >= batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    if (!this.stream || this.buffer.length === 0) {
      return;
    }
    this.flushPromise = (async () => {
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
    })();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
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
