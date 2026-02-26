/**
 * Doctor command orchestrator
 * Runs all health checks and returns results
 */

import type { DoctorCheck, DoctorResult } from './types.js';
import { checkDocker, checkDockerCompose } from './checks/docker.js';
import { checkConfigExists, checkConfigValid } from './checks/config.js';
import { checkNodeVersion, checkPnpmVersion } from './checks/dependencies.js';
import { checkEnvVars } from './checks/env.js';
import { checkPolicies } from './checks/policies.js';
import { checkPorts } from './checks/ports.js';
import { checkDiskSpace } from './checks/disk.js';
import { checkComposeExists, checkContainerHealth } from './checks/compose.js';

/**
 * Run all doctor checks
 */
export async function runDoctorChecks(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // Run all checks (some may be skipped based on conditions)
  checks.push(await checkDocker());
  checks.push(await checkDockerCompose());
  checks.push(await checkNodeVersion());
  checks.push(await checkPnpmVersion());
  checks.push(await checkConfigExists());
  checks.push(await checkConfigValid());
  checks.push(await checkEnvVars());
  checks.push(await checkPolicies());
  checks.push(await checkPorts());
  checks.push(await checkDiskSpace());
  checks.push(await checkComposeExists());
  checks.push(await checkContainerHealth());

  // Calculate summary
  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === 'pass').length,
    warned: checks.filter((c) => c.status === 'warn').length,
    failed: checks.filter((c) => c.status === 'fail').length,
  };

  return {
    checks,
    summary,
  };
}
