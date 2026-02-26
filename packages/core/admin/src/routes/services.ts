import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import type { ServiceStatus } from '../types.js';

export const servicesRouter = new Hono();

/**
 * Wrap execFile in a Promise. Rejects with stderr on non-zero exit.
 */
function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Validate a container service name: only alphanumeric and hyphens.
 */
function isValidName(name: string): boolean {
  return /^[a-z0-9-]+$/i.test(name);
}

/**
 * Parse `docker ps -a --format '{{json .}}'` output into ServiceStatus entries.
 * Each line is a JSON object from Docker's Go template.
 */
function parseDockerPs(raw: string): ServiceStatus[] {
  const results: ServiceStatus[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row: Record<string, string>;
    try {
      row = JSON.parse(trimmed) as Record<string, string>;
    } catch {
      continue;
    }

    const containerName: string = row['Names'] ?? row['Name'] ?? '';
    // Only include nachos-* containers
    if (!containerName.startsWith('nachos-')) continue;

    const name = containerName.replace(/^nachos-/, '');
    const state = (row['State'] ?? '').toLowerCase();

    // Extract health from Status field — e.g. "Up 2 hours (healthy)"
    let health = 'none';
    const statusField = row['Status'] ?? '';
    const healthMatch = /\((healthy|unhealthy|starting)\)/i.exec(statusField);
    if (healthMatch) {
      health = healthMatch[1]!.toLowerCase();
    }

    results.push({
      name,
      container: containerName,
      state,
      health,
      uptime: statusField,
      image: row['Image'] ?? '',
    });
  }

  return results;
}

/**
 * GET /api/services — list all nachos-* containers
 */
servicesRouter.get('/', async (c) => {
  try {
    const output = await exec('docker', ['ps', '-a', '--format', '{{json .}}']);
    const services = parseDockerPs(output);
    return c.json({ services });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return c.json({ error: 'Docker CLI not available in this container. Mount the Docker socket and install the CLI to enable service management.', services: [] }, 503);
    }
    return c.json({ error: 'Failed to list containers', details: msg }, 500);
  }
});

/**
 * POST /api/services/:name/restart
 */
servicesRouter.post('/:name/restart', async (c) => {
  const name = c.req.param('name');
  if (!isValidName(name)) {
    return c.json({ error: 'Invalid service name' }, 400);
  }
  try {
    await exec('docker', ['restart', `nachos-${name}`]);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to restart container', details: String(err) }, 500);
  }
});

/**
 * POST /api/services/:name/stop
 */
servicesRouter.post('/:name/stop', async (c) => {
  const name = c.req.param('name');
  if (!isValidName(name)) {
    return c.json({ error: 'Invalid service name' }, 400);
  }
  try {
    await exec('docker', ['stop', `nachos-${name}`]);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to stop container', details: String(err) }, 500);
  }
});

/**
 * POST /api/services/:name/start
 */
servicesRouter.post('/:name/start', async (c) => {
  const name = c.req.param('name');
  if (!isValidName(name)) {
    return c.json({ error: 'Invalid service name' }, 400);
  }
  try {
    await exec('docker', ['start', `nachos-${name}`]);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to start container', details: String(err) }, 500);
  }
});
