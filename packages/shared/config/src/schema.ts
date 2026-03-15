/**
 * Configuration Schema for Nachos
 *
 * This file defines the TypeScript types that match the nachos.toml structure.
 */

/**
 * Core Nachos settings
 */
export interface NachosSection {
  name: string;
  version: string;
}

/**
 * LLM provider configuration
 */
export interface LLMAuthProfileConfig {
  name: string;
  provider: 'anthropic' | 'openai' | 'ollama' | 'bedrock' | 'custom';
  api_key_env: string;
  base_url?: string;
}

export interface LLMRetryConfig {
  attempts?: number;
  min_delay_ms?: number;
  max_delay_ms?: number;
  jitter?: number;
}

export interface LLMCooldownConfig {
  initial_seconds?: number;
  multiplier?: number;
  max_seconds?: number;
  billing_initial_hours?: number;
  billing_max_hours?: number;
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'ollama' | 'bedrock' | 'custom';
  model: string;
  fallback_order?: string[];
  profiles?: LLMAuthProfileConfig[];
  profile_order?: string[];
  retry?: LLMRetryConfig;
  cooldowns?: LLMCooldownConfig;
  max_tokens?: number;
  temperature?: number;
  base_url?: string; // For Ollama and custom providers
  region?: string; // AWS region for Bedrock provider
  /** Override the model's context window size (tokens). Auto-detected from model ID if omitted. */
  context_window?: number;
}

/**
 * Base channel configuration
 */
export interface BaseChannelConfig {
  enabled?: boolean;
}

/**
 * Channel DM configuration (optional)
 */
export interface ChannelDMConfig {
  user_allowlist: string[];
  pairing?: boolean;
}

/**
 * Channel server/guild configuration
 */
export interface ChannelServerConfig {
  /** Deprecated single server id (use ids). */
  id?: string;
  /** One or more server ids. */
  ids?: string[];
  channel_ids: string[];
  user_allowlist: string[];
  mention_gating?: boolean;
}

/**
 * Channel command configuration
 */
export interface ChannelCommandsConfig {
  enabled?: string[];
  admin_allowlist?: string[];
}

/**
 * Webchat channel configuration
 */
export interface WebchatChannelConfig extends BaseChannelConfig {
  port?: number;
}

/**
 * Slack channel configuration
 */
export interface SlackChannelConfig extends BaseChannelConfig {
  mode?: 'socket' | 'http';
  app_token?: string;
  bot_token?: string;
  signing_secret?: string;
  webhook_path?: string;
  commands?: ChannelCommandsConfig;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
  /** Show typing indicator while bot is processing (default: true).
   * Note: Slack bots cannot show typing indicators in regular channels due to API limitations.
   * Status events are subscribed for future use and for assistant threads. */
  typing_indicators?: boolean;
}

/**
 * Discord channel configuration
 */
export interface DiscordChannelConfig extends BaseChannelConfig {
  token?: string;
  commands?: ChannelCommandsConfig;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
  /** Allow messages from bot accounts (default: false). Useful for bot-to-bot testing. */
  allow_bots?: boolean;
  /** If allow_bots is true, optionally restrict to these bot user IDs only. */
  bot_allowlist?: string[];
  /** Status emoji reactions during bot operations (default: disabled). */
  status_emojis?: {
    /** Enable status emoji reactions on messages (default: false). */
    enabled?: boolean;
  };
  /** Show typing indicator while bot is processing (default: true). */
  typing_indicators?: boolean;
}

/**
 * Telegram channel configuration
 */
export interface TelegramChannelConfig extends BaseChannelConfig {
  token?: string;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
}

/**
 * WhatsApp channel configuration
 */
export interface WhatsappChannelConfig extends BaseChannelConfig {
  token?: string;
  phone_number_id?: string;
  verify_token?: string;
  webhook_path?: string;
  api_version?: string;
  app_secret?: string;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
}

/**
 * Matrix channel configuration
 */
export interface MatrixChannelConfig extends BaseChannelConfig {
  homeserver_url?: string;
  access_token?: string;
  user_id?: string;
  device_id?: string;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
}

/**
 * All channel configurations
 */
export interface ChannelsConfig {
  webchat?: WebchatChannelConfig;
  slack?: SlackChannelConfig;
  discord?: DiscordChannelConfig;
  telegram?: TelegramChannelConfig;
  whatsapp?: WhatsappChannelConfig;
  matrix?: MatrixChannelConfig;
}

/**
 * Filesystem tool configuration
 */
export interface FilesystemToolConfig {
  enabled: boolean;
  paths?: string[];
  write?: boolean;
  max_file_size?: string;
}

/**
 * Browser tool configuration
 */
export interface BrowserToolConfig {
  enabled: boolean;
  allowed_domains?: string[];
  headless?: boolean;
  timeout?: number;
}

/**
 * Code runner tool configuration
 */
export interface CodeRunnerToolConfig {
  enabled: boolean;
  runtime?: 'sandboxed' | 'native';
  languages?: string[];
  timeout?: number;
  max_memory?: string;
}

/**
 * Shell tool configuration
 */
export interface ShellToolConfig {
  enabled: boolean;
}

/**
 * Web search tool configuration
 */
export interface WebSearchToolConfig {
  enabled: boolean;
  api_key_env?: string;
  default_country?: string;
  safe_search?: 'off' | 'moderate' | 'strict';
  max_results?: number;
}

/**
 * Firecrawl fallback configuration for web fetch
 */
export interface FirecrawlConfig {
  enabled?: boolean;
  api_key?: string;
  base_url?: string;
  only_main_content?: boolean;
  max_age_ms?: number;
  timeout_seconds?: number;
}

/**
 * Web fetch tool configuration
 */
export interface WebFetchToolConfig {
  enabled: boolean;
  allowed_domains?: string[];
  domain_allowlist?: string[];
  max_chars?: number;
  timeout_ms?: number;
  timeout_seconds?: number;
  max_redirects?: number;
  user_agent?: string;
  firecrawl?: FirecrawlConfig;
}

/**
 * Bootstrap tool configuration
 */
export interface BootstrapToolConfig {
  enabled: boolean;
}

/**
 * Tool group configuration for policy grouping
 */
export interface ToolGroupConfig {
  enabled?: boolean;
  tools: string[];
  description?: string;
}

/**
 * Copilot tool configuration
 */
export interface CopilotToolConfig {
  enabled: boolean;
  max_prompt_length?: number;
  max_output_size?: number;
  default_timeout?: number;
  max_timeout?: number;
}

/**
 * Claude Code MCP tool configuration
 */
export interface ClaudeCodeMcpToolConfig {
  enabled: boolean;
  max_prompt_length?: number;
}

/**
 * Bitbucket tool configuration
 */
export interface BitbucketToolConfig {
  enabled: boolean;
  default_workspace?: string;
  auth_type?: 'app_password' | 'oauth';
  username_env?: string;
  password_env?: string;
  token_env?: string;
  workspace_allowlist?: string[];
}

/**
 * Composio tool configuration
 */
export interface ComposioToolConfig {
  enabled: boolean;
  api_key_env?: string;
  entity_id?: string;
  allowed_apps?: string[];
}

/**
 * GitHub tool configuration
 */
export interface GitHubToolConfig {
  enabled: boolean;
  default_repo?: string;
  token_env?: string;
  repo_allowlist?: string[];
}

/**
 * Agent exec tool configuration (Claude Code CLI subprocess launcher)
 */
export interface AgentExecToolConfig {
  enabled?: boolean;
  max_concurrent?: number;
  default_timeout?: number;
  max_timeout?: number;
  max_output_buffer?: number;
}

/**
 * All tool configurations
 */
export interface ToolsConfig {
  filesystem?: FilesystemToolConfig;
  browser?: BrowserToolConfig;
  code_runner?: CodeRunnerToolConfig;
  shell?: ShellToolConfig;
  web_search?: WebSearchToolConfig;
  web_fetch?: WebFetchToolConfig;
  bootstrap?: BootstrapToolConfig;
  copilot?: CopilotToolConfig;
  claude_code_mcp?: ClaudeCodeMcpToolConfig;
  bitbucket?: BitbucketToolConfig;
  composio?: ComposioToolConfig;
  github?: GitHubToolConfig;
  agent_exec?: AgentExecToolConfig;
  groups?: Record<string, ToolGroupConfig>;
}

/**
 * Data Loss Prevention (DLP) configuration
 */
export interface DLPConfig {
  enabled: boolean;
  action?: 'block' | 'warn' | 'audit' | 'allow' | 'redact';
  patterns?: string[];
}

/**
 * Approval configuration for restricted operations
 */
export interface ApprovalConfig {
  approver_allowlist?: string[];
}

/**
 * Rate limit configuration
 */
export interface RateLimitsConfig {
  messages_per_minute?: number;
  tool_calls_per_minute?: number;
  llm_requests_per_minute?: number;
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  enabled: boolean;
  retention_days?: number;
  log_inputs?: boolean;
  log_outputs?: boolean;
  log_tool_calls?: boolean;
  provider?: 'sqlite' | 'file' | 'webhook' | 'custom' | 'composite';
  providers?: string[];
  path?: string;
  rotate_size?: number;
  max_files?: number;
  url?: string;
  headers?: Record<string, string>;
  batch_size?: number;
  flush_interval_ms?: number;
  custom_path?: string;
  custom_config?: Record<string, unknown>;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  mode: 'strict' | 'standard' | 'permissive';
  i_understand_the_risks?: boolean;
  dlp?: DLPConfig;
  rate_limits?: RateLimitsConfig;
  audit?: AuditConfig;
  approval?: ApprovalConfig;
}

/**
 * Resource limits configuration
 */
export interface ResourcesConfig {
  memory?: string;
  cpus?: number;
  pids_limit?: number;
}

/**
 * Per-service resource overrides for Docker Compose generation
 */
export interface ServiceResourceOverrides {
  gateway?: ResourcesConfig;
  llm_proxy?: ResourcesConfig;
  admin?: ResourcesConfig;
  bus?: ResourcesConfig;
  redis?: ResourcesConfig;
  channels?: ResourcesConfig;
  tools?: ResourcesConfig;
}

/**
 * Context Management - Zone Thresholds
 */
export interface ContextZoneThresholds {
  proactive_prune?: number; // default: 0.60
  light_compaction?: number; // default: 0.75
  aggressive_compaction?: number; // default: 0.85
  emergency?: number; // default: 0.95
}

/**
 * Context Management - Sliding Window Configuration
 */
export interface SlidingWindowConfig {
  enabled?: boolean;
  mode?: 'token-based' | 'message-based' | 'hybrid';
  thresholds?: ContextZoneThresholds;
  keep_recent?: {
    turns?: number; // default: 10
    messages?: number; // default: 20
    token_budget?: number; // default: 10000
  };
  slide_strategy?: 'chunk' | 'message' | 'turn';
  chunk_size?: number;
}

/**
 * Context Management - Summarization Tier Configuration
 */
export interface SummarizationTierConfig {
  compression_ratio?: number;
  format?: 'bullet-points' | 'structured-summary' | 'detailed-summary';
  preserves?: string[];
}

/**
 * Context Management - Summarization Configuration
 */
export interface SummarizationConfig {
  enabled?: boolean;
  mode?: 'single' | 'multi-tier';
  tiers?: {
    archival?: SummarizationTierConfig;
    compressed?: SummarizationTierConfig;
    condensed?: SummarizationTierConfig;
  };
  content_classification?: {
    enabled?: boolean;
    preserve_critical?: boolean;
    preserve_code?: boolean;
    preserve_errors?: boolean;
  };
  custom_instructions?: string;
}

/**
 * Context Management - Proactive History Configuration
 */
export interface ProactiveHistoryConfig {
  enabled?: boolean;
  extractors?: {
    decisions?: boolean;
    facts?: boolean;
    tasks?: boolean;
    issues?: boolean;
    files?: boolean;
  };
  triggers?: {
    /** DLP extraction on context compaction (still active) */
    on_compaction?: boolean;
    /** @deprecated Threshold triggers removed — extraction now happens at session end */
    on_threshold?: number;
    /** @deprecated Memory flush triggers removed — extraction now happens at session end */
    on_memory_flush?: boolean;
    /** @deprecated Periodic extraction removed — extraction now happens at session end via session sweeper */
    periodic?: string;
  };
  snapshots?: {
    enabled?: boolean;
    dir?: string;
    max_snapshots?: number;
  };
  summary_archive?: {
    enabled?: boolean;
    dir?: string;
    max_summaries?: number;
  };
  custom_pattern_files?: string[];
}

/**
 * Context Management - Memory Flush Configuration
 */
export interface MemoryFlushConfig {
  enabled?: boolean;
  soft_threshold_tokens?: number;
  extract_structured?: boolean;
  create_snapshot?: boolean;
  validate_extraction?: boolean;
  system_prompt?: string;
  prompt?: string;
}

/**
 * Context Management - Command Configuration
 */
export interface ContextManagementCommandsConfig {
  enabled?: boolean;
  allow_in_dms?: boolean;
  allow_in_channels?: boolean;
  admin_allowlist?: string[];
  reset_triggers?: string[];
  context_triggers?: string[];
  identity_triggers?: string[];
  help_triggers?: string[];
}

/**
 * Context Management Configuration
 */
export interface ContextManagementConfig {
  sliding_window?: SlidingWindowConfig;
  summarization?: SummarizationConfig;
  proactive_history?: ProactiveHistoryConfig;
  memory_flush?: MemoryFlushConfig;
  commands?: ContextManagementCommandsConfig;
}

/**
 * State layer storage configuration
 */
export interface StateStoreFilesystemConfig {
  dir?: string;
}

export interface StateStorePostgresConfig {
  connection_string?: string;
  schema?: string;
  ssl?: boolean;
  max_connections?: number;
}

export interface StateStoreConfig {
  provider?: 'filesystem' | 'postgres';
  filesystem?: StateStoreFilesystemConfig;
  postgres?: StateStorePostgresConfig;
}

export interface SessionStateConfig {
  provider?: 'redis' | 'memory';
  redis_url?: string;
  ttl_seconds?: number;
}

/**
 * Sessions & Messages (conversation history) storage configuration
 */
export interface SessionsStorageSqliteConfig {
  db_path?: string;
}

export interface SessionsStoragePostgresConfig {
  connection_string?: string;
  schema?: string;
  ssl?: boolean;
  max_connections?: number;
}

export interface SessionsStorageConfig {
  provider?: 'sqlite' | 'postgres';
  sqlite?: SessionsStorageSqliteConfig;
  postgres?: SessionsStoragePostgresConfig;
}

/**
 * Semantic search (embeddings) configuration
 */
export interface SemanticSearchLocalConfig {
  model?: string;
  cache_dir?: string;
}

export interface SemanticSearchConfig {
  provider?: 'local';
  local?: SemanticSearchLocalConfig;
}

export interface PromptReportConfig {
  hash?: 'sha256';
  include_tokens?: boolean;
  max_memory_entries?: number;
  max_memory_facts?: number;
  include_session_state?: boolean;
}

/**
 * Memory injection configuration — controls the hybrid manifest + recall approach
 */
export interface MemoryInjectionConfig {
  /** Enable memory manifest injection into system prompt (default: true). */
  enabled?: boolean;
  /** Maximum tokens for the manifest section (default: 400). */
  manifest_max_tokens?: number;
  /** Include user preferences in the manifest (default: true). */
  manifest_preferences?: boolean;
  /** Number of recent topics to surface (default: 5). */
  manifest_recent_topics?: number;
  /** Include grouped fact counts in the manifest (default: true). */
  manifest_fact_counts?: boolean;
  /** Default per-source result limit for memory_recall tool (default: 5). */
  recall_default_limit?: number;
  /** Minimum similarity score for semantic recall (0-1, default: 0.6). */
  recall_min_similarity?: number;
}

export interface StateLayerConfig {
  identity?: StateStoreConfig;
  memory?: StateStoreConfig;
  user_profile?: StateStoreConfig;
  bootstrap?: StateStoreConfig;
  session?: SessionStateConfig;
  sessions?: SessionsStorageConfig;
  semantic?: SemanticSearchConfig;
  prompt_report?: PromptReportConfig;
  memory_injection?: MemoryInjectionConfig;
}

/**
 * Subagent sandbox configuration
 */
export interface SubagentSandboxDockerConfig {
  image?: string;
  network?: 'none' | 'egress' | 'full';
  workspace_dir?: string;
  config_dir?: string;
  state_dir?: string;
  timeout_ms?: number;
}

export interface SubagentSandboxConfig {
  mode?: 'host' | 'tool' | 'full';
  docker?: SubagentSandboxDockerConfig;
}

export interface SubagentAnnounceConfig {
  enabled?: boolean;
  prompt?: string;
}

export interface SubagentToolProfileConfig {
  allow?: string[];
  deny?: string[];
}

export interface SubagentToolPolicyConfig extends SubagentToolProfileConfig {
  default_profile?: string;
  profiles?: Record<string, SubagentToolProfileConfig>;
}

export interface SubagentConfig {
  enabled?: boolean;
  max_concurrent?: number;
  announce?: SubagentAnnounceConfig;
  tools?: SubagentToolPolicyConfig;
  sandbox?: SubagentSandboxConfig;
}

export interface RuntimeToolSandboxConfig {
  mode?: 'off' | 'non-main' | 'all';
  scope?: 'session' | 'agent' | 'shared';
  workspace_access?: 'none' | 'ro' | 'rw';
  extra_binds?: string[];
  env?: Record<string, string>;
  setup_command?: string;
  network?: 'none' | 'egress' | 'full';
}

/**
 * Self-management configuration for DevOps capability
 */
export interface SelfManagementConfig {
  enabled?: boolean;
  source_dir?: string;
  require_confirmation_for_restart?: boolean;
}

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  state_dir?: string;
  config_dir?: string;
  workspace_dir?: string;
  log_level?: 'debug' | 'info' | 'warn' | 'error';
  log_format?: 'pretty' | 'json';
  redis_url?: string;
  resources?: ResourcesConfig;
  service_resources?: ServiceResourceOverrides;
  gateway_streaming_passthrough?: boolean;
  gateway_streaming_chunk_size?: number;
  gateway_streaming_min_interval_ms?: number;
  context_management?: ContextManagementConfig;
  state?: StateLayerConfig;
  subagents?: SubagentConfig;
  sandbox?: RuntimeToolSandboxConfig;
  self_management?: SelfManagementConfig;
}

/**
 * Assistant configuration
 */
export interface AssistantConfig {
  name?: string;
  system_prompt?: string;
}

/**
 * Skills configuration
 */
export interface SkillEntryConfig {
  enabled?: boolean;
}

export interface SkillsConfig {
  /** Deprecated alias for allowlist. */
  enabled?: string[];
  /** Allowlisted skills (if set, only these load). */
  allow?: string[];
  /** Denylisted skills. */
  deny?: string[];
  /** Per-skill configuration overrides. */
  entries?: Record<string, SkillEntryConfig>;
  /** Enable hot reload of skills when files change (default: true in dev, false in production) */
  hot_reload?: boolean;
  /** Debounce delay in milliseconds for skill reloads (default: 500) */
  debounce_ms?: number;
}

/**
 * Admin UI configuration
 */
export interface AdminConfig {
  enabled?: boolean;
  port?: number;
}

/**
 * A single scheduled job defined in nachos.toml
 */
export interface SchedulerJobConfig {
  /** Unique job name (used as stable identifier for config sync) */
  name: string;
  description?: string;
  /** Schedule type: 'at' (one-shot ISO timestamp), 'every' (interval ms), 'cron' (5-field cron) */
  schedule_type: 'at' | 'every' | 'cron';
  /** Schedule value — ISO timestamp, milliseconds, or cron expression */
  schedule_value: string;
  timezone?: string;
  /** Action type when job fires */
  action_type: 'systemEvent' | 'agentTurn';
  /** Text to inject (for systemEvent) */
  action_text?: string;
  /** Prompt for the LLM (for agentTurn) */
  action_prompt?: string;
  /** Target channel to deliver the job output */
  delivery_channel?: string;
  enabled?: boolean;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  enabled?: boolean;
  check_interval_seconds?: number;
  max_concurrent_jobs?: number;
  run_missed_on_startup?: boolean;
  /** Declarative job definitions — synced to SQLite registry on startup */
  jobs?: SchedulerJobConfig[];
}

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  enabled?: boolean;
  interval_minutes?: number;
  prompt?: string;
  channel?: string;
}

/**
 * Session lifecycle configuration
 */
export interface SessionsLifecycleConfig {
  /**
   * Duration after which an active session with no activity is automatically closed.
   * Parsed as a duration string: '4h', '30m', '1d', etc.
   * Default: '4h'
   */
  inactivity_timeout?: string;
  /**
   * Duration after which a closed session's raw conversation is hard-deleted.
   * Knowledge has already been extracted into MemoryFacts at this point.
   * Parsed as a duration string: '30d', '7d', etc.
   * Default: '30d'
   */
  archive_ttl?: string;
}

/**
 * Complete Nachos configuration
 */
export interface NachosConfig {
  nachos: NachosSection;
  llm: LLMConfig;
  channels?: ChannelsConfig;
  tools?: ToolsConfig;
  security: SecurityConfig;
  runtime?: RuntimeConfig;
  assistant?: AssistantConfig;
  skills?: SkillsConfig;
  admin?: AdminConfig;
  scheduler?: SchedulerConfig;
  heartbeat?: HeartbeatConfig;
  sessions?: SessionsLifecycleConfig;
  /** Plugin-specific configuration sections. Each key is a plugin ID. */
  plugins?: Record<string, Record<string, unknown>>;
}

/**
 * Partial configuration for overlays (e.g., from environment variables)
 */
export type PartialNachosConfig = {
  [K in keyof NachosConfig]?: K extends 'nachos' | 'llm' | 'security'
    ? Partial<NachosConfig[K]>
    : NachosConfig[K];
};
