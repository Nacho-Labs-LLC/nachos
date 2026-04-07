import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { spawn } from 'node:child_process';

export const logsRouter = new Hono();

const ALLOWED_SERVICES = [
  'gateway',
  'bus',
  'slack',
  'discord',
  'telegram',
  'whatsapp',
  'llm-proxy',
  'admin',
] as const;

type AllowedService = (typeof ALLOWED_SERVICES)[number];

function isAllowedService(s: string): s is AllowedService {
  return (ALLOWED_SERVICES as readonly string[]).includes(s);
}

/**
 * GET /api/logs/:service — SSE stream of `docker logs -f` for a nachos-* container.
 *
 * Streams stdout + stderr as SSE data events, one line per event.
 * Kills the child process on client disconnect.
 */
logsRouter.get('/:service', (c) => {
  const service = c.req.param('service');

  if (!isAllowedService(service)) {
    return c.json({ error: 'Service not in allowlist' }, 400);
  }

  return streamSSE(c, async (stream) => {
    const child = spawn('docker', ['logs', '-f', '--tail=100', `nachos-${service}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let closed = false;

    // Kill child when client disconnects
    stream.onAbort(() => {
      closed = true;
      child.kill();
    });

    function handleData(chunk: Buffer) {
      if (closed) return;
      const text = chunk.toString('utf8');
      const lines = text.split('\n');
      for (const line of lines) {
        if (line && !closed) {
          void stream.writeSSE({ data: line });
        }
      }
    }

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      if (!closed) {
        void stream.writeSSE({ data: `[error] ${err.message}` });
      }
    });

    // Wait until the child exits or stream is aborted
    await new Promise<void>((resolve) => {
      child.on('close', () => {
        closed = true;
        resolve();
      });
      stream.onAbort(() => {
        resolve();
      });
    });
  });
});
