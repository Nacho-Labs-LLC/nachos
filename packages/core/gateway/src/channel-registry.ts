/**
 * Channel Registry - tracks per-channel connection health via NATS announcements
 */

const STALE_THRESHOLD_MS = 90_000; // 90 seconds — channels heartbeat every 30s

export interface ChannelPresence {
  status: 'connected' | 'disconnected' | 'stale';
  lastSeen: string; // ISO timestamp
}

export class ChannelRegistry {
  private channels = new Map<string, { status: 'connected' | 'disconnected'; lastSeen: Date }>();

  announce(name: string, status: 'connected' | 'disconnected'): void {
    this.channels.set(name, { status, lastSeen: new Date() });
  }

  getStatus(): Record<string, ChannelPresence> {
    const now = Date.now();
    const result: Record<string, ChannelPresence> = {};
    for (const [name, entry] of this.channels) {
      const age = now - entry.lastSeen.getTime();
      const status =
        entry.status === 'connected' && age > STALE_THRESHOLD_MS ? 'stale' : entry.status;
      result[name] = { status, lastSeen: entry.lastSeen.toISOString() };
    }
    return result;
  }
}
