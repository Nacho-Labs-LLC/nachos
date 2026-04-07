/**
 * nachos user-profile commands
 * Manage state-layer user profiles.
 */

import { readFileSync } from 'node:fs';
import { loadAndValidateConfig } from '@nachos/config';
import type { IdentitySource, UserProfile } from '@nachos/types';
import type { StateOperationContext } from '@nachos/state';
import { createStateLayerFromConfig } from '../core/state-layer.js';
import { findConfigFileOrThrow } from '../core/config-discovery.js';
import { CLIError } from '../core/errors.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';

interface BaseProfileOptions {
  json?: boolean;
  agentId?: string;
  userId?: string;
  sessionId?: string;
}

type UserProfileGetOptions = BaseProfileOptions;

interface UserProfileSetOptions extends BaseProfileOptions {
  profile?: string;
  file?: string;
  source?: string;
}

type UserProfileDeleteOptions = BaseProfileOptions;

export async function userProfileGetCommand(options: UserProfileGetOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'user-profile get', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const userId = ensureValue(options.userId, 'user-id');

    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      const profile = await stateLayer.getUserProfile(
        agentId,
        userId,
        buildContext(config.security?.mode, options)
      );

      if (options.json) {
        output.success({ profile });
        return;
      }

      prettyOutput.brandedHeader('User Profile');
      prettyOutput.keyValue('Agent', agentId);
      prettyOutput.keyValue('User', userId);
      prettyOutput.blank();

      if (!profile) {
        prettyOutput.warn('No profile found');
        prettyOutput.blank();
        return;
      }

      console.log(profile.profile.trim());
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

export async function userProfileSetCommand(options: UserProfileSetOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'user-profile set', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const userId = ensureValue(options.userId, 'user-id');
    const profileText = resolveProfileText(options);

    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      const existing = await stateLayer.getUserProfile(
        agentId,
        userId,
        buildContext(config.security?.mode, options)
      );
      const now = new Date().toISOString();
      const profile: UserProfile = {
        agentId,
        userId,
        profile: profileText,
        updatedAt: now,
        version: existing ? existing.version + 1 : 1,
        source: resolveSource(options.source) ?? 'api',
      };

      const stored = await stateLayer.putUserProfile(
        profile,
        buildContext(config.security?.mode, options)
      );

      if (options.json) {
        output.success({ profile: stored });
        return;
      }

      prettyOutput.brandedHeader('User Profile Saved');
      prettyOutput.keyValue('Agent', agentId);
      prettyOutput.keyValue('User', userId);
      prettyOutput.keyValue('Version', String(stored.version));
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

export async function userProfileDeleteCommand(options: UserProfileDeleteOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'user-profile delete', getVersion());

  try {
    const agentId = ensureValue(options.agentId, 'agent-id');
    const userId = ensureValue(options.userId, 'user-id');

    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);

    try {
      await stateLayer.deleteUserProfile(
        agentId,
        userId,
        buildContext(config.security?.mode, options)
      );

      if (options.json) {
        output.success({ deleted: true });
        return;
      }

      prettyOutput.success(`Deleted profile for ${userId}`);
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

function ensureValue(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new CLIError(`Missing required --${label}`, 'MISSING_ARGUMENT', 2);
  }
  return value;
}

function resolveProfileText(options: UserProfileSetOptions): string {
  if (options.profile && options.file) {
    throw new CLIError('Provide either --profile or --file (not both)', 'INVALID_ARGUMENT', 2);
  }

  if (options.profile) {
    return options.profile;
  }

  if (options.file) {
    try {
      return readFileSync(options.file, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CLIError(`Failed to read profile file: ${message}`, 'INVALID_PROFILE', 2);
    }
  }

  throw new CLIError('Missing --profile or --file', 'MISSING_ARGUMENT', 2);
}

function resolveSource(source?: string): IdentitySource | undefined {
  if (!source) return undefined;
  const normalized = source.toLowerCase();
  if (normalized === 'cli') return 'api';
  if (normalized === 'filesystem' || normalized === 'db' || normalized === 'api') {
    return normalized;
  }
  if (normalized === 'unknown') return 'unknown';
  throw new CLIError(`Invalid source: ${source}`, 'INVALID_SOURCE', 2);
}

function buildContext(
  securityMode: StateOperationContext['securityMode'] | undefined,
  options: BaseProfileOptions
): StateOperationContext {
  return {
    sessionId: options.sessionId ?? 'cli',
    userId: options.userId,
    securityMode: securityMode ?? 'standard',
    channel: 'cli',
    internalTool: true,
  };
}
