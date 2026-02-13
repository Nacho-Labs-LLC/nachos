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
import { validateChannelInboundMessage } from '@nachos/types';
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';
import { randomUUID } from 'node:crypto';

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
  private channelConfig?: SlackChannelConfig;
  private pairingStore = createPairingStore('slack', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    const channelConfig = (config.config ?? {}) as SlackChannelConfig;
    this.channelConfig = channelConfig;

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
      await this.handleMessage(event as SlackEventMessage);
    });

    this.app.command('/nachos', async ({ command, ack, respond }) => {
      await ack();
      await this.handleSlashCommand(command, respond);
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

  private async handleMessage(event: SlackEventMessage): Promise<void> {
    if (!this.config || !this.app) return;
    const channelConfig = this.channelConfig ?? ((this.config.config ?? {}) as SlackChannelConfig);

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

    const validation = validateChannelInboundMessage(inbound);
    if (!validation.success) {
      console.warn('[Slack] Dropping invalid inbound message', validation.errors);
      return;
    }

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

  private getCommandConfig(): {
    enabled: string[];
    adminAllowlist: string[];
  } {
    const commands = this.channelConfig?.commands;
    return {
      enabled: commands?.enabled ?? [],
      adminAllowlist: commands?.admin_allowlist ?? [],
    };
  }

  private parseCommand(text?: string): { name: string; args: string[] } {
    const tokens = (text ?? '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return { name: 'help', args: [] };
    }
    const primary = tokens[0]?.toLowerCase() ?? '';
    const secondary = tokens[1]?.toLowerCase();
    if (primary === 'config' && secondary === 'show') {
      return { name: 'config.show', args: tokens.slice(2) };
    }
    if (primary === 'session' && (secondary === 'reset' || secondary === 'new')) {
      return { name: 'session.reset', args: tokens.slice(2) };
    }
    if (primary === 'context') {
      return { name: 'context', args: tokens.slice(1) };
    }
    return { name: primary, args: tokens.slice(1) };
  }

  private isCommandEnabled(command: string, enabled: string[]): boolean {
    if (enabled.includes(command)) return true;
    if (command.startsWith('context.') || command === 'context') {
      return enabled.includes('context');
    }
    if (command === 'session.reset') {
      return enabled.includes('session.reset') || enabled.includes('session');
    }
    return false;
  }

  private async dispatchCommandMessage(params: {
    text: string;
    userId: string;
    conversationId: string;
    isDm: boolean;
    teamId?: string;
  }): Promise<void> {
    if (!this.config) return;
    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), {
      channel: this.channelId,
      channelMessageId: randomUUID(),
      sender: {
        id: params.userId,
        isAllowed: true,
      },
      conversation: {
        id: params.conversationId,
        type: params.isDm ? 'dm' : 'channel',
      },
      content: {
        text: params.text,
      },
      metadata: {
        teamId: params.teamId,
        source: 'slash_command',
      },
    });
  }

  private async isCommandAuthorized(userId: string, isDm: boolean): Promise<boolean> {
    if (!this.app) return false;
    const { adminAllowlist } = this.getCommandConfig();
    if (adminAllowlist.includes(userId)) return true;
    if (isDm) return false;

    try {
      const response = await this.app.client.users.info({ user: userId });
      const user = response.user as
        | { is_admin?: boolean; is_owner?: boolean; is_primary_owner?: boolean }
        | undefined;
      return Boolean(user?.is_admin || user?.is_owner || user?.is_primary_owner);
    } catch {
      return false;
    }
  }

  private async handleSlashCommand(
    command: {
      text?: string;
      user_id: string;
      channel_id: string;
      team_id?: string;
    },
    respond: (message: {
      text: string;
      response_type?: 'ephemeral' | 'in_channel';
    }) => Promise<void> | void
  ): Promise<void> {
    if (!this.channelConfig) return;
    const { enabled } = this.getCommandConfig();
    const isDm = command.channel_id.startsWith('D');
    if (enabled.length === 0) {
      await this.logCommandAudit({
        command: 'unknown',
        userId: command.user_id,
        scope: isDm ? 'dm' : 'channel',
        serverId: command.team_id,
        conversationId: command.channel_id,
        outcome: 'denied',
        reason: 'Commands disabled',
      });
      await respond({ text: 'Commands are disabled for this channel.' });
      return;
    }

    const parsed = this.parseCommand(command.text);
    if (!this.isCommandEnabled(parsed.name, enabled)) {
      await this.logCommandAudit({
        command: parsed.name,
        userId: command.user_id,
        scope: isDm ? 'dm' : 'channel',
        serverId: command.team_id,
        conversationId: command.channel_id,
        outcome: 'denied',
        reason: 'Command not enabled',
      });
      await respond({ text: 'Command is not enabled.', response_type: 'ephemeral' });
      return;
    }

    const authorized = await this.isCommandAuthorized(command.user_id, isDm);
    if (!authorized) {
      await this.logCommandAudit({
        command: parsed.name,
        userId: command.user_id,
        scope: isDm ? 'dm' : 'channel',
        serverId: command.team_id,
        conversationId: command.channel_id,
        outcome: 'denied',
        reason: 'Permission denied',
      });
      await respond({ text: 'Permission denied for this command.', response_type: 'ephemeral' });
      return;
    }

    if (parsed.name === 'session.reset') {
      await this.dispatchCommandMessage({
        text: '/reset',
        userId: command.user_id,
        conversationId: command.channel_id,
        isDm,
        teamId: command.team_id,
      });
      await this.logCommandAudit({
        command: parsed.name,
        userId: command.user_id,
        scope: isDm ? 'dm' : 'channel',
        serverId: command.team_id,
        conversationId: command.channel_id,
        outcome: 'allowed',
      });
      await respond({ text: '✅ New session started.', response_type: 'ephemeral' });
      return;
    }

    if (parsed.name === 'context') {
      const action = parsed.args[0]?.toLowerCase() ?? 'status';
      const normalizedAction =
        action === 'enable'
          ? 'on'
          : action === 'disable'
            ? 'off'
            : action === 'default'
              ? 'auto'
              : action;
      const commandText =
        normalizedAction === 'status' ? '/context status' : `/context ${normalizedAction}`;
      await this.dispatchCommandMessage({
        text: commandText,
        userId: command.user_id,
        conversationId: command.channel_id,
        isDm,
        teamId: command.team_id,
      });
      await this.logCommandAudit({
        command: `context.${normalizedAction}`,
        userId: command.user_id,
        scope: isDm ? 'dm' : 'channel',
        serverId: command.team_id,
        conversationId: command.channel_id,
        outcome: 'allowed',
      });
      await respond({ text: '✅ Context command sent.', response_type: 'ephemeral' });
      return;
    }

    const responseText = this.buildCommandResponse(parsed.name, isDm, command.team_id);
    await this.logCommandAudit({
      command: parsed.name,
      userId: command.user_id,
      scope: isDm ? 'dm' : 'channel',
      serverId: command.team_id,
      conversationId: command.channel_id,
      outcome: 'allowed',
    });
    await respond({ text: responseText, response_type: 'ephemeral' });
  }

  private buildCommandResponse(name: string, isDm: boolean, teamId?: string): string {
    if (!this.channelConfig || !this.config) return 'Channel configuration unavailable.';
    const { enabled } = this.getCommandConfig();

    if (name === 'status') {
      return [
        'Nachos Slack channel is running.',
        `Security mode: ${this.config.securityMode}.`,
        `Commands enabled: ${enabled.join(', ') || 'none'}.`,
      ].join('\n');
    }

    if (name === 'config.show') {
      if (isDm) {
        const dmPolicy = resolveDmPolicy(this.channelConfig.dm);
        if (!dmPolicy) return 'DM policy is not configured.';
        return [
          'DM policy:',
          `- Pairing enabled: ${dmPolicy.pairing ? 'yes' : 'no'}.`,
          `- User allowlist: ${dmPolicy.userAllowlist.join(', ') || 'empty'}.`,
        ].join('\n');
      }

      if (!teamId) return 'Workspace context is missing.';
      const serverConfig = findServerConfig(this.channelConfig.servers, teamId);
      if (!serverConfig) return 'No server config found for this workspace.';
      const groupPolicy = resolveGroupPolicy(serverConfig);
      return [
        'Server policy:',
        `- Mention gating: ${groupPolicy.mentionGating ? 'enabled' : 'disabled'}.`,
        `- Channel allowlist: ${groupPolicy.channelIds.join(', ') || 'empty'}.`,
        `- User allowlist: ${groupPolicy.userAllowlist.join(', ') || 'empty'}.`,
      ].join('\n');
    }

    return [
      'Available commands:',
      '- /nachos status',
      '- /nachos help',
      '- /nachos config show',
      '- /nachos session reset',
      '- /nachos context on|off|status|auto',
    ].join('\n');
  }

  private async logCommandAudit(params: {
    command: string;
    userId: string;
    scope: 'dm' | 'channel';
    serverId?: string;
    conversationId?: string;
    outcome: 'allowed' | 'denied';
    reason?: string;
  }): Promise<void> {
    if (!this.config) return;
    await this.config.bus.publish(TOPICS.audit.log, {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      instanceId: `channel-${this.channelId}`,
      userId: params.userId,
      sessionId: params.conversationId ?? params.userId,
      channel: this.channelId,
      eventType: 'channel_command',
      action: 'channel.command',
      resource: params.command,
      outcome: params.outcome,
      reason: params.reason,
      securityMode: this.config.securityMode,
      details: {
        scope: params.scope,
        serverId: params.serverId,
        conversationId: params.conversationId,
      },
    });
  }
}
