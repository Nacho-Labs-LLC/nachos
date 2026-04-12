/**
 * Channel registry helpers
 */

import type { ChannelsConfig, NachosConfig } from './schema.js';

export interface ChannelRegistryEntry {
  id: string;
  config: unknown;
}

export function isChannelEnabled(config?: { enabled?: boolean }): boolean {
  if (!config) return false;
  return config.enabled !== false;
}

export function listEnabledChannels(config: NachosConfig): string[] {
  if (!config.channels) return [];
  return Object.entries(config.channels)
    .filter(([_, cfg]) => isChannelEnabled(cfg))
    .map(([name]) => name);
}

export function getChannelConfig(
  config: NachosConfig,
  channelId: keyof ChannelsConfig
): ChannelsConfig[keyof ChannelsConfig] | undefined {
  return config.channels?.[channelId];
}

export function buildChannelRegistry(config: NachosConfig): ChannelRegistryEntry[] {
  if (!config.channels) return [];
  return Object.entries(config.channels)
    .filter(([_, cfg]) => isChannelEnabled(cfg))
    .map(([id, cfg]) => ({ id, config: cfg }));
}
