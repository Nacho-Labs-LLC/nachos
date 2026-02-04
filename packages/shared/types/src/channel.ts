/**
 * Channel adapter interfaces and types
 */

import type { ChannelInboundMessageType, ChannelOutboundMessageType, HealthStatusType } from './schemas.js';

export interface ChannelBus {
  publish<T>(topic: string, payload: T): void | Promise<void>;
  subscribe<T>(
    topic: string,
    handler: (payload: T) => void | Promise<void>
  ): Promise<unknown>;
}

export interface ChannelDMPolicy {
  userAllowlist: string[];
  pairing?: boolean;
}

export interface ChannelGroupPolicy {
  mentionGating: boolean;
  channelIds: string[];
  userAllowlist: string[];
}

export interface ChannelAdapterConfig {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  bus: ChannelBus;
  securityMode: 'strict' | 'standard' | 'permissive';
  dmPolicy?: ChannelDMPolicy;
  groupPolicy?: ChannelGroupPolicy;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface ChannelAdapter {
  readonly channelId: string;
  readonly name: string;

  initialize(config: ChannelAdapterConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  sendMessage(message: ChannelOutboundMessageType): Promise<SendResult>;
  healthCheck(): Promise<HealthStatusType>;
}

export type InboundMessage = ChannelInboundMessageType;
export type OutboundMessage = ChannelOutboundMessageType;
