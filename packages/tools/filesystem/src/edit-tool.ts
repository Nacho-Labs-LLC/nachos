/**
 * Filesystem Edit Tool
 *
 * Provides line-based file editing:
 * - Replace specific lines
 * - Insert lines
 * - Delete lines
 *
 * SecurityTier: ELEVATED (2) - Write operations require policy approval
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ToolService,
  type ToolServiceConfig,
} from '@nachos/tool-base';
import {
  SecurityTier,
  type ToolConfig,
  type ToolParameters,
  type ToolResult,
  type ValidationResult,
  type HealthStatus,
  type ParameterSchema,
} from '@nachos/types';
import { PathValidator } from './path-validator.js';

/**
 * Edit tool actions
 */
type EditAction = 'replace' | 'insert' | 'delete';

/**
 * Filesystem edit tool
 */
export class FilesystemEditTool extends ToolService {
  readonly toolId = 'filesystem_edit';
  readonly name = 'Filesystem Edit';
  readonly description = 'Edit files with line-based operations';
  readonly securityTier = SecurityTier.ELEVATED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Edit action to perform',
        enum: ['replace', 'insert', 'delete'],
      },
      path: {
        type: 'string',
        description: 'File path',
      },
      line: {
        type: 'number',
        description: 'Line number (1-based)',
      },
      content: {
        type: 'string',
        description: 'New content (for replace/insert)',
      },
      count: {
        type: 'number',
        description: 'Number of lines to delete (for delete action)',
        default: 1,
      },
    },
    required: ['action', 'path', 'line'],
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

  validate(params: ToolParameters): ValidationResult {
    // Validate required fields
    const requiredValidation = this.combineValidations(
      this.validateRequired(params, 'action'),
      this.validateRequired(params, 'path'),
      this.validateRequired(params, 'line')
    );

    if (!requiredValidation.valid) {
      return requiredValidation;
    }

    // Validate action enum
    const actionValidation = this.validateEnum(
      params,
      'action',
      ['replace', 'insert', 'delete']
    );

    if (!actionValidation.valid) {
      return actionValidation;
    }

    // Validate types
    const typeValidation = this.combineValidations(
      this.validateType(params, 'path', 'string'),
      this.validateType(params, 'line', 'number')
    );

    if (!typeValidation.valid) {
      return typeValidation;
    }

    // Validate path security
    const pathSecurityValidation = this.pathValidator.validate(params.path as string);
    if (!pathSecurityValidation.valid) {
      return pathSecurityValidation;
    }

    // Validate line number
    const line = params.line as number;
    if (line < 1) {
      return {
        valid: false,
        errors: ['Line number must be >= 1'],
      };
    }

    // Validate content for replace/insert
    const action = params.action as EditAction;
    if (action === 'replace' || action === 'insert') {
      const contentValidation = this.validateRequired(params, 'content');
      if (!contentValidation.valid) {
        return contentValidation;
      }
    }

    // Validate count for delete
    if (action === 'delete' && params.count !== undefined) {
      const countValidation = this.validateType(params, 'count', 'number');
      if (!countValidation.valid) {
        return countValidation;
      }

      const count = params.count as number;
      if (count < 1) {
        return {
          valid: false,
          errors: ['Count must be >= 1'],
        };
      }
    }

    return { valid: true };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const action = params.action as EditAction;
    const filePath = path.resolve(params.path as string);
    const line = params.line as number;
    const content = params.content as string | undefined;
    const count = (params.count as number | undefined) ?? 1;

    try {
      // Read file
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n');

      // Validate line number
      if (line > lines.length + 1) {
        return this.formatErrorResponse(
          'INVALID_LINE',
          `Line ${line} exceeds file length (${lines.length} lines)`
        );
      }

      // Perform edit
      let newLines: string[];
      switch (action) {
        case 'replace':
          newLines = this.replaceLine(lines, line, content!);
          break;

        case 'insert':
          newLines = this.insertLine(lines, line, content!);
          break;

        case 'delete':
          newLines = this.deleteLines(lines, line, count);
          break;

        default:
          return this.formatErrorResponse(
            'INVALID_ACTION',
            `Unknown action: ${action}`
          );
      }

      // Write back to file
      await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');

      return this.formatTextResponse(
        JSON.stringify(
          {
            success: true,
            path: filePath,
            action,
            line,
            linesAffected: action === 'delete' ? count : 1,
            totalLines: newLines.length,
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
   * Replace a specific line
   */
  private replaceLine(lines: string[], lineNum: number, content: string): string[] {
    const newLines = [...lines];
    newLines[lineNum - 1] = content;
    return newLines;
  }

  /**
   * Insert a line at a specific position
   */
  private insertLine(lines: string[], lineNum: number, content: string): string[] {
    const newLines = [...lines];
    newLines.splice(lineNum - 1, 0, content);
    return newLines;
  }

  /**
   * Delete one or more lines
   */
  private deleteLines(lines: string[], lineNum: number, count: number): string[] {
    const newLines = [...lines];
    newLines.splice(lineNum - 1, count);
    return newLines;
  }

  async healthCheck(): Promise<HealthStatus> {
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
