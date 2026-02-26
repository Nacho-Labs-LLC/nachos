/**
 * nachos policy validate command
 * Validate policy YAML files
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { getProjectRoot } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';

interface ValidateOptions {
  json?: boolean;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'policy validate', getVersion());

  try {
    // Find policies directory
    const projectRoot = getProjectRoot();
    const policiesDir = join(projectRoot, 'policies');

    // Find all YAML files
    const policyFiles: string[] = [];
    try {
      const files = readdirSync(policiesDir);
      for (const file of files) {
        const filePath = join(policiesDir, file);
        if (statSync(filePath).isFile() && (file.endsWith('.yaml') || file.endsWith('.yml'))) {
          policyFiles.push(filePath);
        }
      }
    } catch {
      throw new CLIError(
        'Policies directory not found',
        'POLICIES_DIR_NOT_FOUND',
        4,
        `Create a "policies" directory in ${projectRoot}`
      );
    }

    if (policyFiles.length === 0) {
      throw new CLIError(
        'No policy files found',
        'NO_POLICY_FILES',
        4,
        `Add .yaml policy files to ${policiesDir}`
      );
    }

    // Validate each file
    const results: Array<{ file: string; valid: boolean; error?: string }> = [];

    for (const filePath of policyFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        parse(content); // Will throw if invalid YAML

        // Basic structure validation
        const policy = parse(content);
        if (!policy || typeof policy !== 'object') {
          throw new Error('Policy must be a YAML object');
        }

        results.push({ file: filePath, valid: true });
      } catch (error) {
        results.push({
          file: filePath,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Check for failures
    const failures = results.filter((r) => !r.valid);

    // Display results
    if (options.json) {
      if (failures.length > 0) {
        output.error(
          new CLIError(
            `${failures.length} policy file(s) failed validation`,
            'POLICY_VALIDATION_FAILED',
            4,
            failures.map((f) => `${f.file}: ${f.error}`).join('\n')
          )
        );
      } else {
        output.success({
          valid: true,
          files: results.map((r) => r.file),
        });
      }
    } else {
      prettyOutput.brandedHeader('Policy Validation');
      prettyOutput.blank();

      for (const result of results) {
        if (result.valid) {
          prettyOutput.success(result.file);
        } else {
          prettyOutput.warn(`${result.file}: ${result.error}`);
        }
      }

      prettyOutput.blank();

      if (failures.length > 0) {
        prettyOutput.warn(`${failures.length} file(s) failed validation`);
      } else {
        prettyOutput.success(`All ${results.length} policy file(s) are valid`);
      }
      prettyOutput.blank();

      if (failures.length > 0) {
        process.exit(4);
      }
    }
  } catch (error) {
    output.error(error as Error);
  }
}
