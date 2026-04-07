/**
 * Filesystem BootstrapStore implementation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { BootstrapProfile, BootstrapStore } from '@nachos/types';

export class FilesystemBootstrapStore implements BootstrapStore {
  constructor(private baseDir: string) {}

  async get(agentId: string): Promise<BootstrapProfile | null> {
    const filePath = this.resolvePath(agentId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as BootstrapProfile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async put(profile: BootstrapProfile): Promise<BootstrapProfile> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = this.resolvePath(profile.agentId);
    const updated: BootstrapProfile = {
      ...profile,
      source: profile.source ?? 'filesystem',
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
      version: profile.version ?? 1,
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
