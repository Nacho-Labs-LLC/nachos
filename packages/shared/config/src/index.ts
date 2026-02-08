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
  WebchatChannelConfig,
  SlackChannelConfig,
  DiscordChannelConfig,
  TelegramChannelConfig,
  WhatsappChannelConfig,
  ChannelDMConfig,
  ChannelServerConfig,
  ToolsConfig,
  FilesystemToolConfig,
  BrowserToolConfig,
  CodeRunnerToolConfig,
  ShellToolConfig,
  WebSearchToolConfig,
  SecurityConfig,
  DLPConfig,
  RateLimitsConfig,
  AuditConfig,
  RuntimeConfig,
  ResourcesConfig,
  StateStoreFilesystemConfig,
  StateStorePostgresConfig,
  StateStoreConfig,
  SessionStateConfig,
  PromptReportConfig,
  StateLayerConfig,
  SubagentSandboxDockerConfig,
  SubagentSandboxConfig,
  SubagentConfig,
  AssistantConfig,
  SkillsConfig,
  MemoryFlushConfig,
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

// Export environment overlay functions
export { createEnvOverlay, applyEnvOverlay } from './env.js';

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

// Main convenience function that loads, overlays, and validates config
export { loadAndValidateConfig } from './main.js';
