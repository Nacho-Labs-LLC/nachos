import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { loadTomlFile, type NachosConfig } from '@nachos/config';
import type { GatewayHealth, ConfigStatus, StatusResponse } from '../types.js';

const CONFIG_PATH = process.env['NACHOS_CONFIG_PATH'] ?? '/app/nachos.toml';
const GATEWAY_HEALTH_URL =
  process.env['GATEWAY_HEALTH_URL'] ?? 'http://gateway:3000/health';

const KNOWN_TOOLS = [
  'filesystem',
  'browser',
  'code_runner',
  'shell',
  'web_fetch',
  'web_search',
  'bootstrap',
  'claude_code_mcp',
] as const;

export const statusRouter = new Hono();

statusRouter.get('/', async (c) => {
  const configStatus = readConfigStatus();
  const gatewayHealth = await fetchGatewayHealth();

  const response: StatusResponse = {
    gateway: gatewayHealth,
    config: configStatus,
    timestamp: new Date().toISOString(),
  };

  return c.json(response);
});

async function fetchGatewayHealth(): Promise<GatewayHealth> {
  try {
    const res = await fetch(GATEWAY_HEALTH_URL, {
      signal: AbortSignal.timeout(3000),
    });
    return (await res.json()) as GatewayHealth;
  } catch {
    return { status: 'unreachable' };
  }
}

function readConfigStatus(): ConfigStatus | null {
  if (!existsSync(CONFIG_PATH)) return null;

  try {
    const config: NachosConfig = loadTomlFile(CONFIG_PATH);

    const channelStatuses: ConfigStatus['channels'] = {};
    if (config.channels) {
      for (const [name, val] of Object.entries(config.channels)) {
        if (val && typeof val === 'object' && 'enabled' in val) {
          channelStatuses[name] = { enabled: Boolean(val.enabled) };
        }
      }
    }

    const toolStatuses: ConfigStatus['tools'] = {};
    if (config.tools) {
      for (const name of KNOWN_TOOLS) {
        const val = config.tools[name];
        if (val && typeof val === 'object' && 'enabled' in val) {
          toolStatuses[name] = { enabled: Boolean(val.enabled) };
        }
      }
    }

    return {
      llm: {
        provider: config.llm?.provider,
        model: config.llm?.model,
      },
      channels: channelStatuses,
      tools: toolStatuses,
      security: { mode: config.security?.mode },
    };
  } catch {
    return null;
  }
}
