/**
 * nachos completion command
 * Generate shell completion scripts
 */

import type { Command } from 'commander';
import { CLIError } from '../core/errors.js';
import { OutputFormatter } from '../core/output.js';
import { getVersion } from '../cli.js';

type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';

const VALID_SHELLS: Shell[] = ['bash', 'zsh', 'fish', 'powershell'];

interface CompletionOptions {
  json?: boolean;
}

export async function completionCommand(
  shell: string,
  program: Command,
  options: CompletionOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'completion', getVersion());

  try {
    if (!VALID_SHELLS.includes(shell as Shell)) {
      throw new CLIError(
        `Unsupported shell: ${shell}`,
        'INVALID_SHELL',
        1,
        `Supported shells: ${VALID_SHELLS.join(', ')}`
      );
    }

    const script = generateCompletionScript(shell as Shell, program);

    if (options.json) {
      output.success({ shell, script });
    } else {
      // Output raw script to stdout for eval/source
      process.stdout.write(script);
    }
  } catch (error) {
    output.error(error as Error);
  }
}

/**
 * Extract command and option info from Commander program tree
 */
function extractCommands(
  cmd: Command,
  prefix = ''
): Array<{
  name: string;
  description: string;
  options: Array<{ flags: string; description: string }>;
}> {
  const result: Array<{
    name: string;
    description: string;
    options: Array<{ flags: string; description: string }>;
  }> = [];

  for (const sub of cmd.commands) {
    const fullName = prefix ? `${prefix} ${sub.name()}` : sub.name();
    const opts = sub.options.map((o: { flags: string; description: string }) => ({
      flags: o.flags,
      description: o.description,
    }));

    result.push({ name: fullName, description: sub.description(), options: opts });

    // Recurse into subcommands
    if (sub.commands.length > 0) {
      result.push(...extractCommands(sub, fullName));
    }
  }

  return result;
}

function generateCompletionScript(shell: Shell, program: Command): string {
  const commands = extractCommands(program);
  const topLevelNames = program.commands.map((c: Command) => c.name());

  switch (shell) {
    case 'bash':
      return generateBash(commands, topLevelNames);
    case 'zsh':
      return generateZsh(commands, topLevelNames);
    case 'fish':
      return generateFish(commands, topLevelNames);
    case 'powershell':
      return generatePowershell(commands, topLevelNames);
  }
}

function generateBash(
  _commands: Array<{ name: string; description: string; options: Array<{ flags: string }> }>,
  topLevelNames: string[]
): string {
  return `# nachos bash completion
# Add to ~/.bashrc: eval "$(nachos completion bash)"

_nachos() {
  local cur prev words cword
  _init_completion || return

  local commands="${topLevelNames.join(' ')}"

  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
    return
  fi

  case "\${words[1]}" in
    add)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "channel tool" -- "\${cur}"))
        return
      fi
      if [[ \${cword} -eq 3 ]]; then
        case "\${words[2]}" in
          channel) COMPREPLY=($(compgen -W "slack discord telegram whatsapp webchat" -- "\${cur}")) ;;
          tool) COMPREPLY=($(compgen -W "filesystem browser code_runner shell web_search copilot" -- "\${cur}")) ;;
        esac
        return
      fi
      ;;
    config|policy|sandbox)
      if [[ \${cword} -eq 2 ]]; then
        case "\${words[1]}" in
          config) COMPREPLY=($(compgen -W "validate" -- "\${cur}")) ;;
          policy) COMPREPLY=($(compgen -W "validate" -- "\${cur}")) ;;
          sandbox) COMPREPLY=($(compgen -W "explain list recreate" -- "\${cur}")) ;;
        esac
        return
      fi
      ;;
    subagents)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "spawn list info stop log" -- "\${cur}"))
        return
      fi
      ;;
    remove)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "channel tool skill" -- "\${cur}"))
        return
      fi
      ;;
    completion)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "bash zsh fish powershell" -- "\${cur}"))
        return
      fi
      ;;
  esac

  # Option completion
  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=($(compgen -W "--json --verbose --quiet --config --no-input --no-color --help" -- "\${cur}"))
  fi
}

complete -F _nachos nachos
`;
}

function generateZsh(
  commands: Array<{ name: string; description: string; options: Array<{ flags: string }> }>,
  _topLevelNames: string[]
): string {
  const cmdDescs = commands
    .filter((c) => !c.name.includes(' '))
    .map((c) => `    '${c.name}:${c.description.replace(/'/g, "'\\''")}'`)
    .join('\n');

  return `#compdef nachos
# nachos zsh completion
# Add to ~/.zshrc: eval "$(nachos completion zsh)"

_nachos() {
  local -a commands
  commands=(
${cmdDescs}
  )

  _arguments -C \\
    '--json[Output results as JSON]' \\
    '--verbose[Enable verbose output]' \\
    '-q[Suppress non-essential output]' \\
    '--quiet[Suppress non-essential output]' \\
    '-c[Path to nachos.toml]:config file:_files' \\
    '--config[Path to nachos.toml]:config file:_files' \\
    '--no-input[Disable interactive prompts]' \\
    '--no-color[Disable colored output]' \\
    '--help[Show help]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "\${words[1]}" in
        add)
          if (( CURRENT == 2 )); then
            _describe 'type' '(channel tool)'
          elif (( CURRENT == 3 )); then
            case "\${words[2]}" in
              channel) _describe 'channel' '(slack discord telegram whatsapp webchat)' ;;
              tool) _describe 'tool' '(filesystem browser code_runner shell web_search copilot)' ;;
            esac
          fi
          ;;
        sandbox)
          _describe 'subcommand' '(explain list recreate)'
          ;;
        subagents)
          _describe 'subcommand' '(spawn list info stop log)'
          ;;
        remove)
          if (( CURRENT == 2 )); then
            _describe 'type' '(channel tool skill)'
          fi
          ;;
        completion)
          _describe 'shell' '(bash zsh fish powershell)'
          ;;
      esac
      ;;
  esac
}

_nachos
`;
}

function generateFish(
  commands: Array<{ name: string; description: string; options: Array<{ flags: string }> }>,
  topLevelNames: string[]
): string {
  const lines = [
    '# nachos fish completion',
    '# Add to ~/.config/fish/completions/nachos.fish',
    '',
    '# Disable file completions by default',
    'complete -c nachos -f',
    '',
    '# Global options',
    'complete -c nachos -l json -d "Output results as JSON"',
    'complete -c nachos -l verbose -d "Enable verbose output"',
    'complete -c nachos -s q -l quiet -d "Suppress non-essential output"',
    'complete -c nachos -s c -l config -r -d "Path to nachos.toml"',
    'complete -c nachos -l no-input -d "Disable interactive prompts"',
    'complete -c nachos -l no-color -d "Disable colored output"',
    '',
    '# Top-level commands',
  ];

  for (const name of topLevelNames) {
    const cmd = commands.find((c) => c.name === name);
    const desc = cmd?.description ?? '';
    lines.push(`complete -c nachos -n "__fish_use_subcommand" -a "${name}" -d "${desc}"`);
  }

  lines.push('');
  lines.push('# add subcommands');
  lines.push(
    'complete -c nachos -n "__fish_seen_subcommand_from add" -a "channel tool" -d "Module type"'
  );
  lines.push('');
  lines.push('# Channel names');
  lines.push(
    'complete -c nachos -n "__fish_seen_subcommand_from add; and __fish_seen_subcommand_from channel" -a "slack discord telegram whatsapp webchat"'
  );
  lines.push('');
  lines.push('# Tool names');
  lines.push(
    'complete -c nachos -n "__fish_seen_subcommand_from add; and __fish_seen_subcommand_from tool" -a "filesystem browser code_runner shell web_search copilot"'
  );
  lines.push('');
  lines.push('# sandbox subcommands');
  lines.push(
    'complete -c nachos -n "__fish_seen_subcommand_from sandbox" -a "explain list recreate"'
  );
  lines.push('');
  lines.push('# subagents subcommands');
  lines.push(
    'complete -c nachos -n "__fish_seen_subcommand_from subagents" -a "spawn list info stop log"'
  );
  lines.push('');
  lines.push('# remove type');
  lines.push('complete -c nachos -n "__fish_seen_subcommand_from remove" -a "channel tool skill"');
  lines.push('');
  lines.push('# completion shells');
  lines.push(
    'complete -c nachos -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell"'
  );
  lines.push('');

  return lines.join('\n');
}

function generatePowershell(
  _commands: Array<{ name: string; description: string; options: Array<{ flags: string }> }>,
  topLevelNames: string[]
): string {
  return `# nachos PowerShell completion
# Add to $PROFILE: nachos completion powershell | Out-String | Invoke-Expression

Register-ArgumentCompleter -CommandName nachos -Native -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(${topLevelNames.map((n) => `'${n}'`).join(', ')})
  $addTypes = @('channel', 'tool')
  $channels = @('slack', 'discord', 'telegram', 'whatsapp', 'webchat')
  $tools = @('filesystem', 'browser', 'code_runner', 'shell', 'web_search', 'copilot')
  $sandboxSubs = @('explain', 'list', 'recreate')
  $subagentsSubs = @('spawn', 'list', 'info', 'stop', 'log')
  $removeTypes = @('channel', 'tool', 'skill')
  $shells = @('bash', 'zsh', 'fish', 'powershell')
  $globalOpts = @('--json', '--verbose', '--quiet', '--config', '--no-input', '--no-color', '--help')

  $elements = $commandAst.CommandElements
  $count = $elements.Count

  if ($count -le 2) {
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  $subCmd = $elements[1].ToString()

  switch ($subCmd) {
    'add' {
      if ($count -le 3) {
        $addTypes | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
      } elseif ($count -le 4) {
        $type = $elements[2].ToString()
        $candidates = if ($type -eq 'channel') { $channels } else { $tools }
        $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
      }
    }
    'sandbox' {
      $sandboxSubs | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
    }
    'subagents' {
      $subagentsSubs | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
    }
    'remove' {
      if ($count -le 3) {
        $removeTypes | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
      }
    }
    'completion' {
      $shells | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
    }
  }

  if ($wordToComplete -like '-*') {
    $globalOpts | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
}
`;
}
