import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { WhatsappChannelConfig } from '@nachos/config';
import {
  TOPICS,
  resolveDmPolicy,
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
import {
  createLogger,
  createConfigError,
  createInvalidStateError,
  validateChannelInboundMessage,
} from '@nachos/types';
import { shouldAllowDm } from '@nachos/utils';

const logger = createLogger('whatsapp-channel');

/** Maps WhatsApp media message types to attachment type strings. */
const WHATSAPP_MEDIA_TYPE_MAP: Record<string, string> = {
  image: 'image',
  document: 'file',
  video: 'video',
  audio: 'audio',
  sticker: 'image',
};

interface WhatsAppWebhookMessageText {
  body?: string;
}

interface WhatsAppWebhookMediaInfo {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

interface WhatsAppWebhookMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: WhatsAppWebhookMessageText;
  image?: WhatsAppWebhookMediaInfo;
  document?: WhatsAppWebhookMediaInfo;
  video?: WhatsAppWebhookMediaInfo;
  audio?: WhatsAppWebhookMediaInfo;
  sticker?: WhatsAppWebhookMediaInfo;
}

interface WhatsAppWebhookContactProfile {
  name?: string;
}

interface WhatsAppWebhookContact {
  wa_id?: string;
  profile?: WhatsAppWebhookContactProfile;
}

interface WhatsAppWebhookMetadata {
  phone_number_id?: string;
  display_phone_number?: string;
}

interface WhatsAppWebhookValue {
  messaging_product?: string;
  metadata?: WhatsAppWebhookMetadata;
  contacts?: WhatsAppWebhookContact[];
  messages?: WhatsAppWebhookMessage[];
}

interface WhatsAppWebhookChange {
  field?: string;
  value?: WhatsAppWebhookValue;
}

interface WhatsAppWebhookEntry {
  id?: string;
  changes?: WhatsAppWebhookChange[];
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

interface StatusEvent {
  sessionId: string;
  status: 'thinking' | 'tool' | 'done' | 'error';
  channelId: string;
  channelMessageId?: string;
  toolName?: string;
}

export class WhatsappChannelAdapter implements ChannelAdapter {
  readonly channelId = 'whatsapp';
  readonly name = 'WhatsApp';

  private config?: ChannelAdapterConfig;
  private server?: ReturnType<typeof createServer>;
  private token?: string;
  private phoneNumberId?: string;
  private verifyToken?: string;
  private webhookPath = '/whatsapp/webhook';
  private apiVersion = 'v20.0';
  private appSecret?: string;
  private securityMode = process.env.SECURITY_MODE ?? 'standard';
  private pairingStore = createPairingStore('whatsapp', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;
  private readReceiptSent: Set<string> = new Set();

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    const channelConfig = (config.config ?? {}) as WhatsappChannelConfig;

    this.token = channelConfig.token ?? config.secrets.WHATSAPP_TOKEN;
    this.phoneNumberId = channelConfig.phone_number_id ?? config.secrets.WHATSAPP_PHONE_NUMBER_ID;
    this.verifyToken = channelConfig.verify_token ?? config.secrets.WHATSAPP_VERIFY_TOKEN;
    this.webhookPath = channelConfig.webhook_path ?? '/whatsapp/webhook';
    this.apiVersion = channelConfig.api_version ?? 'v20.0';
    this.appSecret = channelConfig.app_secret ?? config.secrets.WHATSAPP_APP_SECRET;
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw createInvalidStateError('WhatsApp adapter not initialized', {
        component: 'whatsapp-channel',
      });
    }
    if (!this.token || !this.phoneNumberId || !this.verifyToken) {
      throw createConfigError(
        'WhatsApp adapter requires token, phone_number_id, and verify_token',
        { component: 'whatsapp-channel' }
      );
    }

    if (!this.appSecret) {
      logger.warn(
        'appSecret is not configured. Webhook signature verification is disabled. Set WHATSAPP_APP_SECRET to enable signature verification.'
      );
    }

    const port = Number(process.env.WHATSAPP_HTTP_PORT ?? 3002);

    this.server = createServer(async (req, res) => {
      await this.handleWebhookRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(port, () => resolve());
    });

    await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
      await this.sendMessage(payload as OutboundMessage);
    });

    // Subscribe to status events for read receipts (typing indicator equivalent)
    await this.subscribeToStatusEvents();
  }

  private async subscribeToStatusEvents(): Promise<void> {
    if (!this.config) return;

    const handler = async (event: unknown) => this.handleStatusEvent(event as StatusEvent);
    await this.config.bus.subscribe(TOPICS.status.thinking('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.tool('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.done('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.error('*'), handler);
  }

  private async handleStatusEvent(event: StatusEvent): Promise<void> {
    if (!event.channelId) return;

    // WhatsApp does not support a true typing indicator via the Cloud API.
    // The best equivalent is marking messages as "read" so the user sees
    // blue checkmarks, indicating the bot is processing.
    if (event.status === 'thinking' && event.channelMessageId) {
      // Only send read receipt once per message
      if (this.readReceiptSent.has(event.channelMessageId)) return;
      this.readReceiptSent.add(event.channelMessageId);

      // Prevent unbounded growth of the set
      if (this.readReceiptSent.size > 1000) {
        const iter = this.readReceiptSent.values();
        const first = iter.next().value;
        if (first !== undefined) {
          this.readReceiptSent.delete(first);
        }
      }

      await this.markMessageAsRead(event.channelMessageId);
    }
  }

  /**
   * Mark a WhatsApp message as read (blue checkmarks).
   * This is the closest equivalent to a typing indicator in the WhatsApp Cloud API.
   */
  private async markMessageAsRead(messageId: string): Promise<void> {
    if (!this.token || !this.phoneNumberId) return;

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
    } catch (error) {
      logger.warn({ messageId, err: error }, 'Failed to mark message as read');
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.server = undefined;
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.token || !this.phoneNumberId) {
      throw createInvalidStateError('WhatsApp adapter not initialized', {
        component: 'whatsapp-channel',
      });
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    // Send a read receipt before replying (best-effort typing indication)
    if (message.replyToMessageId) {
      await this.markMessageAsRead(message.replyToMessageId);
    }

    // Send text message
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: message.conversationId,
      type: 'text',
      text: { body: message.content.text },
    };

    if (message.replyToMessageId) {
      payload.context = { message_id: message.replyToMessageId };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseBody = (await response.json()) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number };
      };

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: responseBody.error?.code
              ? `whatsapp_${responseBody.error.code}`
              : 'whatsapp_api_error',
            message: responseBody.error?.message ?? 'WhatsApp API error',
            retryable: response.status >= 500,
          },
        };
      }

      const textMessageId = responseBody.messages?.[0]?.id;

      // Send any media attachments
      const attachments = message.content.attachments ?? [];
      for (const attachment of attachments) {
        if (!attachment) continue;
        await this.sendOutboundMedia(message.conversationId, attachment, message.replyToMessageId);
      }

      return {
        success: true,
        messageId: textMessageId,
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        success: false,
        error: {
          code: err.code ?? 'whatsapp_error',
          message: err.message,
          retryable: true,
        },
      };
    }
  }

  /**
   * Send a media attachment as a WhatsApp media message.
   */
  private async sendOutboundMedia(
    to: string,
    attachment: { type: string; data: unknown; name?: string },
    replyToMessageId?: string
  ): Promise<void> {
    if (!this.token || !this.phoneNumberId) return;

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    // Determine the WhatsApp media type
    let waMediaType: string;
    if (attachment.type === 'image' || attachment.type === 'photo') {
      waMediaType = 'image';
    } else if (attachment.type === 'video') {
      waMediaType = 'video';
    } else if (attachment.type === 'audio') {
      waMediaType = 'audio';
    } else {
      waMediaType = 'document';
    }

    const data = attachment.data;

    // Only support URL-based media sending via WhatsApp Cloud API
    if (typeof data !== 'string' || !(data.startsWith('http://') || data.startsWith('https://'))) {
      logger.warn(
        { attachmentType: attachment.type },
        'WhatsApp outbound media requires a URL; skipping non-URL attachment'
      );
      return;
    }

    const mediaPayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: waMediaType,
    };

    const mediaObj: Record<string, string> = {
      link: data,
    };
    if (attachment.name) {
      if (waMediaType === 'document') {
        mediaObj.filename = attachment.name;
      }
      mediaObj.caption = attachment.name;
    }
    mediaPayload[waMediaType] = mediaObj;

    if (replyToMessageId) {
      mediaPayload.context = { message_id: replyToMessageId };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mediaPayload),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: { message?: string } };
        logger.warn(
          { to, mediaType: waMediaType, err: errorBody.error?.message },
          'Failed to send outbound media'
        );
      }
    } catch (error) {
      logger.warn({ to, mediaType: waMediaType, err: error }, 'Failed to send outbound media');
    }
  }

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.server || !this.server.listening) {
      return 'unhealthy';
    }
    return 'healthy';
  }

  private async handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== this.webhookPath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token && token === this.verifyToken && challenge) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(challenge);
        return;
      }

      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Verification failed' }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    let rawBody = '';
    try {
      rawBody = await this.readRequestBody(req);
    } catch {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }

    if (!rawBody) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Empty body' }));
      return;
    }

    if (this.appSecret) {
      const signatureHeader = req.headers['x-hub-signature-256'];
      if (typeof signatureHeader !== 'string' || !this.verifySignature(rawBody, signatureHeader)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }
    } else if (this.securityMode === 'strict') {
      logger.error('Rejecting unsigned webhook — appSecret not configured in strict security mode');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook signature verification required in strict mode' }));
      return;
    }

    let payload: WhatsAppWebhookPayload | null = null;
    try {
      payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    await this.handleWebhookPayload(payload);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }

  private verifySignature(rawBody: string, signatureHeader: string): boolean {
    const expected = signatureHeader.replace('sha256=', '');
    const hash = createHmac('sha256', this.appSecret ?? '')
      .update(rawBody)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  private async readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalLength = 0;
      const maxLength = 1_000_000;

      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > maxLength) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', (err) => reject(err));
    });
  }

  private async handleWebhookPayload(payload: WhatsAppWebhookPayload): Promise<void> {
    if (!this.config) return;

    const channelConfig = (this.config.config ?? {}) as WhatsappChannelConfig;
    const dmPolicy = resolveDmPolicy(channelConfig.dm) ?? this.config.dmPolicy;
    if (!dmPolicy) return;

    const entries = payload.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        const value = change.value;
        if (!value?.messages || value.messages.length === 0) continue;

        const contactName = value.contacts?.[0]?.profile?.name;
        const metadata = value.metadata;

        for (const message of value.messages) {
          if (!message.from || !message.id) continue;

          const messageType = message.type ?? 'text';
          const isTextMessage = messageType === 'text';
          const isMediaMessage = messageType in WHATSAPP_MEDIA_TYPE_MAP;

          if (!isTextMessage && !isMediaMessage) continue;

          const textBody = isTextMessage ? (message.text?.body ?? '') : '';
          const caption = isMediaMessage ? this.extractMediaCaption(message, messageType) : '';
          const pairingCheckText = isTextMessage ? textBody : caption;

          // Handle pairing
          if (dmPolicy.pairing) {
            const command = parsePairingCommand(pairingCheckText);
            if (command) {
              if (this.pairingToken && command.token !== this.pairingToken) {
                await this.sendMessage({
                  channel: this.channelId,
                  conversationId: message.from,
                  content: { text: 'Pairing token invalid.' },
                });
                continue;
              }
              await this.pairingStore.setPaired(message.from);
              await this.sendMessage({
                channel: this.channelId,
                conversationId: message.from,
                content: { text: 'Pairing successful. You can now message the assistant.' },
              });
              continue;
            }
          }

          const allowed = await shouldAllowDm(
            message.from,
            dmPolicy.userAllowlist,
            dmPolicy.pairing ?? false,
            async (id) => this.pairingStore.isPaired(id)
          );

          if (!allowed) continue;

          // Mark message as read (typing indication equivalent)
          await this.markMessageAsRead(message.id);

          // Build inbound message
          let contentText: string;
          let attachments:
            | Array<{ type: string; url: string; name?: string; mimeType?: string }>
            | undefined;

          if (isMediaMessage) {
            const mediaInfo = this.extractMediaInfo(message, messageType);
            contentText = caption || `[${messageType}]`;

            if (mediaInfo?.id) {
              const mediaUrl = await this.getMediaUrl(mediaInfo.id);
              if (mediaUrl) {
                attachments = [
                  {
                    type: WHATSAPP_MEDIA_TYPE_MAP[messageType] ?? 'file',
                    url: mediaUrl,
                    name: mediaInfo.filename,
                    mimeType: mediaInfo.mime_type,
                  },
                ];
              }
            }
          } else {
            contentText = textBody;
          }

          const inbound = {
            channel: this.channelId,
            channelMessageId: message.id,
            sender: {
              id: message.from,
              name: contactName,
              isAllowed: true,
            },
            conversation: {
              id: message.from,
              type: 'dm' as const,
            },
            content: {
              text: contentText,
              attachments: attachments && attachments.length > 0 ? attachments : undefined,
            },
            metadata: {
              timestamp: message.timestamp,
              phoneNumberId: metadata?.phone_number_id,
              displayPhoneNumber: metadata?.display_phone_number,
              mediaType: isMediaMessage ? messageType : undefined,
            },
          };

          const validation = validateChannelInboundMessage(inbound);
          if (!validation.success) {
            logger.warn({ errors: validation.errors }, 'Dropping invalid inbound message');
            continue;
          }

          await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
        }
      }
    }
  }

  /**
   * Extract the media info object from a WhatsApp webhook message based on type.
   */
  private extractMediaInfo(
    message: WhatsAppWebhookMessage,
    mediaType: string
  ): WhatsAppWebhookMediaInfo | undefined {
    switch (mediaType) {
      case 'image':
        return message.image;
      case 'document':
        return message.document;
      case 'video':
        return message.video;
      case 'audio':
        return message.audio;
      case 'sticker':
        return message.sticker;
      default:
        return undefined;
    }
  }

  /**
   * Extract caption from a media message.
   */
  private extractMediaCaption(message: WhatsAppWebhookMessage, mediaType: string): string {
    const mediaInfo = this.extractMediaInfo(message, mediaType);
    return mediaInfo?.caption ?? '';
  }

  /**
   * Get the download URL for a WhatsApp media object by its ID.
   * Uses the WhatsApp Cloud API: GET /{media-id} to get the URL.
   */
  private async getMediaUrl(mediaId: string): Promise<string | undefined> {
    if (!this.token) return undefined;

    const url = `https://graph.facebook.com/${this.apiVersion}/${mediaId}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        logger.warn({ mediaId, status: response.status }, 'Failed to get media URL from WhatsApp');
        return undefined;
      }

      const body = (await response.json()) as { url?: string };
      return body.url;
    } catch (error) {
      logger.warn({ mediaId, err: error }, 'Failed to get media URL from WhatsApp');
      return undefined;
    }
  }
}
