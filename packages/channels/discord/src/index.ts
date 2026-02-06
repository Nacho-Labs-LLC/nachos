import { Client, GatewayIntentBits, Partials, type Message } from 'discord.js';
import type { DiscordChannelConfig } from '@nachos/config';
import {
  TOPICS,
  findServerConfig,
  resolveDmPolicy,
  resolveGroupPolicy,
  createPairingStore,
  parsePairingCommand,
} from '@nachos/channel-base';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  OutboundMessage,
  SendResult,
  HealthStatusType,
} from '@nachos/types';
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly channelId = 'discord';
  readonly name = 'Discord';

  private config?: ChannelAdapterConfig;
  private client?: Client;
  private botUserId?: string;
  private pairingStore = createPairingStore('discord', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });
  }

  async start(): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Discord adapter not initialized');
    }

    const channelConfig = this.config.config as DiscordChannelConfig;
    const token = channelConfig.token ?? this.config.secrets.DISCORD_BOT_TOKEN;
    if (!token) {
      throw new Error('Discord token is required');
    }

    await this.client.login(token);
    this.botUserId = this.client.user?.id;

    await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
      await this.sendMessage(payload as OutboundMessage);
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
    }
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.client) {
      throw new Error('Discord adapter not initialized');
    }

    try {
      const channel = await this.client.channels.fetch(message.conversationId);

      if (!channel || !('send' in channel)) {
        return {
          success: false,
          error: {
            code: 'discord_channel_not_found',
            message: 'Channel not found',
            retryable: false,
          },
        };
      }

      const files = this.buildDiscordFiles(message.content.attachments ?? []);
      const response = await (
        channel as { send: (options: unknown) => Promise<{ id: string }> }
      ).send({
        content: message.content.text,
        reply: message.replyToMessageId
          ? { messageReference: message.replyToMessageId }
          : undefined,
        files: files.length > 0 ? files : undefined,
      });

      return {
        success: true,
        messageId: response.id,
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        success: false,
        error: {
          code: err.code ?? 'discord_error',
          message: err.message,
          retryable: true,
        },
      };
    }
  }

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.client) return 'unhealthy';
    return this.client.isReady() ? 'healthy' : 'degraded';
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.config) return;
    if (message.author?.bot) return;

    const channelConfig = this.config.config as DiscordChannelConfig;
    const isDm = !message.guildId;
    const userId = message.author?.id;
    if (!userId) return;

    if (isDm) {
      const dmPolicy = resolveDmPolicy(channelConfig.dm) ?? this.config.dmPolicy;
      if (!dmPolicy) return;

      if (dmPolicy.pairing) {
        const command = parsePairingCommand(message.content ?? '');
        if (command) {
          if (this.pairingToken && command.token !== this.pairingToken) {
            await this.sendMessage({
              channel: this.channelId,
              conversationId: message.channelId,
              content: { text: 'Pairing token invalid.' },
            });
            return;
          }
          await this.pairingStore.setPaired(userId);
          await this.sendMessage({
            channel: this.channelId,
            conversationId: message.channelId,
            content: { text: 'Pairing successful. You can now message the assistant.' },
          });
          return;
        }
      }
      const allowed = await shouldAllowDm(
        userId,
        dmPolicy.userAllowlist,
        dmPolicy.pairing ?? false,
        async (id) => this.pairingStore.isPaired(id)
      );
      if (!allowed) return;
    } else {
      const guildId = message.guildId;
      if (!guildId) return;
      const serverConfig = findServerConfig(channelConfig.servers, guildId);
      if (!serverConfig) return;
      const groupPolicy = resolveGroupPolicy(serverConfig);

      const mentionPatterns = this.botUserId
        ? [`<@${this.botUserId}>`, `<@!${this.botUserId}>`]
        : [];
      const allowed = shouldAllowGroupMessage({
        channelId: message.channelId,
        userId,
        text: message.content ?? '',
        channelAllowlist: groupPolicy.channelIds,
        userAllowlist: groupPolicy.userAllowlist,
        mentionGating: groupPolicy.mentionGating,
        mentionPatterns,
      });

      if (!allowed) return;
    }

    const attachmentCollection = message.attachments;
    const attachments =
      attachmentCollection && attachmentCollection.size > 0
        ? attachmentCollection.map((attachment) => ({
            type: 'file',
            url: attachment.url,
            name: attachment.name ?? undefined,
            mimeType: attachment.contentType ?? undefined,
            size: attachment.size ?? undefined,
          }))
        : undefined;

    const inbound = {
      channel: this.channelId,
      channelMessageId: message.id,
      sender: {
        id: userId,
        isAllowed: true,
      },
      conversation: {
        id: message.channelId,
        type: isDm ? 'dm' : 'channel',
      },
      content: {
        text: message.content ?? '',
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      },
      metadata: {
        guildId: message.guildId ?? null,
      },
    };

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
  }

  private buildDiscordFiles(
    attachments: Array<{ data: unknown; name?: string }>
  ): Array<{ attachment: Buffer | string; name?: string }> {
    const files: Array<{ attachment: Buffer | string; name?: string }> = [];

    for (let i = 0; i < attachments.length; i += 1) {
      const attachment = attachments[i];
      if (!attachment) continue;

      const data = attachment.data;
      if (typeof data === 'string') {
        const buffer = this.decodeAttachmentData(data);
        if (buffer) {
          files.push({ attachment: buffer, name: attachment.name ?? `attachment-${i + 1}` });
          continue;
        }

        if (this.isUrl(data)) {
          files.push({ attachment: data, name: attachment.name ?? undefined });
        }
      }
    }

    return files;
  }

  private decodeAttachmentData(data: string): Buffer | null {
    if (data.startsWith('data:')) {
      const base64Index = data.indexOf('base64,');
      if (base64Index !== -1) {
        const base64 = data.slice(base64Index + 7);
        try {
          return Buffer.from(base64, 'base64');
        } catch {
          return null;
        }
      }
      return null;
    }

    if (this.looksLikeBase64(data)) {
      try {
        return Buffer.from(data, 'base64');
      } catch {
        return null;
      }
    }

    return null;
  }

  private looksLikeBase64(data: string): boolean {
    return /^[A-Za-z0-9+/=]+$/.test(data) && data.length % 4 === 0;
  }

  private isUrl(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://');
  }
}
