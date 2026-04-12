/**
 * Filesystem IdentityStore implementation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IdentityProfile, IdentityStore } from '@nachos/types';

export class FilesystemIdentityStore implements IdentityStore {
  constructor(private baseDir: string) {}

  async get(agentId: string): Promise<IdentityProfile | null> {
    const filePath = this.resolvePath(agentId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as IdentityProfile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async put(profile: IdentityProfile): Promise<IdentityProfile> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = this.resolvePath(profile.agentId);
    const updated: IdentityProfile = {
      ...profile,
      source: profile.source ?? 'filesystem',
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  async delete(agentId: string): Promise<void> {
    const filePath = this.resolvePath(agentId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private resolvePath(agentId: string): string {
    return path.join(this.baseDir, `${agentId}.json`);
  }
}
