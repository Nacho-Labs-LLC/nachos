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
  ChannelsConfig,
  WebchatChannelConfig,
  SlackChannelConfig,
  DiscordChannelConfig,
  TelegramChannelConfig,
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
  AssistantConfig,
  SkillsConfig,
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
