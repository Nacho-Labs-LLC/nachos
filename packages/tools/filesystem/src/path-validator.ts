/**
 * Path Validator
 *
 * Validates filesystem paths to prevent:
 * - Path traversal attacks
 * - Access to sensitive files
 * - Access outside allowed directories
 */

import path from 'node:path';
import type { ToolValidationResult } from '@nachos/types';

/**
 * Path validator configuration
 */
export interface PathValidatorConfig {
  /** Allowed base paths (e.g., ['./workspace']) */
  allowedPaths: string[];

  /** Blocked patterns (e.g., [/\.env$/, /\.git\//]) */
  blockedPatterns?: RegExp[];

  /** Whether to allow path traversal (..) */
  allowTraversal?: boolean;
}

/**
 * Default sensitive path patterns to block
 */
const DEFAULT_BLOCKED_PATTERNS = [
  /\.env$/i,
  /\.env\./i,
  /\.git\//i,
  /\.ssh\//i,
  /\.aws\//i,
  /\.config\/gcloud\//i,
  /credentials/i,
  /password/i,
  /secret/i,
  /private[-_]?key/i,
  /id_rsa/i,
  /id_dsa/i,
  /authorized_keys/i,
  /known_hosts/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
];

/**
 * Path validator for filesystem operations
 */
export class PathValidator {
  private allowedPaths: string[];
  private blockedPatterns: RegExp[];
  private allowTraversal: boolean;

  constructor(config: PathValidatorConfig) {
    // Resolve all allowed paths to absolute paths
    this.allowedPaths = config.allowedPaths.map((p) => path.resolve(p));

    // Combine default and custom blocked patterns
    this.blockedPatterns = [...DEFAULT_BLOCKED_PATTERNS, ...(config.blockedPatterns ?? [])];

    this.allowTraversal = config.allowTraversal ?? false;
  }

  /**
   * Validate a path for read or write access
   */
  validate(requestedPath: string): ToolValidationResult {
    // Resolve to absolute path
    const resolved = path.resolve(requestedPath);

    // Check for path traversal
    if (!this.allowTraversal && requestedPath.includes('..')) {
      return {
        valid: false,
        errors: ['Path traversal detected: ".." not allowed'],
      };
    }

    // Check if path is within allowed directories
    const isAllowed = this.allowedPaths.some((allowedPath) => resolved.startsWith(allowedPath));

    if (!isAllowed) {
      return {
        valid: false,
        errors: [
          `Path "${requestedPath}" is not in allowed directories: ${this.allowedPaths.join(', ')}`,
        ],
      };
    }

    // Check against blocked patterns
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(resolved)) {
        return {
          valid: false,
          errors: [`Path "${requestedPath}" matches blocked pattern: ${pattern}`],
        };
      }
    }

    return { valid: true };
  }

  /**
   * Get the list of allowed paths
   */
  getAllowedPaths(): string[] {
    return [...this.allowedPaths];
  }

  /**
   * Add an allowed path
   */
  addAllowedPath(newPath: string): void {
    const resolved = path.resolve(newPath);
    if (!this.allowedPaths.includes(resolved)) {
      this.allowedPaths.push(resolved);
    }
  }

  /**
   * Check if a path is allowed (without full validation)
   */
  isAllowed(requestedPath: string): boolean {
    const resolved = path.resolve(requestedPath);
    return this.allowedPaths.some((allowedPath) => resolved.startsWith(allowedPath));
  }
}
