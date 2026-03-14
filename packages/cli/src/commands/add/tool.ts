/**
 * nachos add tool command
 * Guided tool setup with idempotent config writes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import prompts from 'prompts';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';
import { isInteractive } from '../../core/prompt.js';

export interface AddToolOptions {
  json?: boolean;
  enabled?: boolean;
  paths?: string;
  timeout?: string;
  languages?: string;
  memory?: string;
  domains?: string;
}

const VALID_TOOLS = [
  'filesystem',
  'browser',
  'code_runner',
  'shell',
  'web_search',
  'bootstrap',
  'claude_code_mcp',
] as const;

type ToolName = (typeof VALID_TOOLS)[number];

const isValidTool = (value: string): value is ToolName =>
  (VALID_TOOLS as readonly string[]).includes(value);

type TomlConfig = TOML.JsonMap & {
  tools?: TOML.JsonMap;
};

/**
 * Build tool config from interactive prompts
 */
async function promptToolConfig(name: ToolName): Promise<TOML.JsonMap> {
  const config: TOML.JsonMap = { enabled: true };

  switch (name) {
    case 'filesystem': {
      const pathResponse = await prompts({
        type: 'text',
        name: 'paths',
        message: 'Allowed paths (comma-separated):',
        initial: './workspace',
      });
      config.paths = (pathResponse.paths ?? './workspace').split(',').map((p: string) => p.trim());

      const writeResponse = await prompts({
        type: 'confirm',
        name: 'write',
        message: 'Allow write access?',
        initial: true,
      });
      config.write = writeResponse.write ?? true;

      const sizeResponse = await prompts({
        type: 'text',
        name: 'max_file_size',
        message: 'Max file size:',
        initial: '10MB',
      });
      config.max_file_size = sizeResponse.max_file_size ?? '10MB';
      break;
    }

    case 'browser': {
      const domainResponse = await prompts({
        type: 'text',
        name: 'domains',
        message: 'Restrict to domains (comma-separated, empty for all):',
        initial: '',
      });
      const domains = domainResponse.domains?.trim();
      config.allowed_domains = domains ? domains.split(',').map((d: string) => d.trim()) : [];
      config.headless = true;

      const timeoutResponse = await prompts({
        type: 'number',
        name: 'timeout',
        message: 'Page timeout (seconds):',
        initial: 30,
      });
      config.timeout = timeoutResponse.timeout ?? 30;
      break;
    }

    case 'code_runner': {
      const langResponse = await prompts({
        type: 'text',
        name: 'languages',
        message: 'Enabled languages (comma-separated):',
        initial: 'python, javascript',
      });
      config.languages = (langResponse.languages ?? 'python, javascript')
        .split(',')
        .map((l: string) => l.trim());
      config.runtime = 'sandboxed';

      const timeoutResponse = await prompts({
        type: 'number',
        name: 'timeout',
        message: 'Execution timeout (seconds):',
        initial: 30,
      });
      config.timeout = timeoutResponse.timeout ?? 30;

      const memResponse = await prompts({
        type: 'text',
        name: 'max_memory',
        message: 'Max memory:',
        initial: '512MB',
      });
      config.max_memory = memResponse.max_memory ?? '512MB';
      break;
    }

    case 'claude_code_mcp': {
      config.max_prompt_length = 4000;
      break;
    }

    // Shell, web_search: minimal config
    default:
      break;
  }

  return config;
}

/**
 * Build tool config from CLI flags (non-interactive / agent mode)
 */
function buildConfigFromFlags(name: ToolName, options: AddToolOptions): TOML.JsonMap {
  const enabled = options.enabled !== false;
  const config: TOML.JsonMap = { enabled };

  switch (name) {
    case 'filesystem':
      config.paths = options.paths
        ? options.paths.split(',').map((p) => p.trim())
        : ['./workspace'];
      config.write = true;
      config.max_file_size = '10MB';
      break;
    case 'browser':
      config.allowed_domains = options.domains
        ? options.domains.split(',').map((d) => d.trim())
        : [];
      config.headless = true;
      config.timeout = options.timeout ? parseInt(options.timeout, 10) : 30;
      break;
    case 'code_runner':
      config.languages = options.languages
        ? options.languages.split(',').map((l) => l.trim())
        : ['python', 'javascript'];
      config.runtime = 'sandboxed';
      config.timeout = options.timeout ? parseInt(options.timeout, 10) : 30;
      config.max_memory = options.memory ?? '512MB';
      break;
    case 'claude_code_mcp':
      config.max_prompt_length = 4000;
      break;
    default:
      break;
  }

  return config;
}

export async function addToolCommand(name: string, options: AddToolOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'add tool', getVersion());

  const configPath = findConfigFileOrThrow();

  try {
    // -----------------------------------------------------------------------
    // Input validation (#152): sanitize and validate tool name
    // -----------------------------------------------------------------------
    const sanitizedName = (name ?? '').trim();

    if (sanitizedName.length === 0) {
      throw new CLIError(
        'Tool name must not be empty',
        'INVALID_TOOL_NAME',
        1,
        `Valid tools: ${VALID_TOOLS.join(', ')}`
      );
    }

    if (sanitizedName.length > 64) {
      throw new CLIError(
        'Tool name is too long (max 64 characters)',
        'INVALID_TOOL_NAME',
        1
      );
    }

    // Only allow alphanumeric characters, hyphens, and underscores — no path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedName)) {
      throw new CLIError(
        `Invalid tool name: "${sanitizedName}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
        'INVALID_TOOL_NAME',
        1,
        `Valid tools: ${VALID_TOOLS.join(', ')}`
      );
    }

    // Validate tool name against known tools
    if (!isValidTool(sanitizedName)) {
      throw new CLIError(
        `Unknown tool: ${sanitizedName}`,
        'UNKNOWN_TOOL',
        1,
        `Valid tools: ${VALID_TOOLS.join(', ')}`
      );
    }

    // Reassign to validated name for the rest of the function
    const validatedName: ToolName = sanitizedName as ToolName;

    const configContent = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(configContent) as TomlConfig;

    // Initialize tools section
    const tools: TOML.JsonMap = {};
    if (config.tools && typeof config.tools === 'object') {
      Object.assign(tools, config.tools as TOML.JsonMap);
    }

    const isUpdate = !!tools[validatedName];

    // Build tool config: interactive or flag-based
    let toolConfig: TOML.JsonMap;

    if (isInteractive() && !options.json) {
      if (!options.json) {
        prettyOutput.brandedHeader(`${isUpdate ? 'Update' : 'Add'} ${validatedName} tool`);
        prettyOutput.blank();
      }

      toolConfig = await promptToolConfig(validatedName);
    } else {
      toolConfig = buildConfigFromFlags(validatedName, options);
    }

    // Idempotent merge: if tool exists, merge new values over existing
    if (isUpdate) {
      const existing = tools[validatedName] as TOML.JsonMap;
      tools[validatedName] = { ...existing, ...toolConfig };
    } else {
      tools[validatedName] = toolConfig;
    }

    config.tools = tools as TOML.JsonMap;

    // Write back to file
    const newContent = TOML.stringify(config as TOML.JsonMap);
    writeFileSync(configPath, newContent, 'utf-8');

    // Display results
    if (options.json) {
      output.success({
        tool: validatedName,
        action: isUpdate ? 'updated' : 'added',
        config_path: configPath,
        config: toolConfig,
      });
    } else {
      prettyOutput.blank();
      prettyOutput.success(`${isUpdate ? 'Updated' : 'Added'} ${validatedName} tool configuration`);
      prettyOutput.blank();
      prettyOutput.header('Next steps:');
      prettyOutput.indent('1. Review settings in nachos.toml');
      prettyOutput.indent('2. Run "nachos restart" to apply');
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
