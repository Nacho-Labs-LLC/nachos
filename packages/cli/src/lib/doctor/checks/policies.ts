/**
 * Policy file health checks
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { getProjectRoot } from '../../../core/config-discovery.js';
import type { DoctorCheck } from '../types.js';

/**
 * Check if policy files exist and are valid
 */
export async function checkPolicies(): Promise<DoctorCheck> {
  try {
    const projectRoot = getProjectRoot();
    const policiesDir = join(projectRoot, 'policies');

    // Check if policies directory exists
    if (!existsSync(policiesDir)) {
      return {
        id: 'policies',
        name: 'Policies',
        status: 'fail',
        message: 'Policies directory not found',
        suggestion: `Create ${policiesDir} directory and add policy files`,
      };
    }

    // Find all YAML files
    const files = readdirSync(policiesDir);
    const policyFiles = files.filter((f) => {
      const filePath = join(policiesDir, f);
      return statSync(filePath).isFile() && (f.endsWith('.yaml') || f.endsWith('.yml'));
    });

    if (policyFiles.length === 0) {
      return {
        id: 'policies',
        name: 'Policies',
        status: 'warn',
        message: 'No policy files found',
        suggestion: `Add .yaml policy files to ${policiesDir}`,
      };
    }

    // Validate each file
    const errors: string[] = [];

    for (const file of policyFiles) {
      try {
        const content = readFileSync(join(policiesDir, file), 'utf-8');
        parse(content); // Will throw if invalid YAML
      } catch (error) {
        errors.push(`${file}: ${(error as Error).message}`);
      }
    }

    if (errors.length > 0) {
      return {
        id: 'policies',
        name: 'Policies',
        status: 'fail',
        message: `${errors.length} file(s) invalid`,
        suggestion: 'Run: nachos policy validate',
      };
    }

    return {
      id: 'policies',
      name: 'Policies',
      status: 'pass',
      message: `${policyFiles.length} file(s) valid`,
    };
  } catch (error) {
    return {
      id: 'policies',
      name: 'Policies',
      status: 'warn',
      message: `Could not check: ${(error as Error).message}`,
    };
  }
}
