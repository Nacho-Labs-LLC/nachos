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

  // Semantic validation: prevent security-critical downgrades via the API.
  // These settings must be changed by editing nachos.toml directly, not
  // through the admin API, to prevent accidental or malicious weakening.
  try {
    const parsed = TOML.parse(body.content) as Record<string, unknown>;
    const security = parsed['security'] as Record<string, unknown> | undefined;
    if (security && security['mode'] === 'permissive') {
      return c.json(
        {
          error: 'Security policy violation',
          details:
            'Cannot set security_mode to "permissive" via the API. Edit nachos.toml directly.',
        },
        403
      );
    }

    const dlp = parsed['dlp'] as Record<string, unknown> | undefined;
    if (dlp && dlp['default_action'] === 'allow') {
      return c.json(
        {
          error: 'Security policy violation',
          details:
            'Cannot set DLP default_action to "allow" via the API. Edit nachos.toml directly.',
        },
        403
      );
    }
  } catch {
    // parseToml succeeded above, so a TOML.parse failure here is unexpected.
    // Fall through — the content is valid TOML, just not parseable by the
    // secondary parser. The primary parseToml check is authoritative.
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

  // Semantic validation: block security-critical downgrades via PATCH
  if (body.path === 'security.mode' && body.value === 'permissive') {
    return c.json(
      {
        error: 'Security policy violation',
        details:
          'Cannot set security_mode to "permissive" via the API. Edit nachos.toml directly.',
      },
      403
    );
  }
  if (body.path === 'dlp.default_action' && body.value === 'allow') {
    return c.json(
      {
        error: 'Security policy violation',
        details:
          'Cannot set DLP default_action to "allow" via the API. Edit nachos.toml directly.',
      },
      403
    );
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
