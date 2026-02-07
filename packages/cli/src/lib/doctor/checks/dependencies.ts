/**
 * Dependency health checks (Node.js, pnpm)
 */

import { spawnSync } from 'node:child_process';
import type { DoctorCheck } from '../types.js';

/**
 * Check if Node.js 22+ is installed
 */
export async function checkNodeVersion(): Promise<DoctorCheck> {
  const nodeVersion = process.version;
  const match = nodeVersion.match(/^v(\d+)\./);

  if (!match || !match[1]) {
    return {
      id: 'node-version',
      name: 'Node.js',
      status: 'fail',
      message: 'Could not determine Node.js version',
      suggestion: 'Install Node.js 22+: https://nodejs.org/',
    };
  }

  const majorVersion = parseInt(match[1], 10);

  if (majorVersion < 22) {
    return {
      id: 'node-version',
      name: 'Node.js',
      status: 'fail',
      message: `${nodeVersion} (requires v22+)`,
      suggestion: 'Upgrade to Node.js 22+: https://nodejs.org/',
    };
  }

  return {
    id: 'node-version',
    name: 'Node.js',
    status: 'pass',
    message: `${nodeVersion} (OK)`,
  };
}

/**
 * Check if pnpm 9+ is installed
 */
export async function checkPnpmVersion(): Promise<DoctorCheck> {
  try {
    const result = spawnSync('pnpm', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      return {
        id: 'pnpm-version',
        name: 'pnpm',
        status: 'fail',
        message: 'pnpm is not installed',
        suggestion: 'Install pnpm 9+: npm install -g pnpm@9',
      };
    }

    const version = result.stdout.trim();
    const match = version.match(/^(\d+)\./);

    if (!match || !match[1]) {
      return {
        id: 'pnpm-version',
        name: 'pnpm',
        status: 'warn',
        message: `Could not parse version: ${version}`,
      };
    }

    const majorVersion = parseInt(match[1], 10);

    if (majorVersion < 9) {
      return {
        id: 'pnpm-version',
        name: 'pnpm',
        status: 'fail',
        message: `v${version} (requires v9+)`,
        suggestion: 'Upgrade pnpm: npm install -g pnpm@9',
      };
    }

    return {
      id: 'pnpm-version',
      name: 'pnpm',
      status: 'pass',
      message: `v${version} (OK)`,
    };
  } catch {
    return {
      id: 'pnpm-version',
      name: 'pnpm',
      status: 'fail',
      message: 'pnpm is not installed',
      suggestion: 'Install pnpm 9+: npm install -g pnpm@9',
    };
  }
}
