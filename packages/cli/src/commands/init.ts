/**
 * nachos init command
 * Initialize a new Nachos project
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import ora from 'ora';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';
import { CLIError } from '../core/errors.js';
import type { InitOptions } from '../core/types.js';

interface InitCommandOptions {
  json?: boolean;
  defaults?: boolean;
  force?: boolean;
}

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'init', getVersion());

  try {
    const cwd = process.cwd();
    const configPath = join(cwd, 'nachos.toml');

    // Check if config already exists
    if (existsSync(configPath) && !options.force) {
      throw new CLIError(
        'nachos.toml already exists',
        'CONFIG_EXISTS',
        1,
        'Use --force to overwrite existing configuration'
      );
    }

    if (!options.json) {
      prettyOutput.brandedHeader('Initialize Nachos Project');
      prettyOutput.blank();
    }

    let initOptions: InitOptions;

    // Get configuration options
    if (options.defaults) {
      initOptions = getDefaultOptions();
    } else {
      initOptions = await promptForOptions();
    }

    // Create project structure
    const spinner = !options.json ? ora('Creating project structure...').start() : null;

    // Create directories
    mkdirSync(join(cwd, 'policies'), { recursive: true });
    mkdirSync(join(cwd, 'workspace'), { recursive: true });
    mkdirSync(join(cwd, 'data', 'gateway'), { recursive: true });
    mkdirSync(join(cwd, 'state'), { recursive: true });

    // Create nachos.toml
    const configContent = generateConfig(initOptions);
    writeFileSync(configPath, configContent, 'utf-8');

    // Create .env
    const envContent = generateEnv(initOptions);
    writeFileSync(join(cwd, '.env'), envContent, 'utf-8');

    // Create policy files
    const policyContent = generatePolicy(initOptions.securityMode);
    writeFileSync(
      join(cwd, 'policies', `${initOptions.securityMode}.yaml`),
      policyContent,
      'utf-8'
    );

    // Create .gitignore if it doesn't exist
    if (!existsSync(join(cwd, '.gitignore'))) {
      const gitignoreContent = generateGitignore();
      writeFileSync(join(cwd, '.gitignore'), gitignoreContent, 'utf-8');
    }

    spinner?.succeed('Project structure created');

    // Display results
    if (options.json) {
      output.success({
        project_name: initOptions.name,
        config_path: configPath,
        provider: initOptions.provider,
        security_mode: initOptions.securityMode,
        webchat_enabled: initOptions.enableWebchat,
      });
    } else {
      prettyOutput.blank();
      prettyOutput.success('Nachos project initialized!');
      prettyOutput.blank();

      prettyOutput.header('Created:');
      prettyOutput.indent('nachos.toml    - Main configuration');
      prettyOutput.indent('.env           - Environment variables');
      prettyOutput.indent('policies/      - Security policies');
      prettyOutput.indent('workspace/     - Tool workspace directory');
      prettyOutput.indent('data/          - Service data (Docker volumes)');
      prettyOutput.indent('state/         - Application state (logs, etc.)');
      prettyOutput.blank();

      prettyOutput.header('Next steps:');
      prettyOutput.indent('1. Edit .env and add your API keys:');
      if (initOptions.provider === 'anthropic') {
        prettyOutput.indent('   ANTHROPIC_API_KEY=sk-ant-...');
      } else if (initOptions.provider === 'openai') {
        prettyOutput.indent('   OPENAI_API_KEY=sk-...');
      }
      prettyOutput.indent('2. Review and customize nachos.toml');
      prettyOutput.indent('3. Review security policies in policies/');
      prettyOutput.indent('4. Run: nachos up');
      prettyOutput.blank();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

/**
 * Get default options
 */
function getDefaultOptions(): InitOptions {
  return {
    name: 'my-nachos-project',
    provider: 'anthropic',
    securityMode: 'standard',
    enableWebchat: true,
  };
}

/**
 * Prompt user for options
 */
async function promptForOptions(): Promise<InitOptions> {
  const response = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Project name:',
      initial: 'my-nachos-project',
    },
    {
      type: 'select',
      name: 'provider',
      message: 'LLM provider:',
      choices: [
        { title: 'Anthropic (Claude)', value: 'anthropic' },
        { title: 'OpenAI (GPT)', value: 'openai' },
        { title: 'Ollama (Local)', value: 'ollama' },
      ],
      initial: 0,
    },
    {
      type: 'select',
      name: 'securityMode',
      message: 'Security mode:',
      choices: [
        { title: 'Standard (Recommended)', value: 'standard' },
        { title: 'Strict (Maximum security)', value: 'strict' },
        { title: 'Permissive (Development only)', value: 'permissive' },
      ],
      initial: 0,
    },
    {
      type: 'confirm',
      name: 'enableWebchat',
      message: 'Enable webchat interface?',
      initial: true,
    },
  ]);

  if (!response.name || !response.provider || !response.securityMode) {
    throw new CLIError('Initialization cancelled', 'INIT_CANCELLED', 1);
  }

  return response as InitOptions;
}

/**
 * Generate nachos.toml content
 */
function generateConfig(options: InitOptions): string {
  // Determine default model based on provider
  const defaultModel =
    options.provider === 'anthropic'
      ? 'claude-3-5-sonnet-20241022'
      : options.provider === 'openai'
        ? 'gpt-4o'
        : 'llama2';

  return `# Nachos Configuration
# Generated by nachos init

[nachos]
name = "${options.name}"
version = "0.0.1"

[llm]
provider = "${options.provider}"
model = "${defaultModel}"
# API keys should be set in .env:
# ${options.provider.toUpperCase()}_API_KEY=...

[security]
mode = "${options.securityMode}"

[security.rate_limits]
messages_per_minute = 30
tool_calls_per_minute = 15
llm_requests_per_minute = 30

[security.dlp]
enabled = true
action = "block"

[security.audit]
enabled = true
log_inputs = true
log_outputs = true
log_tool_calls = true

${
  options.enableWebchat
    ? `[channels.webchat]
enabled = true
port = 8080`
    : ''
}

# Add more channels:
# Run: nachos add channel <name>

# Add tools:
# Run: nachos add tool <name>
`;
}

/**
 * Generate .env content
 */
function generateEnv(options: InitOptions): string {
  const lines = [
    '# Nachos Environment Variables',
    '# DO NOT commit this file to version control',
    '',
  ];

  if (options.provider === 'anthropic') {
    lines.push('# Anthropic API Key');
    lines.push('ANTHROPIC_API_KEY=');
  } else if (options.provider === 'openai') {
    lines.push('# OpenAI API Key');
    lines.push('OPENAI_API_KEY=');
  } else if (options.provider === 'ollama') {
    lines.push('# Ollama is running locally, no API key needed');
    lines.push('# OLLAMA_URL=http://localhost:11434');
  }

  lines.push('');
  lines.push('# Security mode override (optional)');
  lines.push(`# SECURITY_MODE=${options.securityMode}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate policy YAML content
 */
function generatePolicy(mode: 'strict' | 'standard' | 'permissive'): string {
  if (mode === 'strict') {
    return `# Strict Security Policy
# Maximum security - explicit allowlists required

version: 1
name: strict
description: Maximum security policy with explicit allowlists

# Tool access (all disabled by default)
tools:
  filesystem:
    enabled: false
  browser:
    enabled: false
  code_runner:
    enabled: false
  shell:
    enabled: false
  web_search:
    enabled: false

# Rate limits
rate_limits:
  messages_per_minute: 10
  tool_calls_per_minute: 5
  llm_requests_per_minute: 10
`;
  }

  if (mode === 'permissive') {
    return `# Permissive Security Policy
# ⚠️  FOR DEVELOPMENT ONLY - NOT FOR PRODUCTION

version: 1
name: permissive
description: Permissive policy for development (NOT for production)

# Tool access (all enabled)
tools:
  filesystem:
    enabled: true
    allowed_paths: ["./workspace"]
  browser:
    enabled: true
  code_runner:
    enabled: true
  shell:
    enabled: true
  web_search:
    enabled: true

# Relaxed rate limits
rate_limits:
  messages_per_minute: 100
  tool_calls_per_minute: 50
  llm_requests_per_minute: 100
`;
  }

  // Standard mode (default)
  return `# Standard Security Policy
# Balanced security for production use

version: 1
name: standard
description: Standard security policy with reasonable defaults

# Tool access
tools:
  filesystem:
    enabled: true
    allowed_paths: ["./workspace"]
    max_file_size_mb: 10
  browser:
    enabled: true
    allowed_domains: []  # Empty = all domains allowed
  code_runner:
    enabled: false  # Disabled by default for security
  shell:
    enabled: false  # Disabled by default for security
  web_search:
    enabled: true

# Rate limits
rate_limits:
  messages_per_minute: 30
  tool_calls_per_minute: 15
  llm_requests_per_minute: 30
`;
}

/**
 * Generate .gitignore content
 */
function generateGitignore(): string {
  return `.env
.env.local
state/
data/
workspace/
*.log
docker-compose.generated.yml
node_modules/
.DS_Store
`;
}
