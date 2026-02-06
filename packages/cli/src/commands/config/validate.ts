/**
 * nachos config validate command
 */

import { loadTomlFile, validateConfig } from '@nachos/config';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { ConfigValidationError } from '../../core/errors.js';

interface ValidateOptions {
  json?: boolean;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'config validate', getVersion());

  try {
    // Find config file
    const configPath = findConfigFileOrThrow();

    if (!options.json) {
      prettyOutput.info(`Validating configuration: ${configPath}`);
    }

    // Load TOML file
    const config = loadTomlFile(configPath);

    // Validate configuration
    const result = validateConfig(config);

    if (!result.valid) {
      throw new ConfigValidationError(
        result.errors?.join(', ') ?? 'Unknown validation error',
        result.errors
      );
    }

    // Success
    if (options.json) {
      output.success({
        config_path: configPath,
        valid: true,
      });
    } else {
      prettyOutput.success('Configuration is valid');
      prettyOutput.blank();
      prettyOutput.keyValue('Config path', configPath);
    }
  } catch (error) {
    output.error(error as Error);
  }
}
