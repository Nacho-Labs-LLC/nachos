/**
 * Filesystem Patch Tool
 *
 * Applies unified diff patches to files
 * Supports standard unified diff format
 *
 * SecurityTier: ELEVATED (2) - Write operations require policy approval
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
import { PathValidator } from './path-validator.js';

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

/**
 * Filesystem patch tool
 */
export class FilesystemPatchTool extends ToolService {
  readonly toolId = 'filesystem_patch';
  readonly name = 'Filesystem Patch';
  readonly description = 'Apply unified diff patches to files';
  readonly securityTier = SecurityTier.ELEVATED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to patch',
      },
      patch: {
        type: 'string',
        description: 'Unified diff patch content',
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
    required: ['path', 'patch'],
  };

  private pathValidator!: PathValidator;

  async initialize(config: ToolConfig): Promise<void> {
    const allowedPaths = (config.config.paths as string[]) ?? ['./workspace'];

    this.pathValidator = new PathValidator({
      allowedPaths,
      allowTraversal: false,
    });

    this.logger.info(
      `Initialized with allowed paths: ${this.pathValidator.getAllowedPaths().join(', ')}`
    );
  }

  validate(params: ToolParameters): ToolValidationResult {
    // Validate required fields
    const requiredValidation = this.combineValidations(
      this.validateRequired(params, 'path'),
      this.validateRequired(params, 'patch')
    );

    if (!requiredValidation.valid) {
      return requiredValidation;
    }

    // Validate types
    const typeValidation = this.combineValidations(
      this.validateType(params, 'path', 'string'),
      this.validateType(params, 'patch', 'string')
    );

    if (!typeValidation.valid) {
      return typeValidation;
    }

    // Validate path security
    const pathSecurityValidation = this.pathValidator.validate(params.path as string);
    if (!pathSecurityValidation.valid) {
      return pathSecurityValidation;
    }

    return { valid: true };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const filePath = path.resolve(params.path as string);
    const patchContent = params.patch as string;
    const reverse = params.reverse === true;
    const dryRun = params.dryRun === true;

    try {
      // Read file
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const fileLines = fileContent.split('\n');

      // Parse patch
      const hunks = this.parsePatch(patchContent);

      if (hunks.length === 0) {
        return this.formatErrorResponse(
          'INVALID_PATCH',
          'No valid hunks found in patch'
        );
      }

      // Apply patch
      const result = this.applyPatch(fileLines, hunks, reverse);

      if (!result.success) {
        return this.formatErrorResponse(
          'PATCH_FAILED',
          result.error ?? 'Failed to apply patch'
        );
      }

      // Write back (unless dry run)
      if (!dryRun) {
        await fs.writeFile(filePath, result.lines!.join('\n'), 'utf-8');
      }

      return this.formatTextResponse(
        JSON.stringify(
          {
            success: true,
            path: filePath,
            hunksApplied: hunks.length,
            linesChanged: result.linesChanged,
            dryRun,
            preview: dryRun ? result.lines!.slice(0, 10).join('\n') : undefined,
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
                `File not found: ${filePath}`
              );
            case 'EACCES':
            case 'EPERM':
              return this.formatErrorResponse(
                'PERMISSION_DENIED',
                `Permission denied: ${filePath}`
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

  /**
   * Parse unified diff patch
   */
  private parsePatch(patchContent: string): PatchHunk[] {
    const lines = patchContent.split('\n');
    const hunks: PatchHunk[] = [];
    let currentHunk: PatchHunk | null = null;

    for (const line of lines) {
      // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        const oldStartValue = hunkMatch[1];
        const newStartValue = hunkMatch[3];
        if (!oldStartValue || !newStartValue) {
          continue;
        }

        currentHunk = {
          oldStart: parseInt(oldStartValue, 10),
          oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          newStart: parseInt(newStartValue, 10),
          newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: [],
        };
        continue;
      }

      // Hunk content lines
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
      let currentLine = startLine - 1; // Convert to 0-based

      // Validate hunk can be applied
      const validation = this.validateHunk(result, hunk, currentLine, reverse);
      if (!validation.valid) {
        return {
          success: false,
          error: `Hunk validation failed at line ${startLine}: ${validation.error}`,
        };
      }

      // Apply hunk
      const newLines: string[] = [];
      for (const patchLine of hunk.lines) {
        const prefix = patchLine[0];
        const content = patchLine.slice(1);

        if (reverse) {
          // Reverse patch: swap + and -
          if (prefix === ' ') {
            // Context line
            newLines.push(content);
            currentLine++;
          } else if (prefix === '+') {
            // In reverse, + means delete
            currentLine++;
            linesChanged++;
          } else if (prefix === '-') {
            // In reverse, - means add
            newLines.push(content);
            linesChanged++;
          }
        } else {
          // Normal patch
          if (prefix === ' ') {
            // Context line
            newLines.push(content);
            currentLine++;
          } else if (prefix === '-') {
            // Delete line
            currentLine++;
            linesChanged++;
          } else if (prefix === '+') {
            // Add line
            newLines.push(content);
            linesChanged++;
          }
        }
      }

      // Replace lines in result
      result.splice(startLine - 1, currentLine - (startLine - 1), ...newLines);
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

      // Check context and deletion lines match
      if (
        (prefix === ' ' || (!reverse && prefix === '-') || (reverse && prefix === '+'))
      ) {
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
        // Addition lines don't need validation
        continue;
      }
    }

    return { valid: true };
  }

  override async healthCheck(): Promise<ToolHealthStatus> {
    try {
      const allowedPaths = this.pathValidator.getAllowedPaths();

      for (const allowedPath of allowedPaths) {
        try {
          await fs.access(allowedPath);
        } catch (error) {
          return {
            healthy: false,
            error: `Cannot access allowed path: ${allowedPath}`,
            details: { error },
          };
        }
      }

      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
