/**
 * @nachos/sdk - Plugin Manifest
 *
 * Defines the NachosPluginManifest type that describes a channel or tool's
 * capabilities, requirements, and metadata.
 *
 * Every channel and tool ships a `manifest.json` file that the platform reads
 * at startup to understand what the plugin needs (network access, secrets,
 * resources) and what it provides (a channel adapter or a tool).
 *
 * @example Channel manifest (manifest.json):
 * ```json
 * {
 *   "name": "nachos-channel-matrix",
 *   "version": "0.1.0",
 *   "type": "channel",
 *   "entry": "dist/main.js",
 *   "capabilities": {
 *     "network": {
 *       "egress": ["matrix.org"]
 *     },
 *     "secrets": ["MATRIX_HOMESERVER_URL", "MATRIX_ACCESS_TOKEN"]
 *   },
 *   "provides": {
 *     "channel": "matrix"
 *   }
 * }
 * ```
 *
 * @example Tool manifest (manifest.json):
 * ```json
 * {
 *   "name": "nachos-tool-image-gen",
 *   "version": "0.1.0",
 *   "type": "tool",
 *   "entry": "dist/index.js",
 *   "capabilities": {
 *     "network": {
 *       "egress": ["api.openai.com"]
 *     },
 *     "secrets": ["OPENAI_API_KEY"],
 *     "resources": {
 *       "memory": "512Mi",
 *       "cpus": 1
 *     }
 *   },
 *   "provides": {
 *     "tool": "image_gen",
 *     "securityTier": 1
 *   },
 *   "dependencies": ["@nachos/sdk", "@nachos/tool-base"],
 *   "configSchema": {
 *     "type": "object",
 *     "properties": {
 *       "default_size": {
 *         "type": "string",
 *         "description": "Default image size",
 *         "enum": ["256x256", "512x512", "1024x1024"]
 *       }
 *     }
 *   }
 * }
 * ```
 */

import type { SecurityTier } from './types.js';

/**
 * Network capability declaration.
 *
 * Specifies which external domains the plugin needs to reach.
 * The platform uses this to configure Docker network isolation --
 * plugins are only allowed to reach the domains they declare.
 */
export interface NetworkCapabilities {
  /**
   * External domains this plugin needs outbound access to.
   * Examples: ['slack.com'], ['api.telegram.org'], ['http', 'https'] (for broad access).
   * An empty array means no external network access is needed.
   */
  egress?: string[];
}

/**
 * Resource requirements for a plugin container.
 */
export interface ResourceCapabilities {
  /**
   * Maximum memory allocation.
   * Uses Kubernetes-style notation (e.g. '256Mi', '1Gi').
   */
  memory?: string;

  /**
   * Maximum CPU allocation.
   * Fractional values are allowed (e.g. 0.5 for half a CPU core).
   */
  cpus?: number;
}

/**
 * What a channel plugin provides.
 */
export interface ChannelProvides {
  /**
   * The channel identifier this plugin provides.
   * Must match the `channelId` in the channel adapter implementation.
   */
  channel: string;
}

/**
 * What a tool plugin provides.
 */
export interface ToolProvides {
  /**
   * The tool identifier this plugin provides.
   * Must match the `toolId` in the tool implementation.
   */
  tool: string;

  /**
   * Security tier for this tool (0-4).
   * Must match the `securityTier` in the tool implementation.
   */
  securityTier: SecurityTier;
}

/**
 * JSON Schema for the plugin's configuration section in nachos.toml.
 *
 * This schema is used for validation and documentation. It describes what
 * configuration options the plugin accepts under its section in nachos.toml.
 */
export interface PluginConfigSchema {
  type: 'object';
  properties?: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: unknown[];
      default?: unknown;
      [key: string]: unknown;
    }
  >;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Plugin manifest for a channel adapter.
 *
 * This is the contents of `manifest.json` for a channel plugin.
 */
export interface ChannelManifest {
  /** Package name (e.g. 'nachos-channel-matrix'). */
  name: string;

  /** Semantic version (e.g. '0.1.0'). */
  version: string;

  /** Must be 'channel' for channel plugins. */
  type: 'channel';

  /**
   * Entry point for the plugin (relative to package root).
   * This is the file that the platform will execute to start the channel.
   */
  entry?: string;

  /** Capability declarations. */
  capabilities: {
    /** Network access requirements. */
    network?: NetworkCapabilities;
    /** Environment variable names that should be injected as secrets. */
    secrets?: string[];
    /** Resource requirements. */
    resources?: ResourceCapabilities;
  };

  /** What this channel provides. */
  provides: ChannelProvides;

  /** NPM package dependencies required by this plugin. */
  dependencies?: string[];

  /**
   * JSON Schema for this plugin's configuration section in nachos.toml.
   * Enables validation of user-provided configuration.
   */
  configSchema?: PluginConfigSchema;
}

/**
 * Plugin manifest for a tool container.
 *
 * This is the contents of `manifest.json` for a tool plugin.
 */
export interface ToolManifest {
  /** Package name (e.g. 'nachos-tool-image-gen'). */
  name: string;

  /** Semantic version (e.g. '0.1.0'). */
  version: string;

  /** Must be 'tool' for tool plugins. */
  type: 'tool';

  /**
   * Entry point for the plugin (relative to package root).
   * This is the file that the platform will execute to start the tool.
   */
  entry?: string;

  /** Capability declarations. */
  capabilities: {
    /** Network access requirements. */
    network?: NetworkCapabilities;
    /** Environment variable names that should be injected as secrets. */
    secrets?: string[];
    /** Resource requirements. */
    resources?: ResourceCapabilities;
  };

  /** What this tool provides. */
  provides: ToolProvides;

  /** NPM package dependencies required by this plugin. */
  dependencies?: string[];

  /**
   * JSON Schema for this plugin's configuration section in nachos.toml.
   * Enables validation of user-provided configuration.
   */
  configSchema?: PluginConfigSchema;
}

/**
 * Union type for all plugin manifests.
 *
 * Use the `type` field to discriminate between channel and tool manifests.
 */
export type NachosPluginManifest = ChannelManifest | ToolManifest;
