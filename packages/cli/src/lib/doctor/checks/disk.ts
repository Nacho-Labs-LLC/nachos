/**
 * Disk space health checks
 */

import { statfsSync } from 'node:fs';
import { getProjectRoot } from '../../../core/config-discovery.js';
import type { DoctorCheck } from '../types.js';

/**
 * Check if sufficient disk space is available
 */
export async function checkDiskSpace(): Promise<DoctorCheck> {
  try {
    const projectRoot = getProjectRoot();
    const stats = statfsSync(projectRoot);

    // Available space in GB
    const availableGB = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
    const requiredGB = 10;

    if (availableGB < requiredGB) {
      return {
        id: 'disk-space',
        name: 'Disk Space',
        status: 'warn',
        message: `${availableGB.toFixed(2)} GB available (recommend ${requiredGB} GB+)`,
        suggestion: 'Free up disk space for Docker volumes and logs',
      };
    }

    return {
      id: 'disk-space',
      name: 'Disk Space',
      status: 'pass',
      message: `${availableGB.toFixed(2)} GB available`,
    };
  } catch (error) {
    return {
      id: 'disk-space',
      name: 'Disk Space',
      status: 'warn',
      message: `Could not check: ${(error as Error).message}`,
    };
  }
}
