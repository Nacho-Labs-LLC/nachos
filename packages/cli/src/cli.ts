/**
 * Main CLI program definition using Commander.js
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Get CLI version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

export function createProgram(): Command {
  const program = new Command();

  program
    .name('nachos')
    .description('🧀 Nachos - Modular agentic AI orchestration platform')
    .version(packageJson.version)
    .option('--json', 'Output results as JSON')
    .option('--verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('-c, --config <path>', 'Path to nachos.toml configuration file')
    .option('--no-input', 'Disable interactive prompts')
    .option('--no-color', 'Disable colored output')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts();

      // Mutual exclusion: --quiet and --verbose
      if (opts.quiet && opts.verbose) {
        console.error('Error: --quiet and --verbose cannot be used together');
        process.exit(2);
      }

      if (opts.verbose) {
        process.env.VERBOSE = '1';
      }
      if (opts.quiet) {
        process.env.NACHOS_QUIET = '1';
      }
      if (opts.noInput) {
        process.env.NACHOS_NO_INPUT = '1';
      }
      if (opts.noColor) {
        process.env.NO_COLOR = '1';
      }
      if (opts.config) {
        const resolved = resolve(opts.config);
        if (!existsSync(resolved)) {
          console.error(`Error: Config file not found: ${resolved}`);
          process.exit(2);
        }
        process.env.NACHOS_CONFIG_PATH = resolved;
      }
    });

  // Config subcommands
  const configCmd = program.command('config').description('Configuration management');

  configCmd
    .command('validate')
    .description('Validate nachos.toml configuration')
    .action(async () => {
      const { validateCommand } = await import('./commands/config/validate.js');
      await validateCommand(program.opts());
    });

  // Policy subcommands
  const policyCmd = program.command('policy').description('Policy management');

  policyCmd
    .command('validate')
    .description('Validate policy YAML files')
    .action(async () => {
      const { validateCommand } = await import('./commands/policy/validate.js');
      await validateCommand(program.opts());
    });

  // Add subcommands
  const addCmd = program.command('add').description('Add modules to configuration');

  addCmd
    .command('channel <name>')
    .description('Add and configure a channel')
    .option('--enabled', 'Enable the channel (default: true)')
    .option('--no-enabled', 'Add channel but leave it disabled')
    .option('--mode <mode>', 'Connection mode (slack: socket|http)')
    .option('--port <port>', 'Port number (webchat)')
    .action(async (name: string, options) => {
      const { addChannelCommand } = await import('./commands/add/channel.js');
      await addChannelCommand(name, { ...program.opts(), ...options });
    });

  addCmd
    .command('tool <name>')
    .description('Add and configure a tool')
    .option('--enabled', 'Enable the tool (default: true)')
    .option('--no-enabled', 'Add tool but leave it disabled')
    .option('--paths <paths>', 'Allowed paths, comma-separated (filesystem)')
    .option('--domains <domains>', 'Allowed domains, comma-separated (browser)')
    .option('--languages <langs>', 'Enabled languages, comma-separated (code_runner)')
    .option('--timeout <seconds>', 'Timeout in seconds (browser, code_runner)')
    .option('--memory <size>', 'Max memory (code_runner)')
    .action(async (name: string, options) => {
      const { addToolCommand } = await import('./commands/add/tool.js');
      await addToolCommand(name, { ...program.opts(), ...options });
    });

  // Subagent commands
  const subagentsCmd = program.command('subagents').description('Subagent management');

  subagentsCmd
    .command('spawn <task>')
    .description('Spawn a subagent run')
    .option('--label <label>', 'Optional run label')
    .option('--profile <profile>', 'Subagent tool profile to apply')
    .option('--agent-id <id>', 'Optional subagent ID override')
    .option('--model <model>', 'Optional model override')
    .option('--thinking <hint>', 'Optional thinking hint')
    .option('--timeout <seconds>', 'Run timeout in seconds')
    .option('--cleanup <mode>', 'Cleanup mode: delete or keep')
    .action(async (task: string, options) => {
      const { subagentsSpawnCommand } = await import('./commands/subagents.js');
      const parsed = options.timeout ? Number.parseInt(options.timeout, 10) : undefined;
      await subagentsSpawnCommand(task, {
        ...program.opts(),
        ...options,
        timeout: Number.isNaN(parsed) ? undefined : parsed,
      });
    });

  subagentsCmd
    .command('list')
    .description('List subagent runs')
    .option('--limit <count>', 'Limit number of runs')
    .action(async (options) => {
      const { subagentsListCommand } = await import('./commands/subagents.js');
      const parsed = options.limit ? Number.parseInt(options.limit, 10) : undefined;
      await subagentsListCommand({
        ...program.opts(),
        ...options,
        limit: Number.isNaN(parsed) ? undefined : parsed,
      });
    });

  subagentsCmd
    .command('info <runId>')
    .description('Show subagent run details')
    .action(async (runId: string) => {
      const { subagentsInfoCommand } = await import('./commands/subagents.js');
      await subagentsInfoCommand(runId, program.opts());
    });

  subagentsCmd
    .command('stop <runId>')
    .description('Stop a queued subagent run')
    .action(async (runId: string) => {
      const { subagentsStopCommand } = await import('./commands/subagents.js');
      await subagentsStopCommand(runId, program.opts());
    });

  subagentsCmd
    .command('log <runId>')
    .description('Show subagent run log')
    .option('--limit <count>', 'Limit number of messages')
    .action(async (runId: string, options) => {
      const { subagentsLogCommand } = await import('./commands/subagents.js');
      const parsed = options.limit ? Number.parseInt(options.limit, 10) : undefined;
      await subagentsLogCommand(runId, {
        ...program.opts(),
        ...options,
        limit: Number.isNaN(parsed) ? undefined : parsed,
      });
    });

  // Sandbox commands
  const sandboxCmd = program.command('sandbox').description('Sandbox management');

  sandboxCmd
    .command('explain')
    .description('Explain sandbox configuration')
    .action(async () => {
      const { sandboxExplainCommand } = await import('./commands/sandbox.js');
      await sandboxExplainCommand(program.opts());
    });

  sandboxCmd
    .command('list')
    .description('List sandbox status')
    .action(async () => {
      const { sandboxListCommand } = await import('./commands/sandbox.js');
      await sandboxListCommand(program.opts());
    });

  sandboxCmd
    .command('recreate')
    .description('Recreate sandbox configuration')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options) => {
      const { sandboxRecreateCommand } = await import('./commands/sandbox.js');
      await sandboxRecreateCommand({ ...program.opts(), ...options });
    });

  // Memory commands
  const memoryCmd = program.command('memory').description('Memory store operations');

  memoryCmd
    .command('query')
    .description('Query memory entries and facts')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .option('--kinds <kinds>', 'Comma-separated memory kinds')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--text <text>', 'Text search')
    .option('--limit <limit>', 'Limit results')
    .option('--offset <offset>', 'Offset results')
    .option('--user-id <id>', 'Optional user ID for audit context')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { memoryQueryCommand } = await import('./commands/memory.js');
      await memoryQueryCommand({ ...program.opts(), ...options });
    });

  memoryCmd
    .command('append-entry')
    .description('Append a memory entry')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--kind <kind>', 'Memory kind')
    .requiredOption('--content <text>', 'Memory content')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--confidence <score>', 'Confidence score (0-1)')
    .option('--expires-at <timestamp>', 'Expiration timestamp (ISO 8601)')
    .option('--source <source>', 'Provenance source label')
    .option('--provenance-file <path>', 'Path to provenance JSON')
    .option('--user-id <id>', 'Optional user ID for audit context')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { memoryAppendEntryCommand } = await import('./commands/memory.js');
      await memoryAppendEntryCommand({ ...program.opts(), ...options });
    });

  memoryCmd
    .command('append-fact')
    .description('Append a memory fact')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--subject <text>', 'Fact subject')
    .requiredOption('--predicate <text>', 'Fact predicate')
    .requiredOption('--object <text>', 'Fact object')
    .option('--confidence <score>', 'Confidence score (0-1)')
    .option('--source-entry-id <id>', 'Source entry ID')
    .option('--user-id <id>', 'Optional user ID for audit context')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { memoryAppendFactCommand } = await import('./commands/memory.js');
      await memoryAppendFactCommand({ ...program.opts(), ...options });
    });

  memoryCmd
    .command('delete')
    .description('Delete a memory entry')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--id <entryId>', 'Memory entry ID')
    .option('--user-id <id>', 'Optional user ID for audit context')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { memoryDeleteCommand } = await import('./commands/memory.js');
      await memoryDeleteCommand({ ...program.opts(), ...options });
    });

  // User profile commands
  const userProfileCmd = program.command('user-profile').description('User profile operations');

  userProfileCmd
    .command('get')
    .description('Fetch a user profile')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--user-id <id>', 'User ID')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { userProfileGetCommand } = await import('./commands/user-profile.js');
      await userProfileGetCommand({ ...program.opts(), ...options });
    });

  userProfileCmd
    .command('set')
    .description('Set a user profile')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--user-id <id>', 'User ID')
    .option('--profile <text>', 'Profile text')
    .option('--file <path>', 'Read profile text from file')
    .option('--source <source>', 'Profile source label')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { userProfileSetCommand } = await import('./commands/user-profile.js');
      await userProfileSetCommand({ ...program.opts(), ...options });
    });

  userProfileCmd
    .command('delete')
    .description('Delete a user profile')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--user-id <id>', 'User ID')
    .option('--session-id <id>', 'Optional session ID for audit context')
    .action(async (options) => {
      const { userProfileDeleteCommand } = await import('./commands/user-profile.js');
      await userProfileDeleteCommand({ ...program.opts(), ...options });
    });

  // Top-level commands
  program
    .command('init')
    .description('Initialize a new Nachos project')
    .option('--defaults', 'Use default values without prompts')
    .option('--force', 'Overwrite existing configuration')
    .action(async (options) => {
      const { initCommand } = await import('./commands/init.js');
      await initCommand({ ...program.opts(), ...options });
    });

  program
    .command('up')
    .description('Start the Nachos stack')
    .option('--build', 'Build images before starting')
    .option('--wait', 'Wait for services to be healthy')
    .option('--only <services>', 'Start only specified services (comma-separated)')
    .option('--timeout <seconds>', 'Health-check wait timeout in seconds', '60')
    .action(async (options) => {
      const { upCommand } = await import('./commands/up.js');
      await upCommand({ ...program.opts(), ...options });
    });

  program
    .command('down')
    .description('Stop the Nachos stack')
    .option('--volumes', 'Remove volumes')
    .option('--force', 'Skip confirmation when removing volumes')
    .action(async (options) => {
      const { downCommand } = await import('./commands/down.js');
      await downCommand({ ...program.opts(), ...options });
    });

  program
    .command('restart')
    .description('Restart the Nachos stack')
    .option('--build', 'Build images before starting')
    .option('--wait', 'Wait for services to be healthy')
    .action(async (options) => {
      const { restartCommand } = await import('./commands/restart.js');
      await restartCommand({ ...program.opts(), ...options });
    });

  program
    .command('logs')
    .description('View service logs')
    .argument('[service]', 'Service name (optional)')
    .option('-f, --follow', 'Follow log output')
    .option('--tail <lines>', 'Number of lines to show from the end', '50')
    .option('-t, --timestamps', 'Show timestamps')
    .action(async (service, options) => {
      const { logsCommand } = await import('./commands/logs.js');
      await logsCommand(service, { ...program.opts(), ...options });
    });

  program
    .command('status')
    .description('Show stack status')
    .action(async () => {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand(program.opts());
    });

  program
    .command('list')
    .description('List configured modules')
    .action(async () => {
      const { listCommand } = await import('./commands/list.js');
      await listCommand(program.opts());
    });

  program
    .command('doctor')
    .description('Run health checks')
    .action(async () => {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand(program.opts());
    });

  program
    .command('debug')
    .description('Show debug information')
    .action(async () => {
      const { debugCommand } = await import('./commands/debug.js');
      await debugCommand(program.opts());
    });

  program
    .command('remove <type> <name>')
    .description('Remove a module from configuration')
    .option('--force', 'Skip confirmation prompt')
    .option('--dry-run', 'Show what would be removed without changing anything')
    .action(async (type: string, name: string, options) => {
      const { removeCommand } = await import('./commands/remove.js');
      await removeCommand(type, name, { ...program.opts(), ...options });
    });

  program
    .command('completion <shell>')
    .description('Generate shell completion script (bash, zsh, fish, powershell)')
    .action(async (shell: string) => {
      const { completionCommand } = await import('./commands/completion.js');
      await completionCommand(shell, program, program.opts());
    });

  return program;
}

/**
 * Get CLI version
 */
export function getVersion(): string {
  return packageJson.version;
}
