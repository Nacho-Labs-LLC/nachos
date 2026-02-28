/**
 * Matrix Channel Adapter for Nachos
 * 
 * Integrates Matrix protocol support for decentralized chat.
 * Supports:
 * - Direct messages (DMs)
 * - Rooms (channels)
 * - Text messages
 * - Reactions (future)
 * - Message editing (future)
 * - E2E encryption (future)
 */

import * as sdk from 'matrix-js-sdk';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  OutboundMessage,
  SendResult,
  HealthStatusType,
} from '@nachos/types';
import { createConfigError, createInvalidStateError } from '@nachos/types';
import {
  TOPICS,
  resolveDmPolicy,
  resolveGroupPolicy,
} from '@nachos/channel-base';
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';
import { randomUUID } from 'node:crypto';

interface MatrixChannelConfig {
  homeserver: string;          // e.g., "https://matrix.org"
  userId: string;              // e.g., "@bot:matrix.org"
  accessToken: string;         // Bot access token
  deviceId?: string;           // Optional device ID
  syncFilter?: Record<string, unknown>; // Custom sync filter
  dmPolicy?: {
    userAllowlist?: string[];
    pairing?: boolean;
  };
  groupPolicy?: {
    mentionGating?: boolean;
    roomIds?: string[];        // Allowed room IDs
    userAllowlist?: string[];
  };
}

interface MatrixEvent {
  event_id: string;
  type: string;
  sender: string;
  room_id: string;
  content: {
    msgtype?: string;
    body?: string;
    formatted_body?: string;
    format?: string;
    [key: string]: unknown;
  };
  origin_server_ts: number;
}

export class MatrixChannelAdapter implements ChannelAdapter {
  readonly channelId = 'matrix';
  readonly name = 'Matrix';

  private config?: ChannelAdapterConfig;
  private client?: sdk.MatrixClient;
  private matrixConfig?: MatrixChannelConfig;
  private botUserId?: string;
  private isRunning = false;

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    this.matrixConfig = (config.config ?? {}) as MatrixChannelConfig;

    if (!this.matrixConfig.homeserver) {
      throw createConfigError('Matrix homeserver is required', { component: 'matrix-channel' });
    }
    if (!this.matrixConfig.accessToken) {
      throw createConfigError('Matrix access token is required', { component: 'matrix-channel' });
    }
    if (!this.matrixConfig.userId) {
      throw createConfigError('Matrix user ID is required', { component: 'matrix-channel' });
    }

    // Create Matrix client
    this.client = sdk.createClient({
      baseUrl: this.matrixConfig.homeserver,
      accessToken: this.matrixConfig.accessToken,
      userId: this.matrixConfig.userId,
      deviceId: this.matrixConfig.deviceId,
      timelineSupport: true,
    });

    this.botUserId = this.matrixConfig.userId;

    // Set up event handlers
    this.client.on(sdk.RoomEvent.Timeline as unknown as string, (event: MatrixEvent) => {
      void this.handleTimelineEvent(event);
    });
  }

  async start(): Promise<void> {
    if (!this.client || !this.config) {
      throw createInvalidStateError('Matrix adapter not initialized', { component: 'matrix-channel' });
    }

    // Start the Matrix client sync
    await this.client.startClient({ initialSyncLimit: 10 });
    this.isRunning = true;

    // Subscribe to outbound messages from gateway
    await this.config.bus.subscribe(
      TOPICS.channel.outbound(this.channelId),
      async (payload) => {
        await this.sendMessage(payload as OutboundMessage);
      }
    );
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      this.isRunning = false;
    }
  }

  private async handleTimelineEvent(event: MatrixEvent): Promise<void> {
    if (!this.config || !this.matrixConfig) return;

    // Ignore events from the bot itself
    if (event.sender === this.botUserId) return;

    // Only process room messages for now
    if (event.type !== 'm.room.message') return;

    // Only process text messages
    if (event.content.msgtype !== 'm.text') return;

    const messageText = event.content.body ?? '';
    const roomId = event.room_id;
    const senderId = event.sender;

    // Determine if this is a DM or room
    const room = this.client?.getRoom(roomId);
    if (!room) return;

    const isDm = this.isDirectMessage(room);
    const conversationType = isDm ? 'dm' : 'channel';

    // Check DM policy
    if (isDm) {
      const dmPolicy = resolveDmPolicy({
        dmPolicy: this.config.dmPolicy,
        securityMode: this.config.securityMode,
      });
      
      if (!shouldAllowDm({ senderId, dmPolicy, securityMode: this.config.securityMode })) {
        return; // Silently ignore DMs from non-allowlisted users
      }
    }

    // Check group policy
    if (!isDm) {
      const groupPolicy = resolveGroupPolicy({
        groupPolicy: this.config.groupPolicy,
        securityMode: this.config.securityMode,
      });

      const groupMetadata = {
        groupId: roomId,
        groupChannel: roomId,
        senderId,
        mentions: this.extractMentions(messageText),
        botId: this.botUserId ?? '',
      };

      if (!shouldAllowGroupMessage({
        groupPolicy,
        securityMode: this.config.securityMode,
        ...groupMetadata,
      })) {
        return; // Silently ignore messages that don't meet group policy
      }
    }

    // Publish inbound message to gateway
    const inboundMessage = {
      channel: this.channelId,
      channelMessageId: event.event_id,
      sender: {
        id: senderId,
        name: this.getUserDisplayName(senderId),
        isAllowed: true,
      },
      conversation: {
        id: roomId,
        type: conversationType,
      },
      content: {
        text: messageText,
        attachments: [],
      },
      metadata: {
        roomId,
        eventId: event.event_id,
        timestamp: event.origin_server_ts,
      },
    };

    await this.config.bus.publish(
      TOPICS.channel.inbound(this.channelId),
      inboundMessage
    );
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.client) {
      return {
        success: false,
        error: {
          code: 'CLIENT_NOT_INITIALIZED',
          message: 'Matrix client not initialized',
          retryable: false,
        },
      };
    }

    try {
      const roomId = message.conversationId;
      const content: sdk.IContent = {
        msgtype: 'm.text',
        body: message.content.text,
      };

      // Support markdown formatting
      if (message.content.format === 'markdown') {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = this.markdownToHtml(message.content.text);
      }

      // Send the message
      const response = await this.client.sendEvent(
        roomId,
        'm.room.message',
        content,
        '',
        (err, res) => {
          if (err) throw err;
          return res;
        }
      );

      return {
        success: true,
        messageId: response.event_id,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'SEND_FAILED',
          message: errorMessage,
          retryable: true,
        },
      };
    }
  }

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.client || !this.isRunning) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        details: {
          message: 'Client not running',
        },
      };
    }

    try {
      // Check if client is syncing
      const syncState = this.client.getSyncState();
      
      if (syncState === 'SYNCING' || syncState === 'PREPARED') {
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          details: {
            syncState,
            userId: this.botUserId,
          },
        };
      }

      return {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        details: {
          message: `Sync state: ${syncState}`,
          syncState,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        details: {
          error: errorMessage,
        },
      };
    }
  }

  // Helper methods

  private isDirectMessage(room: sdk.Room): boolean {
    // Matrix DMs are typically marked with 'm.direct' account data
    // or have exactly 2 members (bot + user)
    const members = room.getJoinedMembers();
    return members.length === 2;
  }

  private extractMentions(text: string): string[] {
    // Extract Matrix mentions (@user:domain)
    const mentionRegex = /@([a-zA-Z0-9._-]+:[a-zA-Z0-9.-]+)/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(`@${match[1]}`);
    }
    
    return mentions;
  }

  private getUserDisplayName(userId: string): string {
    if (!this.client) return userId;
    
    try {
      const user = this.client.getUser(userId);
      return user?.displayName ?? userId;
    } catch {
      return userId;
    }
  }

  private markdownToHtml(markdown: string): string {
    // Basic markdown to HTML conversion
    // For production, use a proper markdown library like 'marked'
    let html = markdown;
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    
    // Code
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    
    // Line breaks
    html = html.replace(/\n/g, '<br/>');
    
    return html;
  }
}
