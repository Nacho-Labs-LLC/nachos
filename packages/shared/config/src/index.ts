/**
 * @nachos/config - Configuration System
 *
 * Provides TOML parsing, environment variable overlays, validation,
 * and hot-reload support for Nachos configuration.
 */

// Export schema types
export type {
  NachosConfig,
  PartialNachosConfig,
  NachosSection,
  LLMConfig,
  LLMAuthProfileConfig,
  LLMProviderConfig,
  LLMRetryConfig,
  LLMCooldownConfig,
  ChannelsConfig,
  BaseChannelConfig,
  WebchatChannelConfig,
  SlackChannelConfig,
  DiscordChannelConfig,
  TelegramChannelConfig,
  WhatsappChannelConfig,
  ChannelCommandsConfig,
  ChannelDMConfig,
  ChannelServerConfig,
  ToolsConfig,
  FilesystemToolConfig,
  BrowserToolConfig,
  CodeRunnerToolConfig,
  ShellToolConfig,
  WebSearchToolConfig,
  WebFetchToolConfig,
  FirecrawlConfig,
  BootstrapToolConfig,
  ToolGroupConfig,
  CopilotToolConfig,
  ClaudeCodeMcpToolConfig,
  GitHubToolConfig,
  BitbucketToolConfig,
  ComposioToolConfig,
  SecurityConfig,
  DLPConfig,
  ApprovalConfig,
  RateLimitsConfig,
  AuditConfig,
  RuntimeConfig,
  ResourcesConfig,
  ContextManagementConfig,
  ContextZoneThresholds,
  SlidingWindowConfig,
  SummarizationTierConfig,
  SummarizationConfig,
  ProactiveHistoryConfig,
  MemoryFlushConfig,
  ContextManagementCommandsConfig,
  StateStoreFilesystemConfig,
  StateStorePostgresConfig,
  StateStoreConfig,
  SessionStateConfig,
  SessionsStorageSqliteConfig,
  SessionsStoragePostgresConfig,
  SessionsStorageConfig,
  SemanticSearchLocalConfig,
  SemanticSearchQdrantConfig,
  SemanticSearchConfig,
  PromptReportConfig,
  StateLayerConfig,
  SubagentSandboxDockerConfig,
  SubagentSandboxConfig,
  SubagentAnnounceConfig,
  SubagentConfig,
  SubagentToolProfileConfig,
  SubagentToolPolicyConfig,
  RuntimeToolSandboxConfig,
  AssistantConfig,
  SkillsConfig,
  SkillEntryConfig,
  AdminConfig,
  SchedulerConfig,
  HeartbeatConfig,
} from './schema.js';

// Export loader functions
export {
  loadConfig,
  loadTomlFile,
  parseToml,
  findConfigFile,
  getConfigSearchPaths,
  ConfigLoadError,
} from './loader.js';

// Export channel registry helpers
export {
  isChannelEnabled,
  listEnabledChannels,
  getChannelConfig,
  buildChannelRegistry,
  type ChannelRegistryEntry,
} from './registry.js';

// Export validation functions
export {
  validateConfig,
  validateConfigOrThrow,
  ConfigValidationError,
  type ValidationResult,
} from './validation.js';

// Export hot-reload functionality
export {
  HotReloadWatcher,
  createPolicyWatcher,
  type FileChangeCallback,
  type WatchOptions,
} from './hotreload.js';

// Export plugin configuration system
export {
  PluginConfigRegistry,
  PluginConfigError,
  validatePluginConfig,
  applyDefaults,
  isValidPluginId,
} from './plugin-config.js';

export type {
  PluginConfigSchema,
  PluginConfigPropertySchema,
  PluginConfigPropertyType,
  PluginConfigValidationResult,
} from './plugin-config.js';

// Main convenience function that loads, overlays, and validates config
export { loadAndValidateConfig } from './main.js';
