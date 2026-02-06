import { App } from '@slack/bolt';
import type { SlackChannelConfig } from '@nachos/config';
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

type SlackEventMessage = {
  type: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  subtype?: string;
  bot_id?: string;
  team?: string;
  team_id?: string;
  files?: Array<{
    id?: string;
    name?: string;
    mimetype?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
  }>;
};

export class SlackChannelAdapter implements ChannelAdapter {
  readonly channelId = 'slack';
  readonly name = 'Slack';

  private config?: ChannelAdapterConfig;
  private app?: App;
  private botUserId?: string;
  private mode: 'socket' | 'http' = 'socket';
  private pairingStore = createPairingStore('slack', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    const channelConfig = (config.config ?? {}) as SlackChannelConfig;

    this.mode = channelConfig.mode ?? 'socket';

    const webhookPath = channelConfig.webhook_path ?? '/slack/events';

    const appToken = channelConfig.app_token ?? config.secrets.SLACK_APP_TOKEN;
    const botToken = channelConfig.bot_token ?? config.secrets.SLACK_BOT_TOKEN;
    const signingSecret = channelConfig.signing_secret ?? config.secrets.SLACK_SIGNING_SECRET;

    if (this.mode === 'socket') {
      if (!appToken || !botToken) {
        throw new Error('Slack socket mode requires app_token and bot_token');
      }
      this.app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });
    } else {
      if (!botToken || !signingSecret) {
        throw new Error('Slack http mode requires bot_token and signing_secret');
      }
      if (!webhookPath) {
        throw new Error('Slack http mode requires webhook_path');
      }
      this.app = new App({
        token: botToken,
        signingSecret,
        endpoints: webhookPath,
      });
    }

    this.app.event('message', async ({ event }) => {
      await this.handleMessage(event as SlackEventMessage, channelConfig);
    });

    const auth = await this.app.client.auth.test();
    if (auth.user_id) {
      this.botUserId = auth.user_id;
    }
  }

  async start(): Promise<void> {
    if (!this.app) {
      throw new Error('Slack adapter not initialized');
    }

    if (this.mode === 'socket') {
      await this.app.start();
    } else {
      const port = Number(process.env.SLACK_HTTP_PORT ?? 3000);
      await this.app.start(port);
    }

    if (this.config) {
      await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
        await this.sendMessage(payload as OutboundMessage);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.app) {
      throw new Error('Slack adapter not initialized');
    }

    try {
      const response = await this.app.client.chat.postMessage({
        channel: message.conversationId,
        text: message.content.text,
        thread_ts: message.replyToMessageId,
      });

      const attachments = message.content.attachments ?? [];
      if (attachments.length > 0) {
        for (let i = 0; i < attachments.length; i += 1) {
          const attachment = attachments[i];
          if (!attachment) continue;

          const data = attachment.data;
          if (typeof data === 'string') {
            const buffer = this.decodeAttachmentData(data);
            if (buffer) {
              await this.app.client.files.upload({
                channels: message.conversationId,
                file: buffer,
                filename: attachment.name ?? `attachment-${i + 1}`,
                thread_ts: message.replyToMessageId,
              });
              continue;
            }

            if (this.isUrl(data)) {
              await this.app.client.chat.postMessage({
                channel: message.conversationId,
                text: `Attachment: ${data}`,
                thread_ts: message.replyToMessageId,
              });
            }
          }
        }
      }

      return {
        success: true,
        messageId: response.ts,
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        success: false,
        error: {
          code: err.code ?? 'slack_error',
          message: err.message,
          retryable: true,
        },
      };
    }
  }

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.app) {
      return 'unhealthy';
    }
    try {
      await this.app.client.auth.test();
      return 'healthy';
    } catch {
      return 'degraded';
    }
  }

  private async handleMessage(
    event: SlackEventMessage,
    channelConfig: SlackChannelConfig
  ): Promise<void> {
    if (!this.config || !this.app) return;

    if (event.subtype || event.bot_id) return;
    if (!event.user || !event.channel || !event.ts) return;

    const isDm = event.channel_type === 'im';
    const serverId = event.team ?? event.team_id;

    if (isDm) {
      const dmPolicy = resolveDmPolicy(channelConfig.dm) ?? this.config.dmPolicy;
      if (!dmPolicy) return;

      if (dmPolicy.pairing) {
        const command = parsePairingCommand(event.text ?? '');
        if (command) {
          if (this.pairingToken && command.token !== this.pairingToken) {
            await this.sendMessage({
              channel: this.channelId,
              conversationId: event.channel,
              content: { text: 'Pairing token invalid.' },
            });
            return;
          }
          await this.pairingStore.setPaired(event.user);
          await this.sendMessage({
            channel: this.channelId,
            conversationId: event.channel,
            content: { text: 'Pairing successful. You can now message the assistant.' },
          });
          return;
        }
      }

      const allowed = await shouldAllowDm(
        event.user,
        dmPolicy.userAllowlist,
        dmPolicy.pairing ?? false,
        async (id) => this.pairingStore.isPaired(id)
      );

      if (!allowed) return;
    } else {
      if (!serverId) return;
      const serverConfig = findServerConfig(channelConfig.servers, serverId);
      if (!serverConfig) return;
      const groupPolicy = resolveGroupPolicy(serverConfig);

      const mentionPatterns = this.botUserId ? [`<@${this.botUserId}>`] : [];
      const allowed = shouldAllowGroupMessage({
        channelId: event.channel,
        userId: event.user,
        text: event.text ?? '',
        channelAllowlist: groupPolicy.channelIds,
        userAllowlist: groupPolicy.userAllowlist,
        mentionGating: groupPolicy.mentionGating,
        mentionPatterns,
      });

      if (!allowed) return;
    }

    const attachments = event.files
      ? event.files
          .map((file) => {
            const url = file.url_private_download ?? file.url_private;
            if (!url) return null;
            return {
              type: 'file',
              url,
              name: file.name,
              mimeType: file.mimetype,
              size: file.size,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : undefined;

    const inbound = {
      channel: this.channelId,
      channelMessageId: event.ts,
      sender: {
        id: event.user,
        isAllowed: true,
      },
      conversation: {
        id: event.channel,
        type: isDm ? 'dm' : 'channel',
      },
      content: {
        text: event.text ?? '',
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      },
      metadata: {
        teamId: serverId,
        thread_ts: event.thread_ts,
        event_ts: (event as { event_ts?: string }).event_ts,
      },
    };

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
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
