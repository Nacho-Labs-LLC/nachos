/**
 * NATS Topic Structure for Nachos Message Bus
 *
 * Topic naming convention: nachos.<domain>.<component>.<action>
 *
 * @see TECHNICAL_SPEC.md section 2.2
 */

/**
 * Base prefix for all Nachos topics
 */
export const TOPIC_PREFIX = 'nachos' as const;

/**
 * Channel-related topics
 */
export const CHANNEL_TOPICS = {
  /**
   * Inbound messages from users via a specific channel
   * Publisher: Channel containers
   * Subscriber: Gateway
   */
  inbound: (channel: string) => `${TOPIC_PREFIX}.channel.${channel}.inbound`,

  /**
   * Outbound messages to users via a specific channel
   * Publisher: Gateway
   * Subscriber: Channel containers
   */
  outbound: (channel: string) => `${TOPIC_PREFIX}.channel.${channel}.outbound`,

  /**
   * Wildcard for all channel inbound messages
   */
  allInbound: `${TOPIC_PREFIX}.channel.*.inbound`,

  /**
   * Wildcard for all channel outbound messages
   */
  allOutbound: `${TOPIC_PREFIX}.channel.*.outbound`,
} as const;

/**
 * LLM-related topics
 */
export const LLM_TOPICS = {
  /**
   * LLM completion requests
   * Publisher: Gateway
   * Subscriber: LLM Proxy
   */
  request: `${TOPIC_PREFIX}.llm.request`,

  /**
   * LLM completion responses
   * Publisher: LLM Proxy
   * Subscriber: Gateway
   */
  response: `${TOPIC_PREFIX}.llm.response`,

  /**
   * Streaming chunks for a specific session
   * Publisher: LLM Proxy
   * Subscriber: Gateway
   */
  stream: (sessionId: string) => `${TOPIC_PREFIX}.llm.stream.${sessionId}`,

  /**
   * Wildcard for all streaming topics
   */
  allStreams: `${TOPIC_PREFIX}.llm.stream.*`,
} as const;

/**
 * Tool-related topics
 */
export const TOOL_TOPICS = {
  /**
   * Tool execution requests for a specific tool
   * Publisher: Gateway
   * Subscriber: Tool containers
   */
  request: (tool: string) => `${TOPIC_PREFIX}.tool.${tool}.request`,

  /**
   * Tool execution responses for a specific tool
   * Publisher: Tool containers
   * Subscriber: Gateway
   */
  response: (tool: string) => `${TOPIC_PREFIX}.tool.${tool}.response`,

  /**
   * Wildcard for all tool requests
   */
  allRequests: `${TOPIC_PREFIX}.tool.*.request`,

  /**
   * Wildcard for all tool responses
   */
  allResponses: `${TOPIC_PREFIX}.tool.*.response`,
} as const;

/**
 * Policy-related topics (reserved)
 *
 * Salsa is embedded in the Gateway, so these topics are not used
 * unless a future external policy service is introduced.
 */
export const POLICY_TOPICS = {
  /**
   * Policy check requests
   * Publisher: Any component
   * Subscriber: External policy service (if enabled)
   */
  check: `${TOPIC_PREFIX}.policy.check`,

  /**
   * Policy check results
   * Publisher: External policy service (if enabled)
   * Subscriber: Requester
   */
  result: `${TOPIC_PREFIX}.policy.result`,
} as const;

/**
 * Audit logging topics
 */
export const AUDIT_TOPICS = {
  /**
   * Audit event log
   * Publisher: Any component
   * Subscriber: Audit processors
   */
  log: `${TOPIC_PREFIX}.audit.log`,
} as const;

/**
 * Health check topics
 */
export const HEALTH_TOPICS = {
  /**
   * Health ping/pong for liveness checks
   * Publisher: Any component
   * Subscriber: Any component
   */
  ping: `${TOPIC_PREFIX}.health.ping`,
} as const;

/**
 * Gateway management topics
 */
export const GATEWAY_TOPICS = {
  subagents: {
    spawn: `${TOPIC_PREFIX}.gateway.subagents.spawn`,
    list: `${TOPIC_PREFIX}.gateway.subagents.list`,
    info: `${TOPIC_PREFIX}.gateway.subagents.info`,
    stop: `${TOPIC_PREFIX}.gateway.subagents.stop`,
    log: `${TOPIC_PREFIX}.gateway.subagents.log`,
  },
  sandbox: {
    explain: `${TOPIC_PREFIX}.gateway.sandbox.explain`,
    list: `${TOPIC_PREFIX}.gateway.sandbox.list`,
    recreate: `${TOPIC_PREFIX}.gateway.sandbox.recreate`,
  },
} as const;

/**
 * Context management topics
 */
export const CONTEXT_TOPICS = {
  /**
   * Context compaction events
   * Publisher: Gateway
   * Subscriber: Audit, Monitoring
   */
  compaction: `${TOPIC_PREFIX}.context.compaction`,

  /**
   * History extraction events
   * Publisher: Gateway
   * Subscriber: Audit, Monitoring
   */
  extraction: `${TOPIC_PREFIX}.context.extraction`,

  /**
   * Context zone change events
   * Publisher: Gateway
   * Subscriber: Monitoring
   */
  zoneChange: `${TOPIC_PREFIX}.context.zone_change`,

  /**
   * Context snapshot created events
   * Publisher: Gateway
   * Subscriber: Audit
   */
  snapshot: `${TOPIC_PREFIX}.context.snapshot`,

  /**
   * Context budget update events
   * Publisher: Gateway
   * Subscriber: Monitoring
   */
  budgetUpdate: `${TOPIC_PREFIX}.context.budget_update`,

  /**
   * Wildcard for all context events
   */
  all: `${TOPIC_PREFIX}.context.*`,
} as const;

/**
 * All topic namespaces aggregated for convenience
 */
export const TOPICS = {
  channel: CHANNEL_TOPICS,
  llm: LLM_TOPICS,
  tool: TOOL_TOPICS,
  policy: POLICY_TOPICS,
  audit: AUDIT_TOPICS,
  health: HEALTH_TOPICS,
  gateway: GATEWAY_TOPICS,
  context: CONTEXT_TOPICS,
} as const;

/**
 * Helper to extract the channel name from a channel topic
 */
export function extractChannelFromTopic(topic: string): string | null {
  const match = topic.match(/^nachos\.channel\.([^.]+)\.(inbound|outbound)$/);
  return match?.[1] ?? null;
}

/**
 * Helper to extract the tool name from a tool topic
 */
export function extractToolFromTopic(topic: string): string | null {
  const match = topic.match(/^nachos\.tool\.([^.]+)\.(request|response)$/);
  return match?.[1] ?? null;
}

/**
 * Helper to extract the session ID from a stream topic
 */
export function extractSessionFromStreamTopic(topic: string): string | null {
  const match = topic.match(/^nachos\.llm\.stream\.(.+)$/);
  return match?.[1] ?? null;
}
