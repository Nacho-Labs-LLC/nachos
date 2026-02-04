/**
 * Policy helpers for channel adapters
 */

import type { ChannelDMConfig, ChannelServerConfig } from '@nachos/config';
import type { ChannelDMPolicy, ChannelGroupPolicy } from '@nachos/types';

export function resolveDmPolicy(dm?: ChannelDMConfig): ChannelDMPolicy | undefined {
  if (!dm) return undefined;
  return {
    userAllowlist: dm.user_allowlist,
    pairing: dm.pairing ?? false,
  };
}

export function resolveGroupPolicy(server: ChannelServerConfig): ChannelGroupPolicy {
  return {
    mentionGating: server.mention_gating ?? true,
    channelIds: server.channel_ids,
    userAllowlist: server.user_allowlist,
  };
}

export function findServerConfig(
  servers: ChannelServerConfig[] | undefined,
  id: string
): ChannelServerConfig | undefined {
  return servers?.find((server) => server.id === id);
}
