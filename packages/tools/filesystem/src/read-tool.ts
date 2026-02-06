/**
 * Filesystem Read Tool
 *
 * Provides read-only filesystem operations:
 * - Read file contents
 * - List directory contents
 * - Get file/directory metadata
 *
 * SecurityTier: SAFE (0) - No side effects
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
 * Read tool actions
 */
type ReadAction = 'read' | 'list' | 'stat';

/**
 * Filesystem read tool
 */
export class FilesystemReadTool extends ToolService {
  readonly toolId = 'filesystem_read';
  readonly name = 'Filesystem Read';
  readonly description = 'Read files and list directories (read-only operations)';
  readonly securityTier = SecurityTier.SAFE;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['read', 'list', 'stat'],
      },
      path: {
        type: 'string',
        description: 'File or directory path',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (for read action)',
        enum: ['utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary'],
        default: 'utf-8',
      },
    },
    required: ['action', 'path'],
  };

  private pathValidator!: PathValidator;

  async initialize(config: ToolConfig): Promise<void> {
    // Get allowed paths from config
    const allowedPaths = (config.config.paths as string[]) ?? ['./workspace'];

    // Initialize path validator
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
      this.validateRequired(params, 'action'),
      this.validateRequired(params, 'path')
    );

    if (!requiredValidation.valid) {
      return requiredValidation;
    }

    // Validate action enum
    const actionValidation = this.validateEnum(
      params,
      'action',
      ['read', 'list', 'stat']
    );

    if (!actionValidation.valid) {
      return actionValidation;
    }

    // Validate path type
    const pathValidation = this.validateType(params, 'path', 'string');
    if (!pathValidation.valid) {
      return pathValidation;
    }

    // Validate path against allowed paths
    const pathSecurityValidation = this.pathValidator.validate(params.path as string);
    if (!pathSecurityValidation.valid) {
      return pathSecurityValidation;
    }

    // Validate encoding if provided
    if (params.encoding) {
      const encodingValidation = this.validateEnum(
        params,
        'encoding',
        ['utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary']
      );
      if (!encodingValidation.valid) {
        return encodingValidation;
      }
    }

    return { valid: true };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const action = params.action as ReadAction;
    const filePath = path.resolve(params.path as string);
    const encoding = (params.encoding as BufferEncoding) ?? 'utf-8';

    try {
      switch (action) {
        case 'read':
          return await this.readFile(filePath, encoding);

        case 'list':
          return await this.listDirectory(filePath);

        case 'stat':
          return await this.getStats(filePath);

        default:
          return this.formatErrorResponse(
            'INVALID_ACTION',
            `Unknown action: ${action}`
          );
      }
    } catch (error) {
      if (error instanceof Error) {
        // Handle common filesystem errors
        if ('code' in error) {
          const fsError = error as NodeJS.ErrnoException;
          switch (fsError.code) {
            case 'ENOENT':
              return this.formatErrorResponse(
                'FILE_NOT_FOUND',
                `File or directory not found: ${filePath}`
              );
            case 'EACCES':
            case 'EPERM':
              return this.formatErrorResponse(
                'PERMISSION_DENIED',
                `Permission denied: ${filePath}`
              );
            case 'EISDIR':
              return this.formatErrorResponse(
                'IS_DIRECTORY',
                `Expected file but got directory: ${filePath}`
              );
            case 'ENOTDIR':
              return this.formatErrorResponse(
                'NOT_DIRECTORY',
                `Expected directory but got file: ${filePath}`
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
   * Read a file's contents
   */
  private async readFile(
    filePath: string,
    encoding: BufferEncoding
  ): Promise<ToolResult> {
    // Check if file exists and is a file
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return this.formatErrorResponse(
        'NOT_A_FILE',
        `Path is not a file: ${filePath}`
      );
    }

    // Read file contents
    const contents = await fs.readFile(filePath, encoding);

    // Return as text content
    return this.formatTextResponse(contents);
  }

  /**
   * List directory contents
   */
  private async listDirectory(dirPath: string): Promise<ToolResult> {
    // Check if directory exists and is a directory
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return this.formatErrorResponse(
        'NOT_A_DIRECTORY',
        `Path is not a directory: ${dirPath}`
      );
    }

    // Read directory contents with file types
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Format entries with type information
    const formattedEntries = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : entry.isSymbolicLink()
            ? 'symlink'
            : 'other',
      path: path.join(dirPath, entry.name),
    }));

    // Format as JSON text
    const result = JSON.stringify(
      {
        path: dirPath,
        entries: formattedEntries,
        count: formattedEntries.length,
      },
      null,
      2
    );

    return this.formatTextResponse(result);
  }

  /**
   * Get file/directory stats
   */
  private async getStats(filePath: string): Promise<ToolResult> {
    const stats = await fs.stat(filePath);

    const result = JSON.stringify(
      {
        path: filePath,
        type: stats.isDirectory()
          ? 'directory'
          : stats.isFile()
            ? 'file'
            : stats.isSymbolicLink()
              ? 'symlink'
              : 'other',
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString(),
        mode: stats.mode.toString(8),
        isReadable: true, // If we got here, it's readable
        isWritable: !!(stats.mode & 0o200),
        isExecutable: !!(stats.mode & 0o100),
      },
      null,
      2
    );

    return this.formatTextResponse(result);
  }

  override async healthCheck(): Promise<ToolHealthStatus> {
    try {
      // Check if allowed paths are accessible
      const allowedPaths = this.pathValidator.getAllowedPaths();

      for (const allowedPath of allowedPaths) {
        try {
          await fs.access(allowedPath);
        } catch {
          return {
            healthy: false,
            error: `Cannot access allowed path: ${allowedPath}`,
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
