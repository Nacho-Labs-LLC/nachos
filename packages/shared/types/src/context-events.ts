/**
 * Context Management Event Schemas
 *
 * TypeBox schemas and TypeScript types for context management events
 * published to the message bus for observability and audit logging.
 */

import { Type, type Static } from '@sinclair/typebox';

// ============================================================================
// Compaction Event Schema
// ============================================================================

export const CompactionEventSchema = Type.Object(
  {
    sessionId: Type.String({ description: 'Session ID where compaction occurred' }),
    timestamp: Type.String({
      format: 'date-time',
      description: 'ISO 8601 timestamp of compaction',
    }),
    trigger: Type.Union(
      [
        Type.Literal('manual'),
        Type.Literal('auto-yellow'),
        Type.Literal('auto-orange'),
        Type.Literal('auto-red'),
        Type.Literal('auto-critical'),
      ],
      { description: 'What triggered the compaction' },
    ),
    zone: Type.Union(
      [
        Type.Literal('green'),
        Type.Literal('yellow'),
        Type.Literal('orange'),
        Type.Literal('red'),
        Type.Literal('critical'),
      ],
      { description: 'Context zone at time of compaction' },
    ),
    result: Type.Object(
      {
        tokensBefore: Type.Number({ description: 'Tokens before compaction' }),
        tokensAfter: Type.Number({ description: 'Tokens after compaction' }),
        messagesDropped: Type.Number({ description: 'Number of messages dropped' }),
        messagesKept: Type.Number({ description: 'Number of messages kept' }),
        compressionRatio: Type.Number({ description: 'Compression ratio (0.0-1.0)' }),
        tier: Type.Optional(
          Type.Union([Type.Literal('archival'), Type.Literal('compressed'), Type.Literal('condensed')]),
          { description: 'Summarization tier applied' },
        ),
      },
      { description: 'Compaction results' },
    ),
    snapshot: Type.Optional(
      Type.Object(
        {
          path: Type.String({ description: 'Path to snapshot file' }),
          itemsExtracted: Type.Number({ description: 'Number of items extracted' }),
        },
        { description: 'Snapshot information if created' },
      ),
    ),
  },
  {
    $id: 'CompactionEvent',
    description: 'Event emitted when context compaction occurs',
  },
);

export type CompactionEvent = Static<typeof CompactionEventSchema>;

// ============================================================================
// Extraction Event Schema
// ============================================================================

export const ExtractionEventSchema = Type.Object(
  {
    sessionId: Type.String({ description: 'Session ID where extraction occurred' }),
    timestamp: Type.String({
      format: 'date-time',
      description: 'ISO 8601 timestamp of extraction',
    }),
    extracted: Type.Object(
      {
        decisions: Type.Number({ description: 'Number of decisions extracted' }),
        tasks: Type.Number({ description: 'Number of tasks extracted' }),
        facts: Type.Number({ description: 'Number of facts extracted' }),
        issues: Type.Number({ description: 'Number of issues extracted' }),
        files: Type.Number({ description: 'Number of file references extracted' }),
      },
      { description: 'Extraction counts by category' },
    ),
    trigger: Type.Union(
      [Type.Literal('compaction'), Type.Literal('threshold'), Type.Literal('periodic'), Type.Literal('manual')],
      { description: 'What triggered the extraction' },
    ),
  },
  {
    $id: 'ExtractionEvent',
    description: 'Event emitted when history extraction occurs',
  },
);

export type ExtractionEvent = Static<typeof ExtractionEventSchema>;

// ============================================================================
// Zone Change Event Schema
// ============================================================================

export const ZoneChangeEventSchema = Type.Object(
  {
    sessionId: Type.String({ description: 'Session ID where zone changed' }),
    timestamp: Type.String({
      format: 'date-time',
      description: 'ISO 8601 timestamp of zone change',
    }),
    fromZone: Type.Union(
      [
        Type.Literal('green'),
        Type.Literal('yellow'),
        Type.Literal('orange'),
        Type.Literal('red'),
        Type.Literal('critical'),
      ],
      { description: 'Previous zone' },
    ),
    toZone: Type.Union(
      [
        Type.Literal('green'),
        Type.Literal('yellow'),
        Type.Literal('orange'),
        Type.Literal('red'),
        Type.Literal('critical'),
      ],
      { description: 'New zone' },
    ),
    utilizationRatio: Type.Number({
      minimum: 0,
      maximum: 2,
      description: 'Current utilization ratio (0.0-1.0+)',
    }),
    tokensUsed: Type.Number({ description: 'Current tokens used' }),
    historyBudget: Type.Number({ description: 'Total history budget' }),
  },
  {
    $id: 'ZoneChangeEvent',
    description: 'Event emitted when context zone changes',
  },
);

export type ZoneChangeEvent = Static<typeof ZoneChangeEventSchema>;

// ============================================================================
// Snapshot Event Schema
// ============================================================================

export const SnapshotEventSchema = Type.Object(
  {
    sessionId: Type.String({ description: 'Session ID' }),
    timestamp: Type.String({
      format: 'date-time',
      description: 'ISO 8601 timestamp',
    }),
    snapshotPath: Type.String({ description: 'Path to snapshot file' }),
    compactionCount: Type.Number({ description: 'Number of compactions so far' }),
    messageCount: Type.Number({ description: 'Number of messages in snapshot' }),
    tokenCount: Type.Number({ description: 'Token count in snapshot' }),
  },
  {
    $id: 'SnapshotEvent',
    description: 'Event emitted when context snapshot is created',
  },
);

export type SnapshotEvent = Static<typeof SnapshotEventSchema>;

// ============================================================================
// Budget Update Event Schema
// ============================================================================

export const BudgetUpdateEventSchema = Type.Object(
  {
    sessionId: Type.String({ description: 'Session ID' }),
    timestamp: Type.String({
      format: 'date-time',
      description: 'ISO 8601 timestamp',
    }),
    budget: Type.Object(
      {
        total: Type.Number({ description: 'Total context window' }),
        systemPrompt: Type.Number({ description: 'System prompt tokens' }),
        reserved: Type.Number({ description: 'Reserved tokens for response' }),
        historyBudget: Type.Number({ description: 'Available history budget' }),
        currentUsage: Type.Number({ description: 'Current history usage' }),
        utilizationRatio: Type.Number({ description: 'Utilization ratio (0.0-1.0+)' }),
        zone: Type.Union([
          Type.Literal('green'),
          Type.Literal('yellow'),
          Type.Literal('orange'),
          Type.Literal('red'),
          Type.Literal('critical'),
        ]),
      },
      { description: 'Current budget state' },
    ),
  },
  {
    $id: 'BudgetUpdateEvent',
    description: 'Event emitted when context budget is updated',
  },
);

export type BudgetUpdateEvent = Static<typeof BudgetUpdateEventSchema>;

// ============================================================================
// Export all schemas
// ============================================================================

export const ContextEventSchemas = {
  Compaction: CompactionEventSchema,
  Extraction: ExtractionEventSchema,
  ZoneChange: ZoneChangeEventSchema,
  Snapshot: SnapshotEventSchema,
  BudgetUpdate: BudgetUpdateEventSchema,
} as const;
