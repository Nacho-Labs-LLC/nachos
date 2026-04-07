/**
 * nachos validate command
 * Run aggregate validation checks in one command.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loadTomlFile, validateConfig } from '@nachos/config';
import { findConfigFileOrThrow, getProjectRoot } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';
import { CLIError } from '../core/errors.js';
import { runDoctorChecks } from '../lib/doctor/index.js';

interface ValidateAllOptions {
  json?: boolean;
}

interface ValidateItem {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export async function validateAllCommand(options: ValidateAllOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'validate', getVersion());

  try {
    const items: ValidateItem[] = [];

    const configPath = findConfigFileOrThrow();
    const config = loadTomlFile(configPath);
    const configResult = validateConfig(config);
    if (configResult.valid) {
      items.push({ name: 'config.validate', status: 'pass', message: configPath });
    } else {
      items.push({
        name: 'config.validate',
        status: 'fail',
        message: configResult.errors?.join(', ') ?? 'Configuration validation failed',
      });
    }

    const projectRoot = getProjectRoot();
    const policiesDir = join(projectRoot, 'policies');
    let policyFailures = 0;
    try {
      const policyFiles = readdirSync(policiesDir).filter((file) => {
        const filePath = join(policiesDir, file);
        return statSync(filePath).isFile() && (file.endsWith('.yaml') || file.endsWith('.yml'));
      });

      if (policyFiles.length === 0) {
        items.push({
          name: 'policy.validate',
          status: 'fail',
          message: `No policy files found in ${policiesDir}`,
        });
      } else {
        for (const file of policyFiles) {
          const filePath = join(policiesDir, file);
          try {
            const content = readFileSync(filePath, 'utf-8');
            const parsed = parse(content);
            if (!parsed || typeof parsed !== 'object') {
              throw new Error('Policy must be a YAML object');
            }
          } catch {
            policyFailures += 1;
          }
        }

        if (policyFailures === 0) {
          items.push({
            name: 'policy.validate',
            status: 'pass',
            message: `${policyFiles.length} file(s) valid`,
          });
        } else {
          items.push({
            name: 'policy.validate',
            status: 'fail',
            message: `${policyFailures} file(s) failed validation`,
          });
        }
      }
    } catch {
      items.push({
        name: 'policy.validate',
        status: 'fail',
        message: `Policies directory not found: ${policiesDir}`,
      });
    }

    const doctorResult = await runDoctorChecks();
    if (doctorResult.summary.failed > 0) {
      items.push({
        name: 'doctor',
        status: 'fail',
        message: `${doctorResult.summary.failed} failed, ${doctorResult.summary.warned} warning(s)`,
      });
    } else if (doctorResult.summary.warned > 0) {
      items.push({
        name: 'doctor',
        status: 'warn',
        message: `${doctorResult.summary.warned} warning(s)`,
      });
    } else {
      items.push({
        name: 'doctor',
        status: 'pass',
        message: `${doctorResult.summary.passed} checks passed`,
      });
    }

    const failed = items.filter((item) => item.status === 'fail');

    if (options.json) {
      if (failed.length > 0) {
        const error = new CLIError(
          `${failed.length} validation check(s) failed`,
          'VALIDATION_FAILED',
          5,
          'Run `nachos config validate`, `nachos policy validate`, and `nachos doctor` for details.'
        );
        error.details = { checks: items, doctor_summary: doctorResult.summary };
        output.error(error);
      }

      output.success({ checks: items, doctor_summary: doctorResult.summary });
      return;
    }

    prettyOutput.brandedHeader('Nachos Validate');
    prettyOutput.blank();

    for (const item of items) {
      if (item.status === 'pass') {
        prettyOutput.success(`${item.name}: ${item.message}`);
      } else if (item.status === 'warn') {
        prettyOutput.warn(`${item.name}: ${item.message}`);
      } else {
        prettyOutput.warn(`${item.name}: ${item.message}`);
      }
    }

    prettyOutput.blank();

    if (failed.length > 0) {
      throw new CLIError(
        `${failed.length} validation check(s) failed`,
        'VALIDATION_FAILED',
        5,
        'Run `nachos config validate`, `nachos policy validate`, and `nachos doctor` for details.'
      );
    }

    prettyOutput.success('All validation checks passed');
    prettyOutput.blank();
  } catch (error) {
    output.error(error as Error);
  }
}
