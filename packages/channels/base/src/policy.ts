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

/**
 * Build a server/DM config from environment variables for a given channel prefix.
 * e.g. prefix = 'CHANNEL_DISCORD' reads CHANNEL_DISCORD_GUILD_ID, etc.
 *
 * channel_ids: [] means allow all channels (no channel restriction)
 * user_allowlist: [] means deny all users (must be explicitly listed)
 *
 * Only merges into channelConfig if the TOML-derived config has no servers set.
 */
export function buildServerConfigFromEnv(prefix: string): {
  servers?: ChannelServerConfig[];
  dm?: ChannelDMConfig;
} {
  const result: { servers?: ChannelServerConfig[]; dm?: ChannelDMConfig } = {};

  const guildId = process.env[`${prefix}_GUILD_ID`];
  if (guildId) {
    const channelIds =
      process.env[`${prefix}_CHANNEL_IDS`]
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const userAllowlist =
      process.env[`${prefix}_USER_ALLOWLIST`]
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const mentionGating = process.env[`${prefix}_MENTION_GATING`] === 'true';
    result.servers = [
      {
        id: guildId,
        channel_ids: channelIds,
        user_allowlist: userAllowlist,
        mention_gating: mentionGating,
      },
    ];
  }

  const dmAllowlistEnv = process.env[`${prefix}_DM_ALLOWLIST`];
  if (dmAllowlistEnv !== undefined) {
    const dmAllowlist = dmAllowlistEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    result.dm = { user_allowlist: dmAllowlist, pairing: false };
  }

  return result;
}
