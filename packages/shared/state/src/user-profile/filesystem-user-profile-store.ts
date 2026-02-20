/**
 * Filesystem UserProfileStore implementation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { UserProfile, UserProfileStore } from '@nachos/types';

export class FilesystemUserProfileStore implements UserProfileStore {
  constructor(private baseDir: string) {}

  async get(agentId: string, userId: string): Promise<UserProfile | null> {
    const filePath = this.resolvePath(agentId, userId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as UserProfile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async put(profile: UserProfile): Promise<UserProfile> {
    const dir = this.resolveDir(profile.agentId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = this.resolvePath(profile.agentId, profile.userId);
    const updated: UserProfile = {
      ...profile,
      source: profile.source ?? 'filesystem',
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
      version: profile.version ?? 1,
    };
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  async delete(agentId: string, userId: string): Promise<void> {
    const filePath = this.resolvePath(agentId, userId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private resolveDir(agentId: string): string {
    return path.join(this.baseDir, agentId);
  }

  private resolvePath(agentId: string, userId: string): string {
    return path.join(this.resolveDir(agentId), `${encodeKey(userId)}.json`);
  }
}

function encodeKey(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}
