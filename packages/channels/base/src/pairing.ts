/**
 * Pairing helpers for channel adapters
 */

import fs from 'node:fs';
import path from 'node:path';

export interface PairingStore {
  isPaired(userId: string): Promise<boolean>;
  setPaired(userId: string): Promise<void>;
  removePaired(userId: string): Promise<void>;
}

interface PairingStoreOptions {
  stateDir?: string;
}

const DEFAULT_STATE_DIR = './state';

class FilePairingStore implements PairingStore {
  private filePath: string;
  private paired: Set<string> = new Set();

  constructor(channelId: string, options?: PairingStoreOptions) {
    const stateDir = options?.stateDir ?? DEFAULT_STATE_DIR;
    const dirPath = path.join(stateDir, 'pairing');
    this.filePath = path.join(dirPath, `${channelId}.json`);
    this.load();
  }

  async isPaired(userId: string): Promise<boolean> {
    return this.paired.has(userId);
  }

  async setPaired(userId: string): Promise<void> {
    if (!userId) return;
    this.paired.add(userId);
    this.save();
  }

  async removePaired(userId: string): Promise<void> {
    if (!userId) return;
    this.paired.delete(userId);
    this.save();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const list = JSON.parse(raw) as string[];
      if (Array.isArray(list)) {
        this.paired = new Set(list.filter((value) => typeof value === 'string'));
      }
    } catch {
      this.paired = new Set();
    }
  }

  private save(): void {
    const dirPath = path.dirname(this.filePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.paired)), 'utf-8');
  }
}

export function createPairingStore(channelId: string, options?: PairingStoreOptions): PairingStore {
  return new FilePairingStore(channelId, options);
}

export function parsePairingCommand(text: string): { token?: string } | null {
  if (!text) return null;
  const match = text.trim().match(/^pair(?:\s+(.+))?$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token ? { token } : {};
}
