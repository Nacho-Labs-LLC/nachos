/**
 * nachos add tool command
 * Add a tool configuration stub to nachos.toml
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';

interface AddToolOptions {
  json?: boolean;
}

const VALID_TOOLS = ['filesystem', 'browser', 'code_runner', 'shell', 'web_search'];

// Tool configuration stubs (as objects)
const TOOL_STUBS: Record<string, any> = {
  filesystem: {
    enabled: false,
    paths: ['./workspace'],
    write: true,
    max_file_size: '10MB',
  },
  browser: {
    enabled: false,
    allowed_domains: [],
    headless: true,
    timeout: 30,
  },
  code_runner: {
    enabled: false,
    runtime: 'sandboxed',
    languages: ['python', 'javascript'],
    timeout: 30,
    max_memory: '512MB',
  },
  shell: {
    enabled: false,
  },
  web_search: {
    enabled: false,
  },
};

export async function addToolCommand(name: string, options: AddToolOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'add tool', getVersion());

  // Find config file first (needs to be in scope for error handler)
  const configPath = findConfigFileOrThrow();

  try {
    // Validate tool name
    if (!VALID_TOOLS.includes(name)) {
      throw new CLIError(
        `Unknown tool: ${name}`,
        'UNKNOWN_TOOL',
        1,
        `Valid tools: ${VALID_TOOLS.join(', ')}`
      );
    }
    const configContent = readFileSync(configPath, 'utf-8');

    // Parse TOML
    const config = TOML.parse(configContent) as any;

    // Check if tool already exists
    if (config.tools && config.tools[name]) {
      throw new CLIError(
        `Tool ${name} is already configured`,
        'TOOL_EXISTS',
        1,
        `Edit the existing [tools.${name}] section in ${configPath}`
      );
    }

    // Add tool stub
    if (!config.tools) {
      config.tools = {};
    }
    config.tools[name] = TOOL_STUBS[name];

    // Write back to file
    const newContent = TOML.stringify(config);
    writeFileSync(configPath, newContent, 'utf-8');

    // Display results
    if (options.json) {
      output.success({
        tool: name,
        config_path: configPath,
      });
    } else {
      prettyOutput.success(`Added ${name} tool configuration`);
      prettyOutput.blank();
      prettyOutput.info('Next steps:');
      prettyOutput.indent(`1. Edit ${configPath}`);
      prettyOutput.indent(`2. Set enabled = true`);
      prettyOutput.indent(`3. Configure tool-specific settings`);
      prettyOutput.indent('4. Run "nachos restart"');
      prettyOutput.blank();
    }
  } catch (error) {
    // Handle TOML parse errors specifically
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
