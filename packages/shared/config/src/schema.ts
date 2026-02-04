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
  provider: 'anthropic' | 'openai' | 'ollama' | 'custom';
  api_key_env: string;
  base_url?: string;
}

export interface LLMProviderConfig {
  name: string;
  type: 'anthropic' | 'openai' | 'ollama' | 'custom';
  base_url?: string;
  models?: string[];
  profiles?: string[];
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
  provider: 'anthropic' | 'openai' | 'ollama' | 'custom';
  model: string;
  fallback_order?: string[];
  providers?: LLMProviderConfig[];
  profiles?: LLMAuthProfileConfig[];
  profile_order?: string[];
  retry?: LLMRetryConfig;
  cooldowns?: LLMCooldownConfig;
  max_tokens?: number;
  temperature?: number;
  base_url?: string; // For Ollama and custom providers
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
  id: string;
  channel_ids: string[];
  user_allowlist: string[];
  mention_gating?: boolean;
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
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
}

/**
 * Discord channel configuration
 */
export interface DiscordChannelConfig extends BaseChannelConfig {
  token?: string;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
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
 * All channel configurations
 */
export interface ChannelsConfig {
  webchat?: WebchatChannelConfig;
  slack?: SlackChannelConfig;
  discord?: DiscordChannelConfig;
  telegram?: TelegramChannelConfig;
  whatsapp?: WhatsappChannelConfig;
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
}

/**
 * Data Loss Prevention (DLP) configuration
 */
export interface DLPConfig {
  enabled: boolean;
  action?: 'block' | 'warn' | 'audit';
  patterns?: string[];
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
 * Runtime configuration
 */
export interface RuntimeConfig {
  state_dir?: string;
  log_level?: 'debug' | 'info' | 'warn' | 'error';
  log_format?: 'pretty' | 'json';
  redis_url?: string;
  resources?: ResourcesConfig;
  gateway_streaming_passthrough?: boolean;
  gateway_streaming_chunk_size?: number;
  gateway_streaming_min_interval_ms?: number;
}

/**
 * Assistant configuration
 */
export interface AssistantConfig {
  name?: string;
  system_prompt?: string;
  context_files?: string[];
}

/**
 * Skills configuration
 */
export interface SkillsConfig {
  enabled?: string[];
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
}

/**
 * Partial configuration for overlays (e.g., from environment variables)
 */
export type PartialNachosConfig = {
  [K in keyof NachosConfig]?: K extends 'nachos' | 'llm' | 'security'
    ? Partial<NachosConfig[K]>
    : NachosConfig[K];
};
