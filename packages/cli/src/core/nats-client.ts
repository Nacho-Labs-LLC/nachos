/**
 * NATS client helper for CLI commands.
 */

import { createBusClient, type NachosBusClient } from '@nachos/bus';

export async function createCliBusClient(): Promise<NachosBusClient> {
  const servers = resolveNatsServers();
  const client = createBusClient({
    servers,
    name: 'nachos-cli',
  });
  await client.connect();
  return client;
}

function resolveNatsServers(): string | string[] {
  const envServers = process.env.NATS_SERVERS;
  if (envServers) {
    return envServers
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return process.env.NATS_URL ?? 'nats://localhost:4222';
}
