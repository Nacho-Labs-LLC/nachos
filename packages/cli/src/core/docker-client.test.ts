/**
 * Tests for DockerClient — error enrichment & retry logic.
 * Tests DockerCommandError.buildSuggestion (unit) and DockerClient retry via
 * the public `up` method (integration via spawn mock).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerCommandError } from './errors.js';

// ── DockerCommandError.buildSuggestion ──────────────────────────────────────

describe('DockerCommandError.buildSuggestion', () => {
  it('DKRERR-01: suggests starting Docker when daemon not running', () => {
    const suggestion = DockerCommandError.buildSuggestion(
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
    );
    expect(suggestion).toMatch(/daemon is not running/i);
    expect(suggestion).toMatch(/start docker/i);
  });

  it('DKRERR-02: suggests usermod fix on socket permission denied', () => {
    const suggestion = DockerCommandError.buildSuggestion(
      'permission denied while trying to connect to the Docker daemon socket at /var/run/docker.sock'
    );
    expect(suggestion).toMatch(/docker group/i);
    expect(suggestion).toMatch(/usermod/i);
  });

  it('DKRERR-03: suggests docker login on pull access denied', () => {
    const suggestion = DockerCommandError.buildSuggestion(
      'pull access denied for private/image, unauthorized: authentication required'
    );
    expect(suggestion).toMatch(/docker login/i);
  });

  it('DKRERR-04: suggests docker system prune on no space left', () => {
    const suggestion = DockerCommandError.buildSuggestion('no space left on device');
    expect(suggestion).toMatch(/docker system prune/i);
  });

  it('DKRERR-05: suggests port fix on address already in use', () => {
    const suggestion = DockerCommandError.buildSuggestion(
      'Bind for 0.0.0.0:8080 failed: port is already allocated'
    );
    expect(suggestion).toMatch(/port/i);
    expect(suggestion).toMatch(/nachos\.toml/i);
  });

  it('DKRERR-06: suggests docker login on rate limit', () => {
    const suggestion = DockerCommandError.buildSuggestion(
      'toomanyrequests: You have reached your pull rate limit'
    );
    expect(suggestion).toMatch(/docker login/i);
    expect(suggestion).toMatch(/rate limit/i);
  });

  it('DKRERR-07: returns generic Docker error for unknown stderr', () => {
    const suggestion = DockerCommandError.buildSuggestion('some unknown docker error occurred');
    expect(suggestion).toMatch(/some unknown docker error/i);
  });

  it('DKRERR-08: returns undefined for empty stderr', () => {
    const suggestion = DockerCommandError.buildSuggestion('');
    expect(suggestion).toBeUndefined();
  });

  it('DKRERR-09: DockerCommandError embeds enriched suggestion', () => {
    const err = new DockerCommandError(
      'docker compose up',
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
    );
    expect(err.suggestion).toMatch(/daemon is not running/i);
    expect(err.message).toMatch(/docker compose up/);
  });
});

// ── DockerClient retry logic ─────────────────────────────────────────────────
//
// We mock `execOnce` (the private single-attempt method) directly on the
// DockerClient prototype, rather than mocking `spawn`. This avoids the
// microtask-timing issues that arise from fake child process emitters.

const { DockerClient } = await import('./docker-client.js');

describe('DockerClient retry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Helper: stub execOnce to resolve or reject for each call in order */
  function stubExecOnce(client: InstanceType<typeof DockerClient>, outcomes: Array<'ok' | Error>) {
    let callIndex = 0;
    // @ts-expect-error accessing private method for testing
    vi.spyOn(client, 'execOnce').mockImplementation(() => {
      const outcome = outcomes[callIndex++] ?? outcomes[outcomes.length - 1]!;
      return outcome === 'ok' ? Promise.resolve() : Promise.reject(outcome);
    });
  }

  it('DKRRETRY-01: succeeds without retry on first-attempt success', async () => {
    const client = new DockerClient({ maxAttempts: 3, initialDelayMs: 0 });
    stubExecOnce(client, ['ok']);

    // @ts-expect-error accessing private method for testing
    await expect(client.exec('docker', ['compose', 'up'])).resolves.toBeUndefined();
    // @ts-expect-error accessing private method for testing
    expect(client.execOnce).toHaveBeenCalledTimes(1);
  });

  it('DKRRETRY-02: retries on transient "connection reset by peer" error', async () => {
    const transientErr = new DockerCommandError('docker compose up', 'connection reset by peer');
    const client = new DockerClient({ maxAttempts: 3, initialDelayMs: 0 });
    stubExecOnce(client, [transientErr, transientErr, 'ok']);

    // @ts-expect-error accessing private method for testing
    await expect(client.exec('docker', ['compose', 'up'])).resolves.toBeUndefined();
    // @ts-expect-error accessing private method for testing
    expect(client.execOnce).toHaveBeenCalledTimes(3);
  });

  it('DKRRETRY-03: does NOT retry on non-transient error (port conflict)', async () => {
    const portErr = new DockerCommandError(
      'docker compose up',
      'Bind for 0.0.0.0:8080 failed: port is already allocated'
    );
    const client = new DockerClient({ maxAttempts: 3, initialDelayMs: 0 });
    stubExecOnce(client, [portErr]);

    // @ts-expect-error accessing private method for testing
    await expect(client.exec('docker', ['compose', 'up'])).rejects.toBeInstanceOf(
      DockerCommandError
    );
    // @ts-expect-error accessing private method for testing
    expect(client.execOnce).toHaveBeenCalledTimes(1);
  });

  it('DKRRETRY-04: throws after exhausting all attempts on persistent transient error', async () => {
    const ioErr = new DockerCommandError('docker compose up', 'i/o timeout');
    const client = new DockerClient({ maxAttempts: 2, initialDelayMs: 0 });
    stubExecOnce(client, [ioErr]);

    // @ts-expect-error accessing private method for testing
    await expect(client.exec('docker', ['compose', 'up'])).rejects.toBeInstanceOf(
      DockerCommandError
    );
    // @ts-expect-error accessing private method for testing
    expect(client.execOnce).toHaveBeenCalledTimes(2);
  });

  it('DKRRETRY-05: uses exponential backoff between retries', async () => {
    const capturedDelays: number[] = [];
    const transientErr = new DockerCommandError('docker compose up', 'connection reset by peer');
    const client = new DockerClient({ maxAttempts: 3, initialDelayMs: 100 });
    stubExecOnce(client, [transientErr, transientErr, 'ok']);

    // Spy on the module-level delay helper via spying on setTimeout
    const origSetTimeout = globalThis.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).setTimeout = (fn: () => void, ms: number) => {
      capturedDelays.push(ms);
      // Fire immediately so we don't need fake timers
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };

    // @ts-expect-error accessing private method for testing
    await client.exec('docker', ['compose', 'up']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).setTimeout = origSetTimeout;

    // Should have two delays: 100ms and 200ms (exponential doubling)
    expect(capturedDelays).toContain(100);
    expect(capturedDelays).toContain(200);
  });
});
