import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
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
import { randomUUID } from 'node:crypto';
import {
  createDiscordStatusReactionController,
  resolveToolStatusEmoji,
  DISCORD_STATUS_EMOJIS,
  type StatusReactionController,
} from './status-reactions.js';

interface StatusEvent {
  sessionId: string;
  status: 'thinking' | 'tool' | 'done' | 'error';
  channelId: string;
  channelMessageId?: string;
  toolName?: string;
}

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly channelId = 'discord';
  readonly name = 'Discord';

  private config?: ChannelAdapterConfig;
  private client?: Client;
  private botUserId?: string;
  private channelConfig?: DiscordChannelConfig;
  private pairingStore = createPairingStore('discord', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;
  private statusControllers: Map<string, StatusReactionController> = new Map();

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    this.channelConfig = (config.config ?? {}) as DiscordChannelConfig;

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

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== 'nachos') return;
      await this.handleCommandInteraction(interaction);
    });
  }

  async start(): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Discord adapter not initialized');
    }

    const channelConfig = this.config.config as DiscordChannelConfig;
    const token = this.resolveDiscordToken(channelConfig);
    if (!token) {
      throw new Error('Discord token is required');
    }

    await this.client.login(token);
    this.botUserId = this.client.user?.id;

    await this.registerSlashCommands();

    await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
      await this.sendMessage(payload as OutboundMessage);
    });

    if (this.channelConfig?.status_emojis?.enabled) {
      await this.subscribeToStatusEvents();
    }
  }

  private async subscribeToStatusEvents(): Promise<void> {
    if (!this.config) return;
    // Subscribe to all sessions using '*' wildcard — controllers are keyed by channelMessageId
    // so each message's reactions are managed independently regardless of sessionId.
    const handler = async (event: unknown) => this.handleStatusEvent(event as StatusEvent);
    await this.config.bus.subscribe(TOPICS.status.thinking('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.tool('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.done('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.error('*'), handler);
  }

  private async handleStatusEvent(event: StatusEvent): Promise<void> {
    if (!event.channelMessageId || !event.channelId || !this.client) return;

    let controller = this.statusControllers.get(event.channelMessageId);
    if (!controller) {
      controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: event.channelId,
        messageId: event.channelMessageId,
        client: this.client,
      });
      this.statusControllers.set(event.channelMessageId, controller);
    }

    if (event.status === 'thinking') {
      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
    } else if (event.status === 'tool') {
      await controller.setPhase(resolveToolStatusEmoji(event.toolName));
    } else if (event.status === 'done') {
      await controller.setTerminal(DISCORD_STATUS_EMOJIS.DONE);
      this.statusControllers.delete(event.channelMessageId);
    } else if (event.status === 'error') {
      await controller.setTerminal(DISCORD_STATUS_EMOJIS.ERROR);
      this.statusControllers.delete(event.channelMessageId);
    }
  }

  private resolveDiscordToken(channelConfig: DiscordChannelConfig): string | undefined {
    const tokenFromConfig = channelConfig.token?.trim();
    if (tokenFromConfig) {
      const envMatch = tokenFromConfig.match(/^\$\{([A-Z0-9_]+)\}$/);
      if (envMatch && envMatch[1]) {
        return process.env[envMatch[1]] ?? this.config?.secrets.DISCORD_BOT_TOKEN;
      }
      return tokenFromConfig;
    }

    return this.config?.secrets.DISCORD_BOT_TOKEN;
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

      const files = (message.content.attachments ?? [])
        .map((attachment) => {
          if (!attachment) return null;

          let data: Buffer;
          if (typeof attachment.data === 'string') {
            data = Buffer.from(attachment.data, 'base64');
          } else if (attachment.data instanceof Uint8Array) {
            data = Buffer.from(attachment.data);
          } else {
            data = Buffer.from(String(attachment.data ?? ''));
          }

          return {
            attachment: data,
            name: attachment.name ?? 'attachment',
          };
        })
        .filter((file): file is { attachment: Buffer; name: string } => Boolean(file));

      const response = await (
        channel as { send: (options: unknown) => Promise<{ id: string }> }
      ).send({
        content: message.content.text,
        files: files.length > 0 ? files : undefined,
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
    console.log(`[Discord] handleMessage from=${message.author?.tag} bot=${message.author?.bot} content="${(message.content ?? '').slice(0, 80)}"`);
    if (!this.config) { console.log('[Discord] handleMessage: no config, dropping'); return; }

    // Bot message filtering: drop by default, allow if configured
    if (message.author?.bot) {
      const channelCfg =
        this.channelConfig ?? ((this.config.config ?? {}) as DiscordChannelConfig);
      if (!channelCfg.allow_bots) return;
      // If bot_allowlist is set, only allow listed bot IDs
      if (
        channelCfg.bot_allowlist &&
        channelCfg.bot_allowlist.length > 0 &&
        !channelCfg.bot_allowlist.includes(message.author.id)
      ) {
        return;
      }
      // Prevent self-reply loops: always ignore own messages
      if (message.author.id === this.botUserId) return;
    }

    const channelConfig =
      this.channelConfig ?? ((this.config.config ?? {}) as DiscordChannelConfig);
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

    console.log(`[Discord] Message passed filters, publishing inbound from ${userId}`);
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

  private async registerSlashCommands(): Promise<void> {
    if (!this.client || !this.channelConfig) return;
    const { enabled } = this.getCommandConfig();
    if (enabled.length === 0) return;

    const commands = [
      {
        name: 'nachos',
        description: 'Nachos channel commands',
        options: [
          {
            type: 1,
            name: 'status',
            description: 'Show channel status',
          },
          {
            type: 1,
            name: 'help',
            description: 'Show available commands',
          },
          {
            type: 2,
            name: 'config',
            description: 'Show configuration info',
            options: [
              {
                type: 1,
                name: 'show',
                description: 'Show current allowlists and gating',
              },
            ],
          },
          {
            type: 2,
            name: 'session',
            description: 'Session management commands',
            options: [
              {
                type: 1,
                name: 'reset',
                description: 'Start a fresh session',
              },
            ],
          },
          {
            type: 2,
            name: 'context',
            description: 'Context management controls',
            options: [
              {
                type: 1,
                name: 'on',
                description: 'Enable context management for this session',
              },
              {
                type: 1,
                name: 'off',
                description: 'Disable context management for this session',
              },
              {
                type: 1,
                name: 'status',
                description: 'Show context management status',
              },
              {
                type: 1,
                name: 'auto',
                description: 'Reset to default context management behavior',
              },
            ],
          },
          {
            type: 2,
            name: 'approve',
            description: 'Tool approval commands',
            options: [
              {
                type: 1,
                name: 'id',
                description: 'Approve a specific tool request by ID',
                options: [
                  {
                    type: 3,
                    name: 'request_id',
                    description: 'The approval request ID',
                    required: true,
                  },
                ],
              },
              {
                type: 1,
                name: 'all',
                description: 'Approve all pending tool requests',
              },
            ],
          },
          {
            type: 2,
            name: 'deny',
            description: 'Deny a tool request',
            options: [
              {
                type: 1,
                name: 'id',
                description: 'Deny a specific tool request by ID',
                options: [
                  {
                    type: 3,
                    name: 'request_id',
                    description: 'The approval request ID',
                    required: true,
                  },
                  {
                    type: 3,
                    name: 'reason',
                    description: 'Reason for denial',
                    required: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    try {
      if (this.client.application) {
        await this.client.application.commands.set(commands);
      }
    } catch (error) {
      console.warn('[Discord] Failed to register slash commands:', error);
    }
  }

  private async handleCommandInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.config || !this.channelConfig) return;
    const { enabled } = this.getCommandConfig();
    if (enabled.length === 0) {
      await this.logCommandAudit({
        command: 'unknown',
        userId: interaction.user.id,
        scope: interaction.guildId ? 'channel' : 'dm',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'denied',
        reason: 'Commands disabled',
      });
      await interaction.reply({
        content: 'Commands are disabled for this channel.',
        ephemeral: true,
      });
      return;
    }

    const commandName = this.resolveCommandName(interaction);
    if (!this.isCommandEnabled(commandName, enabled)) {
      await this.logCommandAudit({
        command: commandName,
        userId: interaction.user.id,
        scope: interaction.guildId ? 'channel' : 'dm',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'denied',
        reason: 'Command not enabled',
      });
      await interaction.reply({ content: 'Command is not enabled.', ephemeral: true });
      return;
    }

    const isDm = !interaction.guildId;
    const authorized = await this.isCommandAuthorized(interaction, isDm);
    if (!authorized) {
      await this.logCommandAudit({
        command: commandName,
        userId: interaction.user.id,
        scope: isDm ? 'dm' : 'channel',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'denied',
        reason: 'Permission denied',
      });
      await interaction.reply({ content: 'Permission denied for this command.', ephemeral: true });
      return;
    }

    if (commandName === 'session.reset') {
      await this.dispatchCommandMessage({
        text: '/reset',
        userId: interaction.user.id,
        conversationId: interaction.channelId,
        isDm,
        guildId: interaction.guildId ?? undefined,
      });
      await this.logCommandAudit({
        command: commandName,
        userId: interaction.user.id,
        scope: isDm ? 'dm' : 'channel',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'allowed',
      });
      await interaction.reply({ content: '✅ New session started.', ephemeral: true });
      return;
    }

    if (commandName.startsWith('context.')) {
      const action = commandName.split('.')[1] ?? 'status';
      const commandText = action === 'status' ? '/context status' : `/context ${action}`;
      await this.dispatchCommandMessage({
        text: commandText,
        userId: interaction.user.id,
        conversationId: interaction.channelId,
        isDm,
        guildId: interaction.guildId ?? undefined,
      });
      await this.logCommandAudit({
        command: commandName,
        userId: interaction.user.id,
        scope: isDm ? 'dm' : 'channel',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'allowed',
      });
      await interaction.reply({ content: '✅ Context command sent.', ephemeral: true });
      return;
    }

    // /nachos approve id <request_id> or /nachos approve all
    if (commandName === 'approve.id' || commandName === 'approve.all') {
      let commandText: string;
      if (commandName === 'approve.all') {
        commandText = '/approve-all';
      } else {
        const requestId = interaction.options.getString('request_id', true);
        commandText = `/approve ${requestId}`;
      }
      await this.dispatchCommandMessage({
        text: commandText,
        userId: interaction.user.id,
        conversationId: interaction.channelId,
        isDm,
        guildId: interaction.guildId ?? undefined,
      });
      await this.logCommandAudit({
        command: commandName,
        userId: interaction.user.id,
        scope: isDm ? 'dm' : 'channel',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'allowed',
      });
      await interaction.reply({ content: '✅ Approval command sent.', ephemeral: true });
      return;
    }

    // /nachos deny id <request_id> [reason]
    if (commandName === 'deny.id') {
      const requestId = interaction.options.getString('request_id', true);
      const reason = interaction.options.getString('reason') ?? '';
      const commandText = reason ? `/deny ${requestId} ${reason}` : `/deny ${requestId}`;
      await this.dispatchCommandMessage({
        text: commandText,
        userId: interaction.user.id,
        conversationId: interaction.channelId,
        isDm,
        guildId: interaction.guildId ?? undefined,
      });
      await this.logCommandAudit({
        command: commandName,
        userId: interaction.user.id,
        scope: isDm ? 'dm' : 'channel',
        serverId: interaction.guildId ?? undefined,
        conversationId: interaction.channelId,
        outcome: 'allowed',
      });
      await interaction.reply({ content: '✅ Deny command sent.', ephemeral: true });
      return;
    }

    const responseText = this.buildCommandResponse(
      commandName,
      isDm,
      interaction.guildId ?? undefined
    );
    await this.logCommandAudit({
      command: commandName,
      userId: interaction.user.id,
      scope: isDm ? 'dm' : 'channel',
      serverId: interaction.guildId ?? undefined,
      conversationId: interaction.channelId,
      outcome: 'allowed',
    });
    await interaction.reply({ content: responseText, ephemeral: true });
  }

  private resolveCommandName(interaction: ChatInputCommandInteraction): string {
    const sub = interaction.options.getSubcommand(false);
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'config' && sub === 'show') return 'config.show';
    if (group === 'session' && sub === 'reset') return 'session.reset';
    if (group === 'context' && sub) return `context.${sub.toLowerCase()}`;
    if (group === 'approve' && sub) return `approve.${sub.toLowerCase()}`;
    if (group === 'deny' && sub) return `deny.${sub.toLowerCase()}`;
    if (sub) return sub.toLowerCase();
    return 'help';
  }

  private isCommandEnabled(command: string, enabled: string[]): boolean {
    if (enabled.includes(command)) return true;
    if (command.startsWith('context.')) {
      return enabled.includes('context');
    }
    if (command === 'session.reset') {
      return enabled.includes('session.reset') || enabled.includes('session');
    }
    // approve/deny commands are always enabled when any commands are enabled
    if (command.startsWith('approve.') || command.startsWith('deny.')) {
      return true;
    }
    return false;
  }

  private async dispatchCommandMessage(params: {
    text: string;
    userId: string;
    conversationId: string;
    isDm: boolean;
    guildId?: string;
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
        guildId: params.guildId,
        source: 'slash_command',
      },
    });
  }

  private async isCommandAuthorized(
    interaction: ChatInputCommandInteraction,
    isDm: boolean
  ): Promise<boolean> {
    const { adminAllowlist } = this.getCommandConfig();
    const userId = interaction.user?.id;
    if (!userId) return false;
    if (adminAllowlist.includes(userId)) return true;
    if (isDm) return false;

    const permissions = interaction.memberPermissions;
    if (!permissions) return false;
    return (
      permissions.has(PermissionFlagsBits.Administrator) ||
      permissions.has(PermissionFlagsBits.ManageGuild)
    );
  }

  private buildCommandResponse(name: string, isDm: boolean, guildId?: string): string {
    if (!this.channelConfig || !this.config) return 'Channel configuration unavailable.';
    const { enabled } = this.getCommandConfig();

    if (name === 'status') {
      return [
        'Nachos Discord channel is running.',
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

      if (!guildId) return 'Guild context is missing.';
      const serverConfig = findServerConfig(this.channelConfig.servers, guildId);
      if (!serverConfig) return 'No server config found for this guild.';
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
      '/nachos status',
      '/nachos help',
      '/nachos config show',
      '/nachos session reset',
      '/nachos context on|off|status|auto',
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
