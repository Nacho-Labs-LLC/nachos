import { Hono } from 'hono';
import { readFile, writeFile, copyFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseToml } from '@nachos/config';
import TOML from '@iarna/toml';

const CONFIG_PATH = process.env['NACHOS_CONFIG_PATH'] ?? '/app/nachos.toml';

export const configRouter = new Hono();

configRouter.get('/', async (c) => {
  if (!existsSync(CONFIG_PATH)) {
    return c.json({ error: 'nachos.toml not found', path: CONFIG_PATH }, 404);
  }

  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = parseToml(content);
    return c.json({ content, parsed });
  } catch (err) {
    return c.json({ error: 'Failed to read config', details: String(err) }, 500);
  }
});

configRouter.put('/', async (c) => {
  const body = await c.req.json<{ content: string }>();

  if (!body.content) {
    return c.json({ error: 'content is required' }, 400);
  }

  try {
    parseToml(body.content);
  } catch (err) {
    return c.json({ error: 'Invalid TOML syntax', details: String(err) }, 400);
  }

  const backupPath = CONFIG_PATH + '.bak';
  const tmpPath = CONFIG_PATH + '.tmp';

  try {
    // Backup current config before writing
    if (existsSync(CONFIG_PATH)) {
      await copyFile(CONFIG_PATH, backupPath);
    }
    // Atomic write via temp file + rename
    await writeFile(tmpPath, body.content, 'utf-8');
    await rename(tmpPath, CONFIG_PATH);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to write config', details: String(err) }, 500);
  }
});

configRouter.patch('/', async (c) => {
  const body = await c.req.json<{ path: string; value: unknown }>();

  if (!body.path || body.value === undefined) {
    return c.json({ error: 'path and value are required' }, 400);
  }

  if (!existsSync(CONFIG_PATH)) {
    return c.json({ error: 'nachos.toml not found' }, 404);
  }

  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    // Use TOML.parse directly here — we need a JsonMap for stringify round-trip
    const parsed = TOML.parse(content);

    setNestedKey(parsed as Record<string, unknown>, body.path.split('.'), body.value);

    const newContent = TOML.stringify(parsed);
    const backupPath = CONFIG_PATH + '.bak';
    await copyFile(CONFIG_PATH, backupPath);
    await writeFile(CONFIG_PATH, newContent, 'utf-8');

    return c.json({ ok: true, parsed });
  } catch (err) {
    return c.json({ error: 'Failed to patch config', details: String(err) }, 500);
  }
});

function setNestedKey(obj: Record<string, unknown>, keys: string[], value: unknown): void {
  const [first, ...rest] = keys;
  if (!first) return;

  if (rest.length === 0) {
    obj[first] = value;
  } else {
    if (typeof obj[first] !== 'object' || obj[first] === null) {
      obj[first] = {};
    }
    setNestedKey(obj[first] as Record<string, unknown>, rest, value);
  }
}
