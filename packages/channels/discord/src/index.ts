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

    await this.config.bus.subscribe(
      TOPICS.channel.outbound(this.channelId),
      async (payload) => {
        await this.sendMessage(payload as OutboundMessage);
      }
    );
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

      const response = await (channel as { send: (options: unknown) => Promise<{ id: string }> }).send({
        content: message.content.text,
        reply: message.replyToMessageId
          ? { messageReference: message.replyToMessageId }
          : undefined,
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

      const mentionPatterns = this.botUserId ? [`<@${this.botUserId}>`] : [];
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
      },
      metadata: {
        guildId: message.guildId ?? null,
      },
    };

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
  }
}
