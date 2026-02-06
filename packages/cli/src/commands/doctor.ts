/**
 * nachos doctor command
 * Run health checks
 */

import chalk from 'chalk';
import { runDoctorChecks } from '../lib/doctor/index.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';

interface DoctorOptions {
  json?: boolean;
}

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'doctor', getVersion());

  try {
    if (!options.json) {
      prettyOutput.brandedHeader('Nachos Health Check');
      prettyOutput.blank();
    }

    // Run all checks
    const result = await runDoctorChecks();

    // Display results
    if (options.json) {
      output.success(result);
    } else {
      // Show each check
      for (const check of result.checks) {
        const icon = getCheckIcon(check.status);
        const nameColored = chalk.cyan(check.name.padEnd(25));
        console.log(`${icon} ${nameColored} ${check.message}`);

        if (check.suggestion) {
          console.log(`  ${chalk.dim('→')} ${chalk.yellow(check.suggestion)}`);
        }
      }

      prettyOutput.blank();

      // Show summary
      const { summary } = result;
      const summaryParts: string[] = [];

      if (summary.passed > 0) {
        summaryParts.push(chalk.green(`${summary.passed} passed`));
      }

      if (summary.warned > 0) {
        summaryParts.push(
          chalk.yellow(`${summary.warned} warning${summary.warned === 1 ? '' : 's'}`)
        );
      }

      if (summary.failed > 0) {
        summaryParts.push(chalk.red(`${summary.failed} failed`));
      }

      console.log(`${chalk.bold('Summary:')} ${summaryParts.join(', ')}`);
      prettyOutput.blank();

      // Exit with appropriate code
      if (summary.failed > 0) {
        process.exit(1);
      }
    }
  } catch (error) {
    output.error(error as Error);
  }
}

/**
 * Get icon for check status
 */
function getCheckIcon(status: 'pass' | 'warn' | 'fail'): string {
  switch (status) {
    case 'pass':
      return chalk.green('✓');
    case 'warn':
      return chalk.yellow('⚠');
    case 'fail':
      return chalk.red('✗');
  }
}
