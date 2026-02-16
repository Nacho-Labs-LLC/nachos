/**
 * Channel adapter base helpers
 */

import type { INachosBusClient, MessageEnvelope } from '@nachos/bus';
import { TOPICS } from '@nachos/bus';
import type { ChannelBus } from '@nachos/types';

function inferMessageTypeFromTopic(topic: string): string | undefined {
  if (topic.startsWith('nachos.channel.') && topic.endsWith('.inbound')) {
    return 'channel.inbound';
  }
  if (topic.startsWith('nachos.channel.') && topic.endsWith('.outbound')) {
    return 'channel.outbound';
  }
  return undefined;
}

export function createChannelBus(client: INachosBusClient): ChannelBus {
  return {
    publish: (topic, payload) => {
      const messageType = inferMessageTypeFromTopic(topic);
      if (messageType) {
        client.publish(topic, payload, { type: messageType });
        return;
      }
      client.publish(topic, payload);
    },
    subscribe: async <T>(topic: string, handler: (payload: T) => void | Promise<void>) =>
      client.subscribe<T>(topic, async (msg: MessageEnvelope<T>) => {
        await handler(msg.payload);
      }),
  };
}

export { TOPICS };

export { resolveDmPolicy, resolveGroupPolicy, findServerConfig } from './policy.js';

export { createPairingStore, parsePairingCommand } from './pairing.js';
