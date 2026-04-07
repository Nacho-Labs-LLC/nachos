/**
 * nachos plugin add command
 * Register a plugin from a local path, npm package, or Docker image
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow, getProjectRoot } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';

export interface PluginAddOptions {
  json?: boolean;
  sourceType?: string;
  name?: string;
  enable?: boolean;
  dryRun?: boolean;
}

/** Plugin manifest as declared in nachos-plugin.json */
interface PluginManifest {
  name: string;
  version: string;
  type: 'channel' | 'tool';
  capabilities: {
    network?: {
      egress?: string[];
      ports?: number[];
    };
    secrets?: string[];
    volumes?: string[];
    permissions?: string[];
  };
  provides: {
    channel?: string;
    tool?: string;
    securityTier?: number;
  };
  entry: {
    dockerfile: string;
    context: string;
  };
  configSchema?: Record<string, unknown>;
  configDefaults?: Record<string, unknown>;
  securityTier?: number;
  dependencies?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period?: string;
  };
  nachos?: {
    minVersion?: string;
    apiVersion: string;
  };
}

type SourceType = 'path' | 'npm' | 'image';

type TomlConfig = TOML.JsonMap & {
  plugins?: TOML.JsonMap;
  channels?: TOML.JsonMap;
  tools?: TOML.JsonMap;
};

/** Built-in channel names that cannot be used as plugin names */
const BUILTIN_CHANNELS = ['webchat', 'slack', 'discord', 'telegram', 'whatsapp', 'matrix'];

/** Built-in tool names that cannot be used as plugin names */
const BUILTIN_TOOLS = [
  'filesystem',
  'browser',
  'code_runner',
  'shell',
  'web_search',
  'web_fetch',
  'bootstrap',
  'github',
  'bitbucket',
  'composio',
];

/**
 * Auto-detect source type from the argument string.
 *
 * | Input pattern                                         | Detected type |
 * |-------------------------------------------------------|---------------|
 * | Starts with `.`, `/`, `~`, or is an existing directory | path          |
 * | Contains `:` and `/` (e.g., ghcr.io/org/image:tag)   | image         |
 * | Everything else                                        | npm           |
 */
function detectSourceType(source: string): SourceType {
  // Existing local directory or relative/absolute path indicators
  if (
    source.startsWith('.') ||
    source.startsWith('/') ||
    source.startsWith('~') ||
    existsSync(resolve(source))
  ) {
    return 'path';
  }

  // Docker image pattern: contains both : and / (e.g., ghcr.io/org/tool:tag)
  if (source.includes(':') && source.includes('/')) {
    return 'image';
  }

  // Default to npm
  return 'npm';
}

/**
 * Validate a plugin manifest against the required schema.
 * Throws CLIError with specific details on any validation failure.
 */
function validateManifest(manifest: Record<string, unknown>, manifestPath: string): PluginManifest {
  const errors: string[] = [];

  // name: required, must match pattern
  if (typeof manifest.name !== 'string' || !manifest.name) {
    errors.push('Missing required field: name');
  } else if (!/^[a-z0-9-]+$/.test(manifest.name)) {
    errors.push(`Invalid name "${manifest.name}": must match ^[a-z0-9-]+$`);
  } else if (manifest.name.length > 64) {
    errors.push(`Name too long (${manifest.name.length} chars): max 64 characters`);
  }

  // version: required, basic semver check
  if (typeof manifest.version !== 'string' || !manifest.version) {
    errors.push('Missing required field: version');
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`Invalid version "${manifest.version}": must be valid semver (e.g., 1.0.0)`);
  }

  // type: required, must be channel or tool
  if (manifest.type !== 'channel' && manifest.type !== 'tool') {
    errors.push(`Invalid type "${String(manifest.type)}": must be "channel" or "tool"`);
  }

  // capabilities: validate known keys only
  if (manifest.capabilities !== undefined) {
    if (typeof manifest.capabilities !== 'object' || manifest.capabilities === null) {
      errors.push('capabilities must be an object');
    } else {
      const caps = manifest.capabilities as Record<string, unknown>;
      const allowedCapKeys = ['network', 'secrets', 'volumes', 'permissions'];
      for (const key of Object.keys(caps)) {
        if (!allowedCapKeys.includes(key)) {
          errors.push(`Unknown capability "${key}": allowed keys are ${allowedCapKeys.join(', ')}`);
        }
      }

      // Validate secrets naming
      if (Array.isArray(caps.secrets)) {
        for (const secret of caps.secrets) {
          if (typeof secret !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(secret)) {
            errors.push(`Invalid secret name "${String(secret)}": must match ^[A-Z_][A-Z0-9_]*$`);
          }
        }
      }
    }
  }

  // entry: required with dockerfile
  if (!manifest.entry || typeof manifest.entry !== 'object') {
    errors.push('Missing required field: entry (must contain dockerfile)');
  } else {
    const entry = manifest.entry as Record<string, unknown>;
    if (typeof entry.dockerfile !== 'string') {
      errors.push('Missing required field: entry.dockerfile');
    }
  }

  // securityTier: optional, 0-3
  if (manifest.securityTier !== undefined) {
    if (
      typeof manifest.securityTier !== 'number' ||
      manifest.securityTier < 0 ||
      manifest.securityTier > 3
    ) {
      errors.push(`Invalid securityTier "${String(manifest.securityTier)}": must be 0-3`);
    }
  }

  // nachos.apiVersion: required if nachos is present
  if (manifest.nachos !== undefined) {
    if (typeof manifest.nachos !== 'object' || manifest.nachos === null) {
      errors.push('nachos field must be an object');
    } else {
      const nachos = manifest.nachos as Record<string, unknown>;
      if (nachos.apiVersion !== '1') {
        errors.push(`Unsupported nachos.apiVersion "${String(nachos.apiVersion)}": must be "1"`);
      }
    }
  }

  if (errors.length > 0) {
    throw new CLIError(
      `Plugin manifest validation failed`,
      'PLUGIN_MANIFEST_INVALID',
      1,
      `${manifestPath}:\n  - ${errors.join('\n  - ')}`
    );
  }

  return manifest as unknown as PluginManifest;
}

/**
 * Read and parse nachos-plugin.json from a resolved path
 */
function readManifest(manifestPath: string): PluginManifest {
  if (!existsSync(manifestPath)) {
    throw new CLIError(
      `No nachos-plugin.json found at ${manifestPath}`,
      'PLUGIN_MANIFEST_NOT_FOUND',
      1,
      'Ensure the plugin directory contains a valid nachos-plugin.json manifest.'
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    throw new CLIError(
      `Failed to parse ${manifestPath}`,
      'PLUGIN_MANIFEST_INVALID',
      1,
      'Ensure the file contains valid JSON.'
    );
  }

  return validateManifest(raw, manifestPath);
}

/**
 * Determine the provides key (the config section name) from the manifest
 */
function getProviderKey(manifest: PluginManifest): string {
  if (manifest.type === 'channel' && manifest.provides.channel) {
    return manifest.provides.channel;
  }
  if (manifest.type === 'tool' && manifest.provides.tool) {
    return manifest.provides.tool;
  }
  // Fallback: derive from the manifest name by stripping nachos-channel-/nachos-tool- prefix
  const stripped = manifest.name.replace(/^nachos-channel-/, '').replace(/^nachos-tool-/, '');
  return stripped;
}

export async function pluginAddCommand(source: string, options: PluginAddOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'plugin add', getVersion());

  const configPath = findConfigFileOrThrow();
  const projectRoot = getProjectRoot();

  try {
    // 1. Determine source type
    const sourceType: SourceType = (options.sourceType as SourceType) ?? detectSourceType(source);

    if (!['path', 'npm', 'image'].includes(sourceType)) {
      throw new CLIError(
        `Invalid source type: ${sourceType}`,
        'INVALID_ARGUMENT',
        1,
        'Valid source types: path, npm, image'
      );
    }

    // 2. Resolve manifest path based on source type
    let manifest: PluginManifest;
    let resolvedPath: string;

    switch (sourceType) {
      case 'path': {
        resolvedPath = resolve(projectRoot, source);
        const manifestPath = join(resolvedPath, 'nachos-plugin.json');
        manifest = readManifest(manifestPath);
        break;
      }
      case 'npm': {
        // For now, check if the package exists in node_modules at the project root
        const modulePath = join(projectRoot, 'node_modules', source);
        if (!existsSync(modulePath)) {
          throw new CLIError(
            `npm package "${source}" not found in node_modules`,
            'PLUGIN_NPM_INSTALL_FAILED',
            1,
            `Run "npm install --save-dev ${source}" first, then retry "nachos plugin add ${source}"`
          );
        }
        resolvedPath = modulePath;
        const manifestPath = join(modulePath, 'nachos-plugin.json');
        manifest = readManifest(manifestPath);
        break;
      }
      case 'image': {
        // Image source requires a --name and a local manifest path
        // For now, we create a stub entry and warn the user to provide a manifest
        throw new CLIError(
          'Image-source plugins require a local manifest file',
          'PLUGIN_MANIFEST_NOT_FOUND',
          1,
          `Create a local nachos-plugin.json for the image and use:\n  nachos plugin add ${source} --source-type image\n\nImage source support will be expanded in a future release.`
        );
      }
      default: {
        throw new CLIError(
          `Unsupported source type: ${sourceType}`,
          'INVALID_ARGUMENT',
          1,
          'Valid source types: path, npm, image'
        );
      }
    }

    // 3. Determine plugin name (from --name flag or manifest)
    const pluginName = options.name ?? manifest.name;
    const providerKey = getProviderKey(manifest);

    // 4. Check for name conflicts with built-in modules
    if (manifest.type === 'channel' && BUILTIN_CHANNELS.includes(providerKey)) {
      throw new CLIError(
        `Plugin name "${providerKey}" conflicts with built-in channel`,
        'PLUGIN_NAME_CONFLICT',
        1,
        'Use a different name in the "provides.channel" field of nachos-plugin.json.'
      );
    }
    if (manifest.type === 'tool' && BUILTIN_TOOLS.includes(providerKey)) {
      throw new CLIError(
        `Plugin name "${providerKey}" conflicts with built-in tool`,
        'PLUGIN_NAME_CONFLICT',
        1,
        'Use a different name in the "provides.tool" field of nachos-plugin.json.'
      );
    }

    // 5. Read and parse nachos.toml
    const configContent = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(configContent) as TomlConfig;

    // Initialize plugins section
    if (!config.plugins) {
      config.plugins = {} as TOML.JsonMap;
    }
    const plugins = config.plugins as TOML.JsonMap;

    // Check for duplicate plugin
    if (plugins[pluginName] && !options.dryRun) {
      throw new CLIError(
        `Plugin "${pluginName}" is already registered`,
        'PLUGIN_DUPLICATE',
        1,
        `Remove it first with "nachos plugin remove ${pluginName}" or use a different --name.`
      );
    }

    // 6. Build the plugin entry for nachos.toml
    const pluginEntry: TOML.JsonMap = { source: sourceType };

    switch (sourceType) {
      case 'path': {
        // Store relative path from project root
        const relativePath =
          source.startsWith('.') || source.startsWith('/') || source.startsWith('~')
            ? source
            : `./${source}`;
        pluginEntry.path = relativePath;
        break;
      }
      case 'npm': {
        pluginEntry.package = source;
        if (manifest.version) {
          pluginEntry.version = `^${manifest.version}`;
        }
        break;
      }
    }

    // 7. Build default config for channels.* or tools.* section
    const configSection = manifest.type === 'channel' ? 'channels' : 'tools';
    if (!config[configSection]) {
      config[configSection] = {} as TOML.JsonMap;
    }
    const sectionMap = config[configSection] as TOML.JsonMap;

    const pluginConfig: TOML.JsonMap = {
      enabled: options.enable ?? false,
      ...((manifest.configDefaults as TOML.JsonMap) ?? {}),
    };

    if (options.enable) {
      pluginConfig.enabled = true;
    }

    // Dry run: show what would happen
    if (options.dryRun) {
      if (options.json) {
        output.success({
          dry_run: true,
          plugin_name: pluginName,
          provider_key: providerKey,
          source_type: sourceType,
          source,
          manifest: {
            name: manifest.name,
            version: manifest.version,
            type: manifest.type,
            securityTier: manifest.securityTier ?? 2,
          },
          would_add: {
            plugins: { [pluginName]: pluginEntry },
            [configSection]: { [providerKey]: pluginConfig },
          },
          config_path: configPath,
        });
      } else {
        prettyOutput.brandedHeader('Plugin Add (dry run)');
        prettyOutput.blank();
        prettyOutput.keyValue('Plugin', pluginName);
        prettyOutput.keyValue('Type', manifest.type);
        prettyOutput.keyValue('Version', manifest.version);
        prettyOutput.keyValue('Source', `${sourceType} (${source})`);
        prettyOutput.keyValue('Security Tier', String(manifest.securityTier ?? 2));
        prettyOutput.blank();
        prettyOutput.info(`Would add [plugins.${pluginName}] to nachos.toml`);
        prettyOutput.info(`Would add [${configSection}.${providerKey}] to nachos.toml`);
        prettyOutput.blank();
      }
      return;
    }

    // 8. Write changes to nachos.toml
    plugins[pluginName] = pluginEntry;
    config.plugins = plugins;

    sectionMap[providerKey] = pluginConfig;
    config[configSection] = sectionMap;

    const newContent = TOML.stringify(config as TOML.JsonMap);
    writeFileSync(configPath, newContent, 'utf-8');

    // 9. Display results
    if (options.json) {
      output.success({
        plugin_name: pluginName,
        provider_key: providerKey,
        source_type: sourceType,
        source,
        manifest: {
          name: manifest.name,
          version: manifest.version,
          type: manifest.type,
          securityTier: manifest.securityTier ?? 2,
        },
        config_path: configPath,
        enabled: options.enable ?? false,
      });
    } else {
      prettyOutput.brandedHeader('Plugin Added');
      prettyOutput.blank();
      prettyOutput.keyValue('Plugin', pluginName);
      prettyOutput.keyValue('Type', manifest.type);
      prettyOutput.keyValue('Version', manifest.version);
      prettyOutput.keyValue('Source', `${sourceType} (${source})`);
      prettyOutput.keyValue('Security Tier', String(manifest.securityTier ?? 2));
      prettyOutput.blank();
      prettyOutput.success(`Registered plugin "${pluginName}"`);

      // Print required secrets if any
      if (manifest.capabilities.secrets && manifest.capabilities.secrets.length > 0) {
        prettyOutput.blank();
        prettyOutput.header('Required secrets (add to .env):');
        for (const secret of manifest.capabilities.secrets) {
          prettyOutput.indent(`${secret}=`, 2);
        }
      }

      prettyOutput.blank();
      prettyOutput.header('Next steps:');
      if (!options.enable) {
        prettyOutput.indent(
          `1. Enable the plugin: set enabled = true in [${configSection}.${providerKey}]`
        );
        prettyOutput.indent('2. Add required secrets to .env');
        prettyOutput.indent('3. Run "nachos restart" to apply');
      } else {
        prettyOutput.indent('1. Add required secrets to .env');
        prettyOutput.indent('2. Run "nachos restart" to apply');
      }
      prettyOutput.blank();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('TOML')) {
      output.error(
        new CLIError(
          'Invalid TOML in configuration file',
          'INVALID_TOML',
          2,
          `Fix syntax errors in ${configPath}`
        )
      );
    } else {
      output.error(error as Error);
    }
  }
}
