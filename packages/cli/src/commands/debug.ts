/**
 * nachos debug command
 * Show debug information
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadAndValidateConfig } from '@nachos/config';
import {
  findConfigFileOrThrow,
  getProjectRoot,
  getConfigSearchPaths,
} from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { DockerClient } from '../core/docker-client.js';
import { getVersion } from '../cli.js';

interface DebugOptions {
  json?: boolean;
}

type DebugConfigInfo =
  | {
      error: string;
    }
  | {
      path: string;
      project_root: string;
      search_paths: string[];
      loaded: boolean;
      security_mode?: string;
      llm_provider?: string;
      compose_generated: boolean;
      compose_path?: string;
    };

type DebugDockerInfo =
  | {
      error: string;
    }
  | {
      available: boolean;
      compose_available: boolean;
      version?: string;
      compose_version?: string;
    };

interface DebugInfo {
  cli_version: string;
  node_version: string;
  platform: string;
  arch: string;
  cwd: string;
  config?: DebugConfigInfo;
  docker?: DebugDockerInfo;
  env?: Record<string, string>;
}

export async function debugCommand(options: DebugOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'debug', getVersion());

  try {
    const docker = new DockerClient();

    // Gather debug information
    const debugInfo: DebugInfo = {
      cli_version: getVersion(),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    };

    // Config discovery
    try {
      const configPath = findConfigFileOrThrow();
      const projectRoot = getProjectRoot();
      debugInfo.config = {
        path: configPath,
        project_root: projectRoot,
        search_paths: getConfigSearchPaths(),
        loaded: false,
        compose_generated: false,
      };

      // Load config
      const config = await loadAndValidateConfig({ configPath });
      if (!('error' in debugInfo.config)) {
        debugInfo.config.loaded = true;
        debugInfo.config.security_mode = config.security?.mode;
        debugInfo.config.llm_provider = config.llm?.provider;
      }

      // Check for generated compose file
      const composePath = join(projectRoot, 'docker-compose.generated.yml');
      if (!('error' in debugInfo.config)) {
        debugInfo.config.compose_generated = existsSync(composePath);
        if (existsSync(composePath)) {
          debugInfo.config.compose_path = composePath;
        }
      }
    } catch (error) {
      debugInfo.config = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Docker info
    try {
      debugInfo.docker = {
        available: await docker.isDockerAvailable(),
        compose_available: await docker.isComposeAvailable(),
      };

      if ('available' in debugInfo.docker && debugInfo.docker.available) {
        debugInfo.docker.version = await docker.getDockerVersion();
      }

      if ('compose_available' in debugInfo.docker && debugInfo.docker.compose_available) {
        debugInfo.docker.compose_version = await docker.getComposeVersion();
      }
    } catch (error) {
      debugInfo.docker = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Environment variables (filtered)
    const envVars = ['NACHOS_CONFIG_PATH', 'NODE_ENV', 'DEBUG'];
    debugInfo.env = {};
    for (const key of envVars) {
      if (process.env[key]) {
        debugInfo.env[key] = process.env[key] ?? '';
      }
    }

    // Display results
    if (options.json) {
      output.success(debugInfo);
    } else {
      prettyOutput.brandedHeader('Nachos Debug Information');
      prettyOutput.blank();

      // CLI info
      prettyOutput.header('CLI:');
      prettyOutput.keyValue('Version', debugInfo.cli_version);
      prettyOutput.keyValue('Node.js', debugInfo.node_version);
      prettyOutput.keyValue('Platform', `${debugInfo.platform} (${debugInfo.arch})`);
      prettyOutput.keyValue('Working Directory', debugInfo.cwd);
      prettyOutput.blank();

      // Config info
      prettyOutput.header('Configuration:');
      if (debugInfo.config && 'error' in debugInfo.config) {
        prettyOutput.warn(`Error: ${debugInfo.config.error}`);
      } else if (debugInfo.config) {
        prettyOutput.keyValue('Config Path', debugInfo.config.path);
        prettyOutput.keyValue('Project Root', debugInfo.config.project_root);
        prettyOutput.keyValue('Security Mode', debugInfo.config.security_mode || 'N/A');
        prettyOutput.keyValue('LLM Provider', debugInfo.config.llm_provider || 'N/A');
        prettyOutput.keyValue(
          'Compose Generated',
          debugInfo.config.compose_generated ? 'Yes' : 'No'
        );
      }
      prettyOutput.blank();

      // Docker info
      prettyOutput.header('Docker:');
      if (debugInfo.docker && 'error' in debugInfo.docker) {
        prettyOutput.warn(`Error: ${debugInfo.docker.error}`);
      } else if (debugInfo.docker) {
        const dockerVersion = debugInfo.docker.available
          ? (debugInfo.docker.version ?? 'Unknown')
          : 'Not available';
        const composeVersion = debugInfo.docker.compose_available
          ? (debugInfo.docker.compose_version ?? 'Unknown')
          : 'Not available';

        prettyOutput.keyValue('Docker', dockerVersion);
        prettyOutput.keyValue('Compose', composeVersion);
      }
      prettyOutput.blank();

      // Environment
      if (debugInfo.env && Object.keys(debugInfo.env).length > 0) {
        prettyOutput.header('Environment:');
        for (const [key, value] of Object.entries(debugInfo.env)) {
          prettyOutput.keyValue(key, value as string);
        }
        prettyOutput.blank();
      }
    }
  } catch (error) {
    output.error(error as Error);
  }
}
