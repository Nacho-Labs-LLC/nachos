/**
 * Main CLI program definition using Commander.js
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
    .hook('preAction', (thisCommand) => {
      // Set global flags
      const opts = thisCommand.opts();
      if (opts.verbose) {
        process.env.VERBOSE = '1';
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
    .description('Add a channel configuration stub')
    .action(async (name: string) => {
      const { addChannelCommand } = await import('./commands/add/channel.js');
      await addChannelCommand(name, program.opts());
    });

  addCmd
    .command('tool <name>')
    .description('Add a tool configuration stub')
    .action(async (name: string) => {
      const { addToolCommand } = await import('./commands/add/tool.js');
      await addToolCommand(name, program.opts());
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
    .action(async (options) => {
      const { upCommand } = await import('./commands/up.js');
      await upCommand({ ...program.opts(), ...options });
    });

  program
    .command('down')
    .description('Stop the Nachos stack')
    .option('--volumes', 'Remove volumes')
    .action(async (options) => {
      const { downCommand } = await import('./commands/down.js');
      await downCommand({ ...program.opts(), ...options });
    });

  program
    .command('restart')
    .description('Restart the Nachos stack')
    .action(async () => {
      const { restartCommand } = await import('./commands/restart.js');
      await restartCommand(program.opts());
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
    .action(async (type: string, name: string, options) => {
      const { removeCommand } = await import('./commands/remove.js');
      await removeCommand(type, name, { ...program.opts(), ...options });
    });

  return program;
}

/**
 * Get CLI version
 */
export function getVersion(): string {
  return packageJson.version;
}
