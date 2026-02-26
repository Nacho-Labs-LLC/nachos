/**
 * Multi-Tab Sync using BroadcastChannel
 * 
 * Synchronizes session updates across browser tabs to prevent
 * duplicate subscriptions and ensure consistent UI state.
 */

export type SyncEventType =
  | 'session-created'
  | 'session-archived'
  | 'session-restored'
  | 'session-deleted'
  | 'session-pinned'
  | 'session-switched'
  | 'session-list-updated';

export interface SyncEvent {
  type: SyncEventType;
  sessionId: string;
  timestamp: number;
  tabId: string;
  data?: Record<string, unknown>;
}

export interface SyncHandler {
  (event: SyncEvent): void;
}

const CHANNEL_NAME = 'nachos-webchat-sync';

class WebChatSync {
  private channel: BroadcastChannel | null = null;
  private handlers = new Map<SyncEventType, Set<SyncHandler>>();
  private tabId: string;
  private activeSubscriptions = new Set<string>();

  constructor() {
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.init();
  }

  private init() {
    // Check if BroadcastChannel is supported
    if (typeof BroadcastChannel === 'undefined') {
      console.warn('[sync] BroadcastChannel not supported in this browser');
      return;
    }

    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      
      this.channel.addEventListener('message', (event) => {
        this.handleMessage(event.data as SyncEvent);
      });
      
      console.log(`[sync] Initialized with tabId: ${this.tabId}`);
    } catch (err) {
      console.error('[sync] Failed to initialize BroadcastChannel:', err);
    }
  }

  private handleMessage(event: SyncEvent) {
    // Ignore events from this tab
    if (event.tabId === this.tabId) {
      return;
    }

    console.log('[sync] Received event:', event.type, event.sessionId);

    const handlers = this.handlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (err) {
          console.error('[sync] Error in handler:', err);
        }
      });
    }
  }

  /**
   * Broadcast an event to all other tabs
   */
  broadcast(type: SyncEventType, sessionId: string, data?: Record<string, unknown>) {
    if (!this.channel) {
      return; // BroadcastChannel not supported
    }

    const event: SyncEvent = {
      type,
      sessionId,
      timestamp: Date.now(),
      tabId: this.tabId,
      data,
    };

    try {
      this.channel.postMessage(event);
      console.log('[sync] Broadcasted event:', type, sessionId);
    } catch (err) {
      console.error('[sync] Failed to broadcast event:', err);
    }
  }

  /**
   * Listen for specific event types
   */
  on(type: SyncEventType, handler: SyncHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    
    this.handlers.get(type)!.add(handler);
  }

  /**
   * Remove event listener
   */
  off(type: SyncEventType, handler: SyncHandler) {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Register an active subscription for a session
   * Returns true if this tab should create the subscription,
   * false if another tab already has it.
   */
  registerSubscription(sessionId: string): boolean {
    if (this.activeSubscriptions.has(sessionId)) {
      return false; // Already subscribed in this tab
    }

    this.activeSubscriptions.add(sessionId);
    this.broadcast('session-switched', sessionId, { subscribed: true });
    return true;
  }

  /**
   * Unregister an active subscription
   */
  unregisterSubscription(sessionId: string) {
    this.activeSubscriptions.delete(sessionId);
    this.broadcast('session-switched', sessionId, { subscribed: false });
  }

  /**
   * Check if a session is subscribed in this tab
   */
  isSubscribed(sessionId: string): boolean {
    return this.activeSubscriptions.has(sessionId);
  }

  /**
   * Get this tab's unique ID
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Close the channel (cleanup)
   */
  close() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
    this.activeSubscriptions.clear();
  }
}

// Singleton instance
let syncInstance: WebChatSync | null = null;

/**
 * Get or create the sync instance
 */
export function getSync(): WebChatSync {
  if (!syncInstance) {
    syncInstance = new WebChatSync();
  }
  return syncInstance;
}

/**
 * Close and cleanup the sync instance
 */
export function closeSync() {
  if (syncInstance) {
    syncInstance.close();
    syncInstance = null;
  }
}

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    closeSync();
  });
}
