#!/usr/bin/env node

import { createBusClient, TOPICS } from '@nachos/bus';
import { loadAndValidateConfig } from '@nachos/config';
import {
  validateLLMRequest,
  type LLMRequestType,
  type LLMResponseType,
  type LLMStreamChunkType,
  type AuditLogEntryType,
} from '@nachos/types';
import { randomUUID } from 'node:crypto';
import { createAdapterRegistry } from './adapters/registry.js';
import { ProviderError, type LLMProviderAdapter } from './adapters/types.js';
import { CooldownManager } from './cooldowns.js';
import { getRetryConfig, retryWithBackoff } from './retry.js';

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const INSTANCE_ID = process.env.INSTANCE_ID || 'llm-proxy';
const CONFIG_PATH = process.env.NACHOS_CONFIG;

const config = loadAndValidateConfig({ configPath: CONFIG_PATH });
const llmConfig = config.llm;

const cooldownManager = new CooldownManager(
  llmConfig.cooldowns?.initial_seconds ?? 60,
  llmConfig.cooldowns?.multiplier ?? 5,
  llmConfig.cooldowns?.max_seconds ?? 3600,
  llmConfig.cooldowns?.billing_initial_hours ?? 5,
  llmConfig.cooldowns?.billing_max_hours ?? 24
);

const retryConfig = getRetryConfig({
  attempts: llmConfig.retry?.attempts,
  minDelayMs: llmConfig.retry?.min_delay_ms,
  maxDelayMs: llmConfig.retry?.max_delay_ms,
  jitter: llmConfig.retry?.jitter,
});

const adapterRegistry = createAdapterRegistry(llmConfig);

const bus = createBusClient({
  servers: NATS_URL,
  name: 'llm-proxy',
});

function parseFallbackOrder(order?: string[]): Array<{ provider: string; model: string }> {
  if (!order || order.length === 0) return [];
  return order
    .map((entry) => {
      const [provider, model] = entry.split(':');
      if (!provider || !model) return null;
      return { provider, model };
    })
    .filter((entry): entry is { provider: string; model: string } => Boolean(entry));
}

function buildAttemptList(request: LLMRequestType): Array<{ provider: string; model: string }> {
  const primaryProvider = llmConfig.provider;
  const primaryModel = request.options?.model ?? llmConfig.model;
  const fallback = parseFallbackOrder(llmConfig.fallback_order);
  return [{ provider: primaryProvider, model: primaryModel }, ...fallback];
}

function getProfileList(provider: string): string[] {
  const profiles = llmConfig.profiles?.filter((profile) => profile.provider === provider) ?? [];
  const order = llmConfig.profile_order ?? profiles.map((profile) => profile.name);
  return order
    .filter((name) => profiles.some((profile) => profile.name === name))
    .filter((name) => !cooldownManager.isCooling(name));
}

function getApiKey(profileName: string): string | null {
  const profile = llmConfig.profiles?.find((item) => item.name === profileName);
  if (!profile) return null;
  return process.env[profile.api_key_env] ?? null;
}

async function emitAudit(
  event: Omit<AuditLogEntryType, 'id' | 'timestamp' | 'instanceId'>
): Promise<void> {
  if (!config.security?.audit?.enabled) return;

  const entry: AuditLogEntryType = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    instanceId: INSTANCE_ID,
    ...event,
  };

  bus.publish(TOPICS.audit.log, entry, { type: 'audit.log' });
}

async function emitMetrics(
  sessionId: string,
  provider: string,
  model: string,
  latencyMs: number,
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
): Promise<void> {
  await emitAudit({
    userId: 'unknown',
    sessionId,
    channel: 'internal',
    eventType: 'llm_request',
    action: 'llm.metrics',
    outcome: 'allowed',
    securityMode: config.security.mode,
    details: {
      provider,
      model,
      latencyMs,
      usage: usage
        ? {
            promptTokens: usage.promptTokens ?? 0,
            completionTokens: usage.completionTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          }
        : undefined,
    },
  });
}

async function emitFailoverEvent(
  request: LLMRequestType,
  attempt: { provider: string; model: string },
  reason: string
): Promise<void> {
  await emitAudit({
    userId: 'unknown',
    sessionId: request.sessionId,
    channel: 'internal',
    eventType: 'llm_request',
    action: 'llm.failover',
    outcome: 'allowed',
    securityMode: config.security.mode,
    details: {
      provider: attempt.provider,
      model: attempt.model,
      reason,
    },
  });
}

async function handleRequest(request: LLMRequestType): Promise<LLMResponseType> {
  const attempts = buildAttemptList(request);
  const hasFallback = attempts.length > 1;
  const maxTokens = request.options?.maxTokens ?? llmConfig.max_tokens;
  const temperature = request.options?.temperature ?? llmConfig.temperature;

  for (const attempt of attempts) {
    const adapter = adapterRegistry.getAdapter(attempt.provider) as LLMProviderAdapter | undefined;
    if (!adapter) {
      continue;
    }

    const profileList = getProfileList(attempt.provider);

    let response: Awaited<ReturnType<LLMProviderAdapter['send']>> | null = null;
    const startTime = Date.now();

    try {
      response = await retryWithBackoff(
        async () => {
          const sendOptions = {
            model: attempt.model,
            temperature,
            maxTokens,
            getProfileList: () => profileList,
            getProfileApiKey: getApiKey,
            onProfileCooldown: (profileName: string, reason: 'rate_limit' | 'billing') => {
              cooldownManager.markFailure(profileName, reason);
            },
          };

          return adapter.send(request, sendOptions);
        },
        retryConfig,
        (error) => error instanceof ProviderError && error.kind === 'rate_limit'
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.kind === 'limit_reached' || error.kind === 'rate_limit') {
          if (hasFallback) {
            await emitFailoverEvent(request, attempt, error.kind);
            continue;
          }
          return {
            sessionId: request.sessionId,
            success: false,
            error: {
              code: 'NACHOS_ERR_LLM_FAILED',
              message: error.message,
              providerCode: error.providerCode,
            },
          };
        }

        return {
          sessionId: request.sessionId,
          success: false,
          error: {
            code: 'NACHOS_ERR_LLM_FAILED',
            message: error.message,
            providerCode: error.providerCode,
          },
        };
      }

      throw error;
    }

    if (!response) {
      continue;
    }

    const latencyMs = Date.now() - startTime;

    // Emit metrics for successful request
    await emitMetrics(
      request.sessionId,
      response.provider ?? attempt.provider,
      response.model ?? attempt.model,
      latencyMs,
      response.usage
    );

    return {
      sessionId: request.sessionId,
      success: true,
      message: response.message,
      toolCalls: response.toolCalls,
      usage: response.usage,
      provider: response.provider,
      model: response.model,
      finishReason: response.finishReason,
    };
  }

  return {
    sessionId: request.sessionId,
    success: false,
    error: {
      code: 'NACHOS_ERR_LLM_FAILED',
      message: 'No available providers for request',
    },
  };
}

async function handleStream(
  request: LLMRequestType,
  onChunk: (chunk: LLMStreamChunkType) => Promise<void>
): Promise<LLMResponseType> {
  const attempts = buildAttemptList(request);
  const hasFallback = attempts.length > 1;
  const maxTokens = request.options?.maxTokens ?? llmConfig.max_tokens;
  const temperature = request.options?.temperature ?? llmConfig.temperature;

  for (const attempt of attempts) {
    const adapter = adapterRegistry.getAdapter(attempt.provider) as LLMProviderAdapter | undefined;
    if (!adapter) {
      continue;
    }

    const profileList = getProfileList(attempt.provider);

    let response: Awaited<ReturnType<LLMProviderAdapter['send']>> | null = null;
    const startTime = Date.now();
    let firstChunkTime: number | null = null;

    // Wrap onChunk to track time to first chunk
    const wrappedOnChunk = async (chunk: LLMStreamChunkType) => {
      if (firstChunkTime === null && chunk.type === 'delta') {
        firstChunkTime = Date.now();
      }
      await onChunk(chunk);
    };

    try {
      response = await retryWithBackoff(
        async () => {
          const streamOptions = {
            sessionId: request.sessionId,
            model: attempt.model,
            temperature,
            maxTokens,
            getProfileList: () => profileList,
            getProfileApiKey: getApiKey,
            onProfileCooldown: (profileName: string, reason: 'rate_limit' | 'billing') => {
              cooldownManager.markFailure(profileName, reason);
            },
          };

          if (adapter.stream) {
            return adapter.stream(request, streamOptions, wrappedOnChunk);
          }
          return adapter.send(request, streamOptions);
        },
        retryConfig,
        (error) => error instanceof ProviderError && error.kind === 'rate_limit'
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.kind === 'limit_reached' || error.kind === 'rate_limit') {
          if (hasFallback) {
            await emitFailoverEvent(request, attempt, error.kind);
            continue;
          }
          return {
            sessionId: request.sessionId,
            success: false,
            error: {
              code: 'NACHOS_ERR_LLM_FAILED',
              message: error.message,
              providerCode: error.providerCode,
            },
          };
        }

        return {
          sessionId: request.sessionId,
          success: false,
          error: {
            code: 'NACHOS_ERR_LLM_FAILED',
            message: error.message,
            providerCode: error.providerCode,
          },
        };
      }

      throw error;
    }

    if (!response) {
      continue;
    }

    const totalLatencyMs = Date.now() - startTime;
    const timeToFirstChunkMs = firstChunkTime ? firstChunkTime - startTime : null;

    // Emit metrics for successful streaming request
    await emitMetrics(
      request.sessionId,
      response.provider ?? attempt.provider,
      response.model ?? attempt.model,
      totalLatencyMs,
      response.usage
    );

    // Emit additional streaming-specific metrics
    if (timeToFirstChunkMs !== null) {
      await emitAudit({
        userId: 'unknown',
        sessionId: request.sessionId,
        channel: 'internal',
        eventType: 'llm_request',
        action: 'llm.stream.metrics',
        outcome: 'allowed',
        securityMode: config.security.mode,
        details: {
          provider: response.provider ?? attempt.provider,
          model: response.model ?? attempt.model,
          timeToFirstChunkMs,
          totalLatencyMs,
        },
      });
    }

    return {
      sessionId: request.sessionId,
      success: true,
      message: response.message,
      toolCalls: response.toolCalls,
      usage: response.usage,
      provider: response.provider,
      model: response.model,
      finishReason: response.finishReason,
    };
  }

  return {
    sessionId: request.sessionId,
    success: false,
    error: {
      code: 'NACHOS_ERR_LLM_FAILED',
      message: 'No available providers for request',
    },
  };
}

async function start(): Promise<void> {
  await bus.connect();

  await bus.subscribe(TOPICS.llm.request, async (envelope, meta) => {
    const result = validateLLMRequest(envelope.payload);
    if (!result.success || !result.data) {
      const response: LLMResponseType = {
        sessionId: 'unknown',
        success: false,
        error: {
          code: 'NACHOS_ERR_VALIDATION',
          message: 'Invalid LLM request payload',
        },
      };
      meta.respond?.(response);
      bus.publish(TOPICS.llm.response, response, {
        type: 'llm.response',
        correlationId: envelope.id,
      });
      return;
    }

    const request: LLMRequestType = result.data;
    const shouldStream = request.options?.stream ?? false;

    await emitAudit({
      userId: 'unknown',
      sessionId: request.sessionId,
      channel: 'internal',
      eventType: 'llm_request',
      action: 'llm.request',
      outcome: 'allowed',
      securityMode: config.security.mode,
      details: {
        provider: llmConfig.provider,
        model: request.options?.model ?? llmConfig.model,
      },
    });

    if (shouldStream) {
      const response = await handleStream(request, async (chunk) => {
        bus.publish(TOPICS.llm.stream(request.sessionId), chunk, {
          type: 'llm.stream',
          correlationId: envelope.id,
        });
      });
      meta.respond?.(response);
      bus.publish(TOPICS.llm.response, response, {
        type: 'llm.response',
        correlationId: envelope.id,
      });
      return;
    }

    const response = await handleRequest(request);
    meta.respond?.(response);
    bus.publish(TOPICS.llm.response, response, {
      type: 'llm.response',
      correlationId: envelope.id,
    });
  });

  console.log('✅ LLM Proxy service ready');
  console.log(`   NATS: ${NATS_URL}`);
}

start().catch((error) => {
  console.error('Failed to start LLM Proxy:', error);
  process.exit(1);
});
