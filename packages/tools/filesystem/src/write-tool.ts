/**
 * Filesystem Write Tool
 *
 * Provides write filesystem operations:
 * - Write file contents
 * - Create files
 * - Delete files
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
import { PathValidator, type PathValidatorConfig } from './path-validator.js';

/**
 * Write tool actions
 */
type WriteAction = 'write' | 'create' | 'delete' | 'mkdir';

/**
 * Filesystem write tool
 */
export class FilesystemWriteTool extends ToolService {
  readonly toolId = 'filesystem_write';
  readonly name = 'Filesystem Write';
  readonly description = 'Write and modify files (write operations)';
  readonly securityTier = SecurityTier.ELEVATED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['write', 'create', 'delete', 'mkdir'],
      },
      path: {
        type: 'string',
        description: 'File or directory path',
      },
      content: {
        type: 'string',
        description: 'File content (for write/create actions)',
      },
      encoding: {
        type: 'string',
        description: 'File encoding',
        enum: ['utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary'],
        default: 'utf-8',
      },
      recursive: {
        type: 'boolean',
        description: 'Create parent directories if they don\'t exist (for mkdir)',
        default: false,
      },
    },
    required: ['action', 'path'],
  };

  private pathValidator!: PathValidator;
  private maxFileSize: number = 10 * 1024 * 1024; // 10MB default

  async initialize(config: ToolConfig): Promise<void> {
    // Get allowed paths from config
    const allowedPaths = (config.config.paths as string[]) ?? ['./workspace'];

    // Get max file size from config (in bytes)
    const maxFileSizeStr = config.config.max_file_size as string;
    if (maxFileSizeStr) {
      this.maxFileSize = this.parseFileSize(maxFileSizeStr);
    }

    // Initialize path validator
    this.pathValidator = new PathValidator({
      allowedPaths,
      allowTraversal: false,
    });

    this.logger.info(
      `Initialized with allowed paths: ${this.pathValidator.getAllowedPaths().join(', ')}`
    );
    this.logger.info(`Max file size: ${this.maxFileSize} bytes`);
  }

  validate(params: ToolParameters): ValidationResult {
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
      ['write', 'create', 'delete', 'mkdir']
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

    // Validate content for write/create actions
    const action = params.action as WriteAction;
    if (action === 'write' || action === 'create') {
      const contentValidation = this.validateRequired(params, 'content');
      if (!contentValidation.valid) {
        return contentValidation;
      }

      // Validate content size
      const content = params.content as string;
      const contentSize = Buffer.byteLength(content, 'utf-8');
      if (contentSize > this.maxFileSize) {
        return {
          valid: false,
          errors: [
            `Content size (${contentSize} bytes) exceeds maximum (${this.maxFileSize} bytes)`,
          ],
        };
      }
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
    const action = params.action as WriteAction;
    const filePath = path.resolve(params.path as string);
    const content = params.content as string | undefined;
    const encoding = (params.encoding as BufferEncoding) ?? 'utf-8';
    const recursive = params.recursive === true;

    try {
      switch (action) {
        case 'write':
          return await this.writeFile(filePath, content!, encoding);

        case 'create':
          return await this.createFile(filePath, content!, encoding);

        case 'delete':
          return await this.deleteFile(filePath);

        case 'mkdir':
          return await this.makeDirectory(filePath, recursive);

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
            case 'EEXIST':
              return this.formatErrorResponse(
                'FILE_EXISTS',
                `File already exists: ${filePath}`
              );
            case 'ENOSPC':
              return this.formatErrorResponse(
                'NO_SPACE',
                `No space left on device: ${filePath}`
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
   * Write content to a file (overwrites existing content)
   */
  private async writeFile(
    filePath: string,
    content: string,
    encoding: BufferEncoding
  ): Promise<ToolResult> {
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return this.formatErrorResponse(
        'FILE_NOT_FOUND',
        `File does not exist: ${filePath}. Use 'create' action to create new files.`
      );
    }

    // Write file
    await fs.writeFile(filePath, content, encoding);

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          path: filePath,
          action: 'write',
          size: Buffer.byteLength(content, encoding),
        },
        null,
        2
      )
    );
  }

  /**
   * Create a new file with content
   */
  private async createFile(
    filePath: string,
    content: string,
    encoding: BufferEncoding
  ): Promise<ToolResult> {
    // Check if file already exists
    try {
      await fs.access(filePath);
      return this.formatErrorResponse(
        'FILE_EXISTS',
        `File already exists: ${filePath}. Use 'write' action to overwrite.`
      );
    } catch {
      // File doesn't exist, which is what we want
    }

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Create file
    await fs.writeFile(filePath, content, encoding);

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          path: filePath,
          action: 'create',
          size: Buffer.byteLength(content, encoding),
        },
        null,
        2
      )
    );
  }

  /**
   * Delete a file
   */
  private async deleteFile(filePath: string): Promise<ToolResult> {
    // Check if file exists
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return this.formatErrorResponse(
        'NOT_A_FILE',
        `Path is not a file: ${filePath}`
      );
    }

    // Delete file
    await fs.unlink(filePath);

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          path: filePath,
          action: 'delete',
        },
        null,
        2
      )
    );
  }

  /**
   * Create a directory
   */
  private async makeDirectory(
    dirPath: string,
    recursive: boolean
  ): Promise<ToolResult> {
    // Create directory
    await fs.mkdir(dirPath, { recursive });

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          path: dirPath,
          action: 'mkdir',
          recursive,
        },
        null,
        2
      )
    );
  }

  /**
   * Parse file size string (e.g., "10MB", "1GB")
   */
  private parseFileSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B?)$/i);
    if (!match) {
      this.logger.warn(`Invalid file size format: ${sizeStr}, using default`);
      return 10 * 1024 * 1024; // 10MB default
    }

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024,
    };

    return Math.floor(value * (multipliers[unit] ?? 1));
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      // Check if allowed paths are accessible and writable
      const allowedPaths = this.pathValidator.getAllowedPaths();

      for (const allowedPath of allowedPaths) {
        try {
          // Check if path exists
          await fs.access(allowedPath);

          // Try to create a test file
          const testFile = path.join(allowedPath, '.nachos-health-check');
          await fs.writeFile(testFile, 'test', 'utf-8');
          await fs.unlink(testFile);
        } catch (error) {
          return {
            healthy: false,
            error: `Cannot write to allowed path: ${allowedPath}`,
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
