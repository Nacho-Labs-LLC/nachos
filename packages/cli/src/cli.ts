/**
 * Main CLI program definition using Commander.js
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CLIError } from './core/errors.js';

// Get CLI version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const ROOT_HELP_EXAMPLES = `
Examples:
  nachos init
  nachos up --wait
  nachos status --json
  nachos logs gateway -f
  nachos config validate

Use "nachos <command> --help" for command-specific examples.
`;

const COMPLETION_HELP = `
Installation:
  # Bash (Linux)
  nachos completion bash | sudo tee /etc/bash_completion.d/nachos > /dev/null

  # Bash (macOS with Homebrew)
  nachos completion bash > "$(brew --prefix)/etc/bash_completion.d/nachos"

  # Zsh
  mkdir -p ~/.zsh/completion
  nachos completion zsh > ~/.zsh/completion/_nachos
  echo 'fpath=(~/.zsh/completion $fpath)' >> ~/.zshrc

  # Fish
  nachos completion fish > ~/.config/fish/completions/nachos.fish

  # PowerShell
  nachos completion powershell | Out-String | Invoke-Expression

Examples:
  nachos completion zsh > ~/.zsh/completion/_nachos
  nachos completion powershell | Out-String | Invoke-Expression
`;

export function parseTimeoutOption(timeout: string | undefined): number | undefined {
  if (!timeout) {
    return undefined;
  }
  const parsed = Number.parseInt(timeout, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 600) {
    throw new CLIError(
      'Timeout must be an integer between 1 and 600 seconds',
      'INVALID_TIMEOUT',
      1,
      'Use --timeout <seconds> where seconds is between 1 and 600.'
    );
  }
  return parsed;
}

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
          console.error('Error: Config file not found');
          console.error();
          console.error(`  Path: ${resolved}`);
          console.error(`  Current directory: ${process.cwd()}`);
          console.error();
          console.error('Possible solutions:');
          console.error('  1. Run "nachos init" to create a new configuration');
          console.error('  2. Provide a valid path with --config <path>');
          console.error('  3. Remove --config to use automatic config discovery');
          process.exit(2);
        }
        process.env.NACHOS_CONFIG_PATH = resolved;
      }
    });

  program.addHelpText('after', ROOT_HELP_EXAMPLES);

  // Config subcommands
  const configCmd = program.command('config').alias('cfg').description('Configuration management');

  configCmd
    .command('validate')
    .description('Validate nachos.toml configuration')
    .action(async () => {
      const { validateCommand } = await import('./commands/config/validate.js');
      await validateCommand(program.opts());
    });

  configCmd.addHelpText(
    'after',
    `
Examples:
  nachos config validate
  nachos cfg validate --json
`
  );

  // Policy subcommands
  const policyCmd = program.command('policy').description('Policy management');

  policyCmd
    .command('validate')
    .description('Validate policy YAML files')
    .action(async () => {
      const { validateCommand } = await import('./commands/policy/validate.js');
      await validateCommand(program.opts());
    });

  policyCmd.addHelpText(
    'after',
    `
Examples:
  nachos policy validate
  nachos policy validate --json
`
  );

  // Auth subcommands
  const authCmd = program.command('auth').description('Authentication helpers');

  authCmd
    .command('setup-token')
    .description('Configure Anthropic setup-token auth')
    .option('--provider <provider>', 'Provider (default: anthropic)', 'anthropic')
    .option('--profile <name>', 'Profile name (default: anthropic-subscription)')
    .option('--env <name>', 'Environment variable name (default: ANTHROPIC_SETUP_TOKEN)')
    .option('--token <token>', 'Paste setup-token (non-interactive)')
    .option('--append', 'Append to profile order instead of prepending')
    .option('--write-env', 'Write token to .env if possible')
    .action(async (options) => {
      const { setupTokenCommand } = await import('./commands/auth/setup-token.js');
      await setupTokenCommand({ ...program.opts(), ...options });
    });

  authCmd.addHelpText(
    'after',
    `
Examples:
  nachos auth setup-token
  nachos auth setup-token --provider anthropic --profile anthropic-subscription
`
  );

  // Add subcommands
  const addCmd = program.command('add').description('Add modules to configuration');

  addCmd
    .option('-i, --interactive', 'Interactive guided setup')
    .action(async (options, command) => {
      if (!options.interactive) {
        if (process.env.NACHOS_NO_INPUT === '1' || !process.stdin.isTTY) {
          throw new CLIError(
            'Interactive input is unavailable and no add target was provided',
            'MISSING_ARGUMENT',
            2,
            'Use one of: nachos add channel <name> or nachos add tool <name>'
          );
        }
        command.help();
        return;
      }

      if (program.opts().json) {
        throw new CLIError(
          'Interactive setup cannot be used with --json',
          'INVALID_ARGUMENT',
          2,
          'Remove --json or run non-interactive: nachos add channel <name> / nachos add tool <name>'
        );
      }

      if (process.env.NACHOS_NO_INPUT === '1' || !process.stdin.isTTY) {
        throw new CLIError(
          'Interactive setup requires an interactive terminal',
          'INPUT_REQUIRED',
          1,
          'Remove --no-input or run non-interactive: nachos add channel <name> / nachos add tool <name>'
        );
      }

      const prompts = (await import('prompts')).default;

      const typeResponse = await prompts({
        type: 'select',
        name: 'type',
        message: 'What would you like to add?',
        choices: [
          { title: 'Channel', value: 'channel' },
          { title: 'Tool', value: 'tool' },
        ],
      });

      if (!typeResponse.type) {
        return;
      }

      if (typeResponse.type === 'channel') {
        const channelResponse = await prompts({
          type: 'select',
          name: 'name',
          message: 'Which channel?',
          choices: [
            { title: 'Discord', value: 'discord' },
            { title: 'Slack', value: 'slack' },
            { title: 'Telegram', value: 'telegram' },
            { title: 'WhatsApp', value: 'whatsapp' },
            { title: 'Webchat', value: 'webchat' },
          ],
        });

        if (!channelResponse.name) {
          return;
        }

        const { addChannelCommand } = await import('./commands/add/channel.js');
        await addChannelCommand(channelResponse.name, { ...program.opts() });
        return;
      }

      const toolResponse = await prompts({
        type: 'select',
        name: 'name',
        message: 'Which tool?',
        choices: [
          { title: 'Filesystem', value: 'filesystem' },
          { title: 'Browser', value: 'browser' },
          { title: 'Code Runner', value: 'code_runner' },
          { title: 'Shell', value: 'shell' },
          { title: 'Web Search', value: 'web_search' },
          { title: 'Bootstrap', value: 'bootstrap' },
        ],
      });

      if (!toolResponse.name) {
        return;
      }

      const { addToolCommand } = await import('./commands/add/tool.js');
      await addToolCommand(toolResponse.name, { ...program.opts() });
    });

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

  addCmd.addHelpText(
    'after',
    `
Examples:
  nachos add --interactive
  nachos add channel discord
  nachos add channel slack --mode socket
  nachos add tool filesystem --paths ./workspace,./data
`
  );

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
      await subagentsSpawnCommand(task, {
        ...program.opts(),
        ...options,
        timeout: parseTimeoutOption(options.timeout),
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

  subagentsCmd
    .command('files list <runId>')
    .description('List subagent workspace files')
    .option('--path <path>', 'Relative workspace path to list')
    .option('--recursive', 'List files recursively')
    .option('--limit <count>', 'Limit number of entries')
    .action(async (runId: string, options) => {
      const { subagentsFilesListCommand } = await import('./commands/subagents.js');
      const parsed = options.limit ? Number.parseInt(options.limit, 10) : undefined;
      await subagentsFilesListCommand(runId, {
        ...program.opts(),
        ...options,
        limit: Number.isNaN(parsed) ? undefined : parsed,
      });
    });

  subagentsCmd
    .command('files get <runId>')
    .description('Fetch a subagent workspace file')
    .requiredOption('--path <path>', 'Relative workspace file path')
    .option('--max-bytes <bytes>', 'Maximum bytes to read')
    .action(async (runId: string, options) => {
      const { subagentsFilesGetCommand } = await import('./commands/subagents.js');
      const parsed = options.maxBytes ? Number.parseInt(options.maxBytes, 10) : undefined;
      await subagentsFilesGetCommand(runId, {
        ...program.opts(),
        ...options,
        maxBytes: Number.isNaN(parsed) ? undefined : parsed,
      });
    });

  subagentsCmd.addHelpText(
    'after',
    `
Examples:
  nachos subagents spawn "Summarize this repo" --label summary
  nachos subagents list --limit 10
  nachos subagents log run_123 --limit 20
`
  );

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

  sandboxCmd.addHelpText(
    'after',
    `
Examples:
  nachos sandbox explain
  nachos sandbox list
  nachos sandbox recreate --force
`
  );

  // Memory commands
  const memoryCmd = program.command('memory').alias('mem').description('Memory store operations');

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

  memoryCmd.addHelpText(
    'after',
    `
Examples:
  nachos memory append-entry --agent-id my-bot --kind preference --content "User likes tacos"
  nachos memory query --agent-id my-bot --text tacos --limit 5
  nachos memory append-fact --agent-id my-bot --subject User --predicate prefers --object tacos
`
  );

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

  userProfileCmd.addHelpText(
    'after',
    `
Examples:
  nachos user-profile get --agent-id my-bot --user-id user-1
  nachos user-profile set --agent-id my-bot --user-id user-1 --profile "Prefers concise replies"
  nachos user-profile delete --agent-id my-bot --user-id user-1
`
  );

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

  program.commands
    .find((command) => command.name() === 'init')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos init
  nachos init --defaults
  nachos init --force
`
    );

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

  program.commands
    .find((command) => command.name() === 'up')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos up
  nachos up --wait --timeout 90
  nachos up --only gateway,bus
`
    );

  program
    .command('down')
    .alias('d')
    .description('Stop the Nachos stack')
    .option('--volumes', 'Remove volumes')
    .option('--force', 'Skip confirmation when removing volumes')
    .action(async (options) => {
      const { downCommand } = await import('./commands/down.js');
      await downCommand({ ...program.opts(), ...options });
    });

  program.commands
    .find((command) => command.name() === 'down')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos down
  nachos down --volumes --force
`
    );

  program
    .command('restart')
    .alias('r')
    .description('Restart the Nachos stack')
    .option('--build', 'Build images before starting')
    .option('--wait', 'Wait for services to be healthy')
    .action(async (options) => {
      const { restartCommand } = await import('./commands/restart.js');
      await restartCommand({ ...program.opts(), ...options });
    });

  program.commands
    .find((command) => command.name() === 'restart')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos restart
  nachos restart --build --wait
`
    );

  program
    .command('logs')
    .alias('l')
    .description('View service logs')
    .argument('[service]', 'Service name (optional)')
    .option('-f, --follow', 'Follow log output')
    .option('--tail <lines>', 'Number of lines to show from the end', '50')
    .option('-t, --timestamps', 'Show timestamps')
    .action(async (service, options) => {
      const { logsCommand } = await import('./commands/logs.js');
      await logsCommand(service, { ...program.opts(), ...options });
    });

  program.commands
    .find((command) => command.name() === 'logs')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos logs
  nachos logs gateway -f
  nachos logs bus --tail 200 --timestamps
`
    );

  program
    .command('status')
    .alias('s')
    .description('Show stack status')
    .action(async () => {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand(program.opts());
    });

  program.commands
    .find((command) => command.name() === 'status')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos status
  nachos s --json
`
    );

  program
    .command('list')
    .description('List configured modules')
    .action(async () => {
      const { listCommand } = await import('./commands/list.js');
      await listCommand(program.opts());
    });

  program.commands
    .find((command) => command.name() === 'list')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos list
  nachos list --json
`
    );

  program
    .command('ui')
    .description('Open the Admin UI in the browser')
    .option('-p, --port <port>', 'Admin UI port (default: 8082)', parseInt)
    .action(async (options) => {
      const { uiCommand } = await import('./commands/ui.js');
      await uiCommand({ ...program.opts(), ...options });
    });

  program.commands
    .find((command) => command.name() === 'ui')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos ui
  nachos ui --port 8082
`
    );

  program
    .command('open <service>')
    .description('Open a service endpoint in the browser (admin, webchat, gateway, nats, docs)')
    .option('-p, --port <port>', 'Override port for selected service')
    .action(async (service: string, options) => {
      const { openCommand } = await import('./commands/open.js');
      await openCommand(service, { ...program.opts(), ...options });
    });

  program.commands
    .find((command) => command.name() === 'open')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos open admin
  nachos open webchat
  nachos open nats
`
    );

  program
    .command('doctor')
    .description('Run health checks')
    .action(async () => {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand(program.opts());
    });

  program.commands
    .find((command) => command.name() === 'doctor')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos doctor
  nachos doctor --json
`
    );

  program
    .command('debug')
    .description('Show debug information')
    .action(async () => {
      const { debugCommand } = await import('./commands/debug.js');
      await debugCommand(program.opts());
    });

  program.commands
    .find((command) => command.name() === 'debug')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos debug
  nachos debug --json
`
    );

  program
    .command('validate')
    .description('Run aggregate validation (config + policy + doctor checks)')
    .action(async () => {
      const { validateAllCommand } = await import('./commands/validate.js');
      await validateAllCommand(program.opts());
    });

  program.commands
    .find((command) => command.name() === 'validate')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos validate
  nachos validate --json
`
    );

  program
    .command('remove <type> <name>')
    .description('Remove a module from configuration')
    .option('--force', 'Skip confirmation prompt')
    .option('--dry-run', 'Show what would be removed without changing anything')
    .action(async (type: string, name: string, options) => {
      const { removeCommand } = await import('./commands/remove.js');
      await removeCommand(type, name, { ...program.opts(), ...options });
    });

  program.commands
    .find((command) => command.name() === 'remove')
    ?.addHelpText(
      'after',
      `
Examples:
  nachos remove channel discord
  nachos remove tool browser --dry-run
  nachos remove channel discord --force
`
    );

  // Plugin subcommands
  const pluginCmd = program.command('plugin').description('Plugin management');

  pluginCmd
    .command('add <source>')
    .description('Register a plugin from a local path, npm package, or Docker image')
    .option(
      '--source-type <type>',
      'Force source type: path, npm, or image (auto-detected if omitted)'
    )
    .option('--name <name>', 'Override plugin name (defaults to manifest name)')
    .option('--enable', 'Enable the plugin immediately (default: false)')
    .option('--dry-run', 'Show what would be added without writing')
    .action(async (source: string, options) => {
      const { pluginAddCommand } = await import('./commands/plugin/index.js');
      await pluginAddCommand(source, { ...program.opts(), ...options });
    });

  pluginCmd
    .command('remove <name>')
    .description('Remove a registered plugin')
    .option('--force', 'Skip confirmation prompt')
    .option('--keep-config', 'Remove plugin entry but keep channel/tool config')
    .option('--dry-run', 'Show what would be removed without writing')
    .action(async (name: string, options) => {
      const { pluginRemoveCommand } = await import('./commands/plugin/index.js');
      await pluginRemoveCommand(name, { ...program.opts(), ...options });
    });

  pluginCmd
    .command('list')
    .description('List all registered plugins')
    .action(async () => {
      const { pluginListCommand } = await import('./commands/plugin/index.js');
      await pluginListCommand(program.opts());
    });

  pluginCmd.addHelpText(
    'after',
    `
Examples:
  nachos plugin add ../my-signal-channel
  nachos plugin add nachos-tool-weather --source-type npm
  nachos plugin add ghcr.io/org/tool:v1 --source-type image --name custom-tool
  nachos plugin remove signal
  nachos plugin remove weather --force
  nachos plugin list
  nachos plugin list --json
`
  );

  program
    .command('completion <shell>')
    .description('Generate shell completion script (bash, zsh, fish, powershell)')
    .action(async (shell: string) => {
      const { completionCommand } = await import('./commands/completion.js');
      await completionCommand(shell, program, program.opts());
    });

  program.commands
    .find((command) => command.name() === 'completion')
    ?.addHelpText('after', COMPLETION_HELP);

  return program;
}

/**
 * Get CLI version
 */
export function getVersion(): string {
  return packageJson.version;
}
