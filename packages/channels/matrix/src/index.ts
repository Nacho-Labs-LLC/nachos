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
import type { ChannelDMConfig, ChannelServerConfig } from '@nachos/config';
import {
  TOPICS,
  resolveDmPolicy,
  resolveGroupPolicy,
  findServerConfig,
} from '@nachos/channel-base';
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';

interface MatrixChannelConfig {
  homeserver: string; // e.g., "https://matrix.org"
  userId: string; // e.g., "@bot:matrix.org"
  accessToken: string; // Bot access token
  deviceId?: string; // Optional device ID
  syncFilter?: Record<string, unknown>; // Custom sync filter
  dm?: ChannelDMConfig; // DM policy (matches shared config shape)
  servers?: ChannelServerConfig[]; // Room/server policies
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
    this.matrixConfig = (config.config ?? {}) as unknown as MatrixChannelConfig;

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
    this.client.on(sdk.RoomEvent.Timeline, (event: sdk.MatrixEvent) => {
      void this.handleTimelineEvent(event);
    });
  }

  async start(): Promise<void> {
    if (!this.client || !this.config) {
      throw createInvalidStateError('Matrix adapter not initialized', {
        component: 'matrix-channel',
      });
    }

    // Start the Matrix client sync
    await this.client.startClient({ initialSyncLimit: 10 });
    this.isRunning = true;

    // Subscribe to outbound messages from gateway
    await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
      await this.sendMessage(payload as OutboundMessage);
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      this.isRunning = false;
    }
  }

  private async handleTimelineEvent(event: sdk.MatrixEvent): Promise<void> {
    if (!this.config || !this.matrixConfig) return;

    const senderId = event.getSender();
    if (!senderId) return;

    // Ignore events from the bot itself
    if (senderId === this.botUserId) return;

    // Only process room messages for now
    if (event.getType() !== 'm.room.message') return;

    const content = event.getContent();

    // Only process text messages
    if (content.msgtype !== 'm.text') return;

    const messageText = (content.body as string) ?? '';
    const roomId = event.getRoomId();
    if (!roomId) return;
    const eventId = event.getId();
    if (!eventId) return;

    // Determine if this is a DM or room
    const room = this.client?.getRoom(roomId);
    if (!room) return;

    const isDm = this.isDirectMessage(room);
    const conversationType = isDm ? 'dm' : 'channel';

    // Check DM policy
    if (isDm) {
      const dmPolicy = resolveDmPolicy(this.matrixConfig.dm) ?? this.config.dmPolicy;
      if (!dmPolicy) return;

      const allowed = await shouldAllowDm(
        senderId,
        dmPolicy.userAllowlist,
        dmPolicy.pairing ?? false,
        async () => false // No pairing store yet
      );
      if (!allowed) return;
    }

    // Check group policy
    if (!isDm) {
      const serverConfig = findServerConfig(this.matrixConfig.servers, roomId);
      if (!serverConfig) return;
      const groupPolicy = resolveGroupPolicy(serverConfig);

      const mentionPatterns = this.botUserId ? [`@${this.botUserId}`] : [];
      const allowed = shouldAllowGroupMessage({
        channelId: roomId,
        userId: senderId,
        text: messageText,
        channelAllowlist: groupPolicy.channelIds,
        userAllowlist: groupPolicy.userAllowlist,
        mentionGating: groupPolicy.mentionGating,
        mentionPatterns,
      });
      if (!allowed) return;
    }

    // Publish inbound message to gateway
    const inboundMessage = {
      channel: this.channelId,
      channelMessageId: eventId,
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
        eventId,
        timestamp: event.getTs(),
      },
    };

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inboundMessage);
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
      const text = message.content.text;

      // Use SDK helpers that accept plain strings
      const response =
        message.content.format === 'markdown'
          ? await this.client.sendHtmlMessage(roomId, text, this.markdownToHtml(text))
          : await this.client.sendTextMessage(roomId, text);

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
      return 'unhealthy';
    }

    try {
      const syncState = this.client.getSyncState();
      if (syncState === 'SYNCING' || syncState === 'PREPARED') {
        return 'healthy';
      }
      return 'degraded';
    } catch {
      return 'unhealthy';
    }
  }

  // Helper methods

  private isDirectMessage(room: sdk.Room): boolean {
    // Matrix DMs are typically marked with 'm.direct' account data
    // or have exactly 2 members (bot + user)
    const members = room.getJoinedMembers();
    return members.length === 2;
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
