/**
 * State layer helpers for CLI commands.
 */

import path from 'node:path';
import type { NachosConfig, RuntimeConfig } from '@nachos/config';
import { createStateLayer, type StateLayer, type StateLayerConfig } from '@nachos/gateway';

export function buildStateLayerConfig(runtime?: RuntimeConfig): StateLayerConfig {
  const stateDir = runtime?.state_dir ?? './state';
  const identityProvider = runtime?.state?.identity?.provider ?? 'filesystem';
  const memoryProvider = runtime?.state?.memory?.provider ?? 'filesystem';
  const userProfileProvider = runtime?.state?.user_profile?.provider ?? 'filesystem';
  const sessionProvider =
    runtime?.state?.session?.provider ?? (runtime?.redis_url ? 'redis' : 'memory');

  const identityDir = runtime?.state?.identity?.filesystem?.dir ?? path.join(stateDir, 'identity');
  const memoryDir = runtime?.state?.memory?.filesystem?.dir ?? path.join(stateDir, 'memory');
  const userProfileDir =
    runtime?.state?.user_profile?.filesystem?.dir ?? path.join(stateDir, 'user-profiles');

  return {
    identity: {
      provider: identityProvider,
      filesystem: { dir: identityDir },
      postgres: runtime?.state?.identity?.postgres
        ? {
            connectionString: runtime.state.identity.postgres.connection_string ?? '',
            schema: runtime.state.identity.postgres.schema,
            ssl: runtime.state.identity.postgres.ssl,
            maxConnections: runtime.state.identity.postgres.max_connections,
          }
        : undefined,
    },
    memory: {
      provider: memoryProvider,
      filesystem: { dir: memoryDir },
      postgres: runtime?.state?.memory?.postgres
        ? {
            connectionString: runtime.state.memory.postgres.connection_string ?? '',
            schema: runtime.state.memory.postgres.schema,
            ssl: runtime.state.memory.postgres.ssl,
            maxConnections: runtime.state.memory.postgres.max_connections,
          }
        : undefined,
    },
    userProfile: {
      provider: userProfileProvider,
      filesystem: { dir: userProfileDir },
      postgres: runtime?.state?.user_profile?.postgres
        ? {
            connectionString: runtime.state.user_profile.postgres.connection_string ?? '',
            schema: runtime.state.user_profile.postgres.schema,
            ssl: runtime.state.user_profile.postgres.ssl,
            maxConnections: runtime.state.user_profile.postgres.max_connections,
          }
        : undefined,
    },
    session: {
      provider: sessionProvider,
      redisUrl: runtime?.state?.session?.redis_url ?? runtime?.redis_url,
      ttlSeconds: runtime?.state?.session?.ttl_seconds,
    },
    prompt: {
      hashAlgorithm: runtime?.state?.prompt_report?.hash ?? 'sha256',
      includeTokenEstimates: runtime?.state?.prompt_report?.include_tokens ?? true,
      maxMemoryEntries: runtime?.state?.prompt_report?.max_memory_entries ?? 50,
      maxMemoryFacts: runtime?.state?.prompt_report?.max_memory_facts ?? 50,
      includeSessionState: runtime?.state?.prompt_report?.include_session_state ?? false,
    },
  };
}

export function createStateLayerFromConfig(config: NachosConfig): StateLayer {
  return createStateLayer(buildStateLayerConfig(config.runtime));
}
