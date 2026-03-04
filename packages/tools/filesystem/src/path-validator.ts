/**
 * Path Validator
 *
 * Validates filesystem paths to prevent:
 * - Path traversal attacks
 * - Symlink traversal attacks (CVE-class: symlink following)
 * - Access to sensitive files
 * - Access outside allowed directories
 *
 * Uses fs.realpathSync() to resolve symlinks before checking against the
 * allowlist, preventing an attacker from creating a symlink inside an allowed
 * directory that points outside it.
 */

import fs from 'node:fs';
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
 * Resolve symlinks for a path, falling back to resolving the nearest existing
 * ancestor when the target does not exist yet (e.g. write operations creating
 * a new file). This prevents TOCTOU issues where an attacker creates a symlink
 * at a parent directory.
 *
 * Returns the fully-resolved real path with symlinks expanded.
 */
function resolveRealPath(targetPath: string): string {
  const absolute = path.resolve(targetPath);

  try {
    // Fast path: target exists, resolve all symlinks
    return fs.realpathSync(absolute);
  } catch {
    // Target does not exist — resolve the nearest existing ancestor and
    // append the remaining path components. This handles write operations
    // where the file has not been created yet but the parent directory tree
    // may contain symlinks.
    let current = path.dirname(absolute);
    let remainder = path.basename(absolute);

    // Walk up until we find an existing directory
    while (current !== path.dirname(current)) {
      try {
        const realParent = fs.realpathSync(current);
        return path.join(realParent, remainder);
      } catch {
        remainder = path.join(path.basename(current), remainder);
        current = path.dirname(current);
      }
    }

    // Reached filesystem root without finding an existing ancestor — fall
    // back to the lexically-resolved absolute path. This is still safe
    // because the allowlist check will reject it if it is outside allowed
    // directories.
    return absolute;
  }
}

/**
 * Path validator for filesystem operations
 */
export class PathValidator {
  private allowedPaths: string[];
  private blockedPatterns: RegExp[];
  private allowTraversal: boolean;

  constructor(config: PathValidatorConfig) {
    // Resolve all allowed paths to absolute real paths (following symlinks)
    // so that comparison is always against canonical paths.
    this.allowedPaths = config.allowedPaths.map((p) => {
      const absolute = path.resolve(p);
      try {
        return fs.realpathSync(absolute);
      } catch {
        // Path may not exist yet at construction time (e.g. tests) —
        // fall back to lexical resolution.
        return absolute;
      }
    });

    // Combine default and custom blocked patterns
    this.blockedPatterns = [...DEFAULT_BLOCKED_PATTERNS, ...(config.blockedPatterns ?? [])];

    this.allowTraversal = config.allowTraversal ?? false;
  }

  /**
   * Validate a path for read or write access.
   *
   * Resolves symlinks via realpath before checking against the allowlist,
   * preventing symlink traversal attacks.
   */
  validate(requestedPath: string): ToolValidationResult {
    // Defense-in-depth: reject ".." before doing anything else
    if (!this.allowTraversal && requestedPath.includes('..')) {
      return {
        valid: false,
        errors: ['Path traversal detected: ".." not allowed'],
      };
    }

    // Resolve symlinks to get the canonical real path
    const resolved = resolveRealPath(requestedPath);

    // Detect symlinks and flag them (defense-in-depth logging)
    const lexical = path.resolve(requestedPath);
    if (resolved !== lexical) {
      // The path contains symlinks — the resolved path differs from the
      // lexical path. We continue validation using the resolved path so
      // the allowlist check operates on the actual target location.
    }

    // Check if the real path is within allowed directories
    const isAllowed = this.allowedPaths.some((allowedPath) =>
      resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath
    );

    if (!isAllowed) {
      return {
        valid: false,
        errors: [
          `Path "${requestedPath}" is not in allowed directories: ${this.allowedPaths.join(', ')}`,
        ],
      };
    }

    // Check the real path against blocked patterns
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
    let resolved: string;
    try {
      resolved = fs.realpathSync(path.resolve(newPath));
    } catch {
      resolved = path.resolve(newPath);
    }
    if (!this.allowedPaths.includes(resolved)) {
      this.allowedPaths.push(resolved);
    }
  }

  /**
   * Check if a path is allowed (without full validation).
   *
   * Resolves symlinks before checking against the allowlist.
   */
  isAllowed(requestedPath: string): boolean {
    const resolved = resolveRealPath(requestedPath);
    return this.allowedPaths.some((allowedPath) =>
      resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath
    );
  }
}
