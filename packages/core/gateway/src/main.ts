/**
 * Gateway Service Entry Point
 */
import { createBusClient } from '@nachos/bus';
import { loadAndValidateConfig } from '@nachos/config';
import { createContextManager } from '@nachos/context-manager';
import { createDefaultDLPConfig, type DLPConfig } from './security/dlp.js';
import {
  Gateway,
  loadConfig as loadGatewayConfig,
  validateConfig as validateGatewayConfig,
} from './index.js';
import { NatsBusAdapter } from './router.js';
import type { StateLayerConfig } from './state-layer/types.js';
import type { RuntimeConfig } from '@nachos/config';
import path from 'node:path';

async function buildDlpConfig(configPath?: string): Promise<DLPConfig | undefined> {
  const nachosConfig = loadAndValidateConfig({ configPath });
  const dlp = nachosConfig.security?.dlp;
  if (!dlp || dlp.enabled === false) {
    return undefined;
  }

  const base = createDefaultDLPConfig();
  const action = dlp.action ?? 'audit';
  const mappedAction =
    action === 'block'
      ? 'block'
      : action === 'redact'
        ? 'redact'
        : action === 'allow'
          ? 'allow'
          : 'alert';

  return {
    ...base,
    enabled: true,
    globalPolicy: {
      ...base.globalPolicy,
      action: mappedAction,
      patterns: dlp.patterns,
    },
  };
}

async function start(): Promise<void> {
  const gatewayConfig = loadGatewayConfig();
  validateGatewayConfig(gatewayConfig);

  const configPath = process.env.NACHOS_CONFIG_PATH ?? process.env.NACHOS_CONFIG;
  const dlpConfig = await buildDlpConfig(configPath);
  const nachosConfig = loadAndValidateConfig({ configPath });
  const runtime = nachosConfig.runtime;
  const contextManagement = runtime?.context_management
    ? mapContextManagement(runtime.context_management)
    : undefined;
  const contextManager = contextManagement ? createContextManager(contextManagement) : undefined;

  const proactiveHistory = contextManagement?.proactive_history;
  const stateLayerConfig = buildStateLayerConfig(runtime);
  const memoryPipelineConfig = proactiveHistory?.enabled
    ? {
        proactiveHistory,
        agentIdResolver: (session: { userId?: string; id: string }) => session.userId ?? session.id,
      }
    : undefined;

  const subagentConfig = runtime?.subagents?.enabled
    ? {
        mode: runtime.subagents.sandbox?.mode ?? 'host',
        docker: runtime.subagents.sandbox?.docker
          ? {
              image: runtime.subagents.sandbox.docker.image ?? 'nachos/subagent:latest',
              network: runtime.subagents.sandbox.docker.network ?? 'egress',
              workspaceDir: runtime.subagents.sandbox.docker.workspace_dir ?? runtime.workspace_dir,
              configDir: runtime.subagents.sandbox.docker.config_dir ?? runtime.config_dir,
              stateDir: runtime.subagents.sandbox.docker.state_dir ?? runtime.state_dir,
              timeoutMs: runtime.subagents.sandbox.docker.timeout_ms,
            }
          : undefined,
      }
    : undefined;

  const busClient = createBusClient({
    servers: gatewayConfig.natsServers,
    name: 'gateway',
  });

  await busClient.connect();

  const busAdapter = new NatsBusAdapter(busClient);

  const gateway = new Gateway({
    dbPath: gatewayConfig.dbPath,
    healthPort: gatewayConfig.healthPort,
    bus: busAdapter,
    defaultSystemPrompt: gatewayConfig.defaultSystemPrompt,
    channels: gatewayConfig.channels,
    policyConfig: {
      policiesPath: gatewayConfig.policy?.policiesPath ?? '/app/policies',
      securityMode: gatewayConfig.policy?.securityMode ?? 'standard',
      enableHotReload: gatewayConfig.policy?.enableHotReload ?? true,
      defaultEffect: gatewayConfig.policy?.defaultEffect ?? 'deny',
    },
    auditConfig: nachosConfig.security?.audit,
    approvalAllowlist: nachosConfig.security?.approval?.approver_allowlist,
    rateLimiterConfig: gatewayConfig.rateLimiter,
    streamingPassthrough: gatewayConfig.streamingPassthrough,
    streamingChunkSize: gatewayConfig.streamingChunkSize,
    streamingMinIntervalMs: gatewayConfig.streamingMinIntervalMs,
    dlpConfig,
    contextManager,
    stateLayerConfig,
    memoryPipelineConfig,
    subagentConfig,
  });

  const shutdown = async (signal: string) => {
    console.log(`[Gateway] ${signal} received, shutting down...`);
    try {
      await gateway.stop();
    } finally {
      await busClient.disconnect();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await gateway.start();
}

function mapContextManagement(config: RuntimeConfig['context_management']) {
  if (!config) return undefined;

  const slidingWindow = config.sliding_window
    ? {
        enabled: config.sliding_window.enabled ?? false,
        mode: config.sliding_window.mode ?? 'hybrid',
        thresholds: {
          proactivePrune: config.sliding_window.thresholds?.proactive_prune ?? 0.6,
          lightCompaction: config.sliding_window.thresholds?.light_compaction ?? 0.75,
          aggressiveCompaction: config.sliding_window.thresholds?.aggressive_compaction ?? 0.85,
          emergency: config.sliding_window.thresholds?.emergency ?? 0.95,
        },
        keepRecent: {
          turns: config.sliding_window.keep_recent?.turns ?? 10,
          messages: config.sliding_window.keep_recent?.messages ?? 20,
          tokenBudget: config.sliding_window.keep_recent?.token_budget ?? 10000,
        },
        slideStrategy: config.sliding_window.slide_strategy ?? 'turn',
        chunkSize: config.sliding_window.chunk_size,
      }
    : undefined;

  const summarization = config.summarization
    ? {
        enabled: config.summarization.enabled ?? false,
        mode: config.summarization.mode ?? 'multi-tier',
        tiers: {
          archival: {
            compressionRatio: config.summarization.tiers?.archival?.compression_ratio ?? 0.05,
            format: config.summarization.tiers?.archival?.format ?? 'bullet-points',
            preserves: config.summarization.tiers?.archival?.preserves,
          },
          compressed: {
            compressionRatio: config.summarization.tiers?.compressed?.compression_ratio ?? 0.2,
            format: config.summarization.tiers?.compressed?.format ?? 'structured-summary',
            preserves: config.summarization.tiers?.compressed?.preserves,
          },
          condensed: {
            compressionRatio: config.summarization.tiers?.condensed?.compression_ratio ?? 0.5,
            format: config.summarization.tiers?.condensed?.format ?? 'detailed-summary',
            preserves: config.summarization.tiers?.condensed?.preserves,
          },
        },
        contentClassification: config.summarization.content_classification
          ? {
              enabled: config.summarization.content_classification.enabled ?? true,
              preserveCritical:
                config.summarization.content_classification.preserve_critical ?? true,
              preserveCode: config.summarization.content_classification.preserve_code ?? true,
              preserveErrors: config.summarization.content_classification.preserve_errors ?? true,
            }
          : undefined,
        customInstructions: config.summarization.custom_instructions,
      }
    : undefined;

  const proactiveHistory = config.proactive_history
    ? {
        enabled: config.proactive_history.enabled ?? false,
        extractors: {
          decisions: config.proactive_history.extractors?.decisions ?? true,
          facts: config.proactive_history.extractors?.facts ?? true,
          tasks: config.proactive_history.extractors?.tasks ?? true,
          issues: config.proactive_history.extractors?.issues ?? true,
          files: config.proactive_history.extractors?.files ?? true,
        },
        triggers: {
          onCompaction: config.proactive_history.triggers?.on_compaction ?? true,
          onThreshold: config.proactive_history.triggers?.on_threshold ?? 0.7,
          onMemoryFlush: config.proactive_history.triggers?.on_memory_flush ?? false,
          periodic: config.proactive_history.triggers?.periodic,
        },
        snapshots: {
          enabled: config.proactive_history.snapshots?.enabled ?? false,
          dir: config.proactive_history.snapshots?.dir,
          maxSnapshots: config.proactive_history.snapshots?.max_snapshots ?? 50,
        },
        summaryArchive: config.proactive_history.summary_archive
          ? {
              enabled: config.proactive_history.summary_archive.enabled ?? false,
              dir: config.proactive_history.summary_archive.dir ?? 'memory/summaries',
              maxSummaries: config.proactive_history.summary_archive.max_summaries ?? 100,
            }
          : undefined,
        customPatternFiles: config.proactive_history.custom_pattern_files,
      }
    : undefined;

  const memoryFlush = config.memory_flush
    ? {
        enabled: config.memory_flush.enabled ?? false,
        softThresholdTokens: config.memory_flush.soft_threshold_tokens ?? 4000,
        extractStructured: config.memory_flush.extract_structured ?? true,
        createSnapshot: config.memory_flush.create_snapshot ?? true,
        validateExtraction: config.memory_flush.validate_extraction ?? true,
        systemPrompt:
          config.memory_flush.system_prompt ??
          'Session nearing compaction. Extract structured memory now.',
        prompt: config.memory_flush.prompt ?? '',
      }
    : undefined;

  return {
    sliding_window: slidingWindow,
    summarization,
    proactive_history: proactiveHistory,
    memoryFlush,
  };
}

function buildStateLayerConfig(runtime?: RuntimeConfig): StateLayerConfig {
  const stateDir = runtime?.state_dir ?? './state';
  const identityProvider = runtime?.state?.identity?.provider ?? 'filesystem';
  const memoryProvider = runtime?.state?.memory?.provider ?? 'filesystem';
  const sessionProvider =
    runtime?.state?.session?.provider ?? (runtime?.redis_url ? 'redis' : 'memory');

  const identityDir = runtime?.state?.identity?.filesystem?.dir ?? path.join(stateDir, 'identity');
  const memoryDir = runtime?.state?.memory?.filesystem?.dir ?? path.join(stateDir, 'memory');

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

start().catch((error) => {
  console.error('[Gateway] Fatal error', error);
  process.exit(1);
});
