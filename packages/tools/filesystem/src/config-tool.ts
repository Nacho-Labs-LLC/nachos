/**
 * Config Patch Tool
 *
 * Applies unified diff patches to nachos.toml
 *
 * SecurityTier: RESTRICTED (3) - Configuration changes require explicit approval
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolService } from '@nachos/tool-base';
import {
  SecurityTier,
  type ToolConfig,
  type ToolParameters,
  type ToolResult,
  type ToolValidationResult,
  type ToolHealthStatus,
  type ParameterSchema,
} from '@nachos/types';

/**
 * Patch hunk information
 */
interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export class ConfigPatchTool extends ToolService {
  readonly toolId = 'config_patch';
  readonly name = 'Config Patch';
  readonly description = 'Apply unified diff patches to nachos.toml';
  readonly securityTier = SecurityTier.RESTRICTED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'Unified diff patch content for nachos.toml',
      },
      reverse: {
        type: 'boolean',
        description: 'Apply patch in reverse',
        default: false,
      },
      dryRun: {
        type: 'boolean',
        description: 'Test patch without applying',
        default: false,
      },
    },
    required: ['patch'],
  };

  private configPath!: string;

  async initialize(config: ToolConfig): Promise<void> {
    this.configPath = await this.resolveConfigPath(config);
    this.logger.info(`Initialized with config path: ${this.configPath}`);
  }

  validate(params: ToolParameters): ToolValidationResult {
    const requiredValidation = this.validateRequired(params, 'patch');
    if (!requiredValidation.valid) {
      return requiredValidation;
    }

    const typeValidation = this.validateType(params, 'patch', 'string');
    if (!typeValidation.valid) {
      return typeValidation;
    }

    if (params.reverse !== undefined) {
      const reverseValidation = this.validateType(params, 'reverse', 'boolean');
      if (!reverseValidation.valid) {
        return reverseValidation;
      }
    }

    if (params.dryRun !== undefined) {
      const dryRunValidation = this.validateType(params, 'dryRun', 'boolean');
      if (!dryRunValidation.valid) {
        return dryRunValidation;
      }
    }

    return { valid: true };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const patchContent = params.patch as string;
    const reverse = params.reverse === true;
    const dryRun = params.dryRun === true;

    try {
      const fileContent = await fs.readFile(this.configPath, 'utf-8');
      const firstNewline = fileContent.indexOf('\n');
      const lineEnding = firstNewline > 0 && fileContent[firstNewline - 1] === '\r' ? '\r\n' : '\n';
      const hasTrailingNewline = fileContent.endsWith('\n');
      const fileLines = fileContent.split(/\r?\n/);

      const hunks = this.parsePatch(patchContent);
      if (hunks.length === 0) {
        return this.formatErrorResponse('INVALID_PATCH', 'No valid hunks found in patch');
      }

      const result = this.applyPatch(fileLines, hunks, reverse);
      if (!result.success) {
        return this.formatErrorResponse('PATCH_FAILED', result.error ?? 'Failed to apply patch');
      }

      if (!dryRun) {
        const joined = result.lines!.join(lineEnding);
        const output = hasTrailingNewline ? `${joined}${lineEnding}` : joined;
        await fs.writeFile(this.configPath, output, 'utf-8');
      }

      return this.formatTextResponse(
        JSON.stringify(
          {
            success: true,
            path: this.configPath,
            hunksApplied: hunks.length,
            linesChanged: result.linesChanged,
            dryRun,
            preview: dryRun ? result.lines!.slice(0, 10).join(lineEnding) : undefined,
          },
          null,
          2
        )
      );
    } catch (error) {
      if (error instanceof Error) {
        if ('code' in error) {
          const fsError = error as NodeJS.ErrnoException;
          switch (fsError.code) {
            case 'ENOENT':
              return this.formatErrorResponse(
                'FILE_NOT_FOUND',
                `Config file not found: ${this.configPath}`
              );
            case 'EACCES':
            case 'EPERM':
              return this.formatErrorResponse(
                'PERMISSION_DENIED',
                `Permission denied: ${this.configPath}`
              );
            default:
              return this.formatErrorResponse(
                'FILESYSTEM_ERROR',
                `Filesystem error (${fsError.code}): ${fsError.message}`
              );
          }
        }

        return this.formatErrorResponse('EXECUTION_ERROR', error.message);
      }

      return this.formatErrorResponse('UNKNOWN_ERROR', 'Unknown error occurred');
    }
  }

  override async healthCheck(): Promise<ToolHealthStatus> {
    try {
      await fs.access(this.configPath);
      return { healthy: true, details: { path: this.configPath } };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async resolveConfigPath(config: ToolConfig): Promise<string> {
    const configuredPath = config.config.config_path;
    const envPath = process.env.NACHOS_CONFIG_PATH ?? process.env.CONFIG_PATH;
    const resolvedConfigured =
      typeof configuredPath === 'string' && configuredPath.trim().length > 0
        ? path.resolve(configuredPath)
        : undefined;
    const resolvedEnv =
      !resolvedConfigured && envPath && envPath.trim().length > 0
        ? path.resolve(envPath)
        : undefined;

    let resolved = resolvedConfigured ?? resolvedEnv;
    if (!resolved) {
      const found = await this.findConfigFile();
      if (found) {
        resolved = path.resolve(found);
      }
    }

    if (!resolved) {
      throw new Error(
        'Config file not found. Set NACHOS_CONFIG_PATH, CONFIG_PATH, or config_path.'
      );
    }

    await fs.access(resolved);
    return resolved;
  }

  private async findConfigFile(): Promise<string | null> {
    const paths: string[] = [];
    paths.push(path.join(process.cwd(), 'nachos.toml'));

    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      paths.push(path.join(homeDir, '.nachos', 'nachos.toml'));
    }

    for (const candidate of paths) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Parse unified diff patch
   */
  private parsePatch(patchContent: string): PatchHunk[] {
    const lines = patchContent.split(/\r?\n/);
    const hunks: PatchHunk[] = [];
    let currentHunk: PatchHunk | null = null;

    for (const line of lines) {
      const hunkMatch = line.match(HUNK_HEADER_REGEX);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        currentHunk = {
          oldStart: parseInt(hunkMatch[1] ?? '0', 10),
          oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(hunkMatch[3] ?? '0', 10),
          newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: [],
        };
        continue;
      }

      if (currentHunk) {
        if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-')) {
          currentHunk.lines.push(line);
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  /**
   * Apply patch hunks to file lines
   */
  private applyPatch(
    fileLines: string[],
    hunks: PatchHunk[],
    reverse: boolean
  ): { success: boolean; lines?: string[]; linesChanged?: number; error?: string } {
    const result = [...fileLines];
    let linesChanged = 0;

    for (const hunk of hunks) {
      const startLine = reverse ? hunk.newStart : hunk.oldStart;
      let currentLine = startLine - 1;

      const validation = this.validateHunk(result, hunk, currentLine, reverse);
      if (!validation.valid) {
        return {
          success: false,
          error: `Hunk validation failed at line ${startLine}: ${validation.error}`,
        };
      }

      const newLines: string[] = [];
      for (const patchLine of hunk.lines) {
        const prefix = patchLine[0];
        const content = patchLine.slice(1);

        if (reverse) {
          if (prefix === ' ') {
            newLines.push(content);
            currentLine++;
          } else if (prefix === '+') {
            currentLine++;
            linesChanged++;
          } else if (prefix === '-') {
            newLines.push(content);
            linesChanged++;
          }
        } else {
          if (prefix === ' ') {
            newLines.push(content);
            currentLine++;
          } else if (prefix === '-') {
            currentLine++;
            linesChanged++;
          } else if (prefix === '+') {
            newLines.push(content);
            linesChanged++;
          }
        }
      }

      const linesToReplace = currentLine - (startLine - 1);
      result.splice(startLine - 1, linesToReplace, ...newLines);
    }

    return { success: true, lines: result, linesChanged };
  }

  /**
   * Validate that a hunk can be applied
   */
  private validateHunk(
    fileLines: string[],
    hunk: PatchHunk,
    startLine: number,
    reverse: boolean
  ): { valid: boolean; error?: string } {
    let currentLine = startLine;

    for (const patchLine of hunk.lines) {
      const prefix = patchLine[0];
      const content = patchLine.slice(1);

      if (prefix === ' ' || (!reverse && prefix === '-') || (reverse && prefix === '+')) {
        if (currentLine >= fileLines.length) {
          return {
            valid: false,
            error: `Hunk exceeds file length at line ${currentLine + 1}`,
          };
        }

        if (fileLines[currentLine] !== content) {
          return {
            valid: false,
            error: `Line mismatch at ${currentLine + 1}: expected "${content}", got "${fileLines[currentLine]}"`,
          };
        }

        currentLine++;
      } else if ((!reverse && prefix === '+') || (reverse && prefix === '-')) {
        continue;
      }
    }

    return { valid: true };
  }
}
