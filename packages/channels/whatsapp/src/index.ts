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
import { validateChannelInboundMessage } from '@nachos/types';
import { shouldAllowDm } from '@nachos/utils';

interface WhatsAppWebhookMessageText {
  body?: string;
}

interface WhatsAppWebhookMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: WhatsAppWebhookMessageText;
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
  private pairingStore = createPairingStore('whatsapp', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;

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
      throw new Error('WhatsApp adapter not initialized');
    }
    if (!this.token || !this.phoneNumberId || !this.verifyToken) {
      throw new Error('WhatsApp adapter requires token, phone_number_id, and verify_token');
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
      throw new Error('WhatsApp adapter not initialized');
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
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

      return {
        success: true,
        messageId: responseBody.messages?.[0]?.id,
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
          if (message.type !== 'text') continue;
          if (!message.from || !message.id) continue;

          if (dmPolicy.pairing) {
            const command = parsePairingCommand(message.text?.body ?? '');
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
              text: message.text?.body ?? '',
            },
            metadata: {
              timestamp: message.timestamp,
              phoneNumberId: metadata?.phone_number_id,
              displayPhoneNumber: metadata?.display_phone_number,
            },
          };

          const validation = validateChannelInboundMessage(inbound);
          if (!validation.success) {
            console.warn('[WhatsApp] Dropping invalid inbound message', validation.errors);
            continue;
          }

          await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
        }
      }
    }
  }
}
