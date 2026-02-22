/**
 * Memory tool schemas for LLM tool calling
 * 
 * These tools enable the LLM to query its own memory storage.
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import type { StateLayer, StateOperationContext } from '@nachos/state';
import type { MemoryQuery, MemoryKind } from '@nachos/types';

/**
 * memory_search tool schema
 * Searches memory entries and facts using text/tag/kind filters
 */
export const MemorySearchToolSchema = {
  $id: 'memory_search',
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Text to search for in memory entries (searches content, subject, predicate, object)',
    },
    kinds: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['summary', 'preference', 'fact', 'decision', 'task', 'issue'],
      },
      description: 'Filter by memory entry types (optional)',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Filter by tags (optional)',
    },
    limit: {
      type: 'number',
      description: 'Maximum results to return (default: 10)',
      default: 10,
    },
  },
  required: ['query'],
};

/**
 * memory_get tool schema  
 * Retrieves specific memory entries by ID or detailed query
 */
export const MemoryGetToolSchema = {
  $id: 'memory_get',
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Memory file path (e.g., "MEMORY.md" or "memory/2026-01-15.md")',
    },
    from: {
      type: 'number',
      description: 'Start line number (1-indexed, optional)',
    },
    lines: {
      type: 'number',
      description: 'Number of lines to read (optional)',
    },
  },
  required: ['path'],
};

/**
 * Execute memory_search tool
 */
export async function executeMemorySearch(
  call: ToolCall,
  stateLayer: StateLayer,
  context: StateOperationContext
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      query?: string;
      kinds?: string[];
      tags?: string[];
      limit?: number;
    };

    if (!params.query || typeof params.query !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'query parameter is required and must be a string',
        },
      };
    }

    // Determine agentId from context (userId or sessionId)
    const agentId = context.userId ?? context.sessionId;

    const memoryQuery: MemoryQuery = {
      agentId,
      text: params.query,
      kinds: params.kinds as MemoryKind[] | undefined,
      tags: params.tags,
      limit: params.limit ?? 10,
    };

    const result = await stateLayer.queryMemory(memoryQuery, context);

    // Format results for LLM
    const entriesText = result.entries.map((entry, idx) => {
      const tagsStr = entry.tags && entry.tags.length > 0 ? ` [tags: ${entry.tags.join(', ')}]` : '';
      const confidence = entry.confidence ? ` (confidence: ${entry.confidence})` : '';
      return `${idx + 1}. [${entry.kind}]${tagsStr}${confidence}\n   ${entry.content}`;
    }).join('\n\n');

    const factsText = result.facts && result.facts.length > 0
      ? '\n\n**Facts:**\n' + result.facts.map((fact, idx) => 
          `${idx + 1}. ${fact.subject} ${fact.predicate} ${fact.object}`
        ).join('\n')
      : '';

    const summary = `Found ${result.entries.length} memory entries` +
      (result.facts ? ` and ${result.facts.length} facts` : '') +
      ` for query: "${params.query}"`;

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `${summary}\n\n${entriesText}${factsText}`,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'MEMORY_SEARCH_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during memory search',
      },
    };
  }
}

/**
 * Execute memory_get tool
 * 
 * Note: This currently returns a placeholder since the actual file system
 * integration for memory files needs to be implemented.
 */
export async function executeMemoryGet(
  call: ToolCall,
  _stateLayer: StateLayer,
  _context: StateOperationContext
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      path?: string;
      from?: number;
      lines?: number;
    };

    if (!params.path || typeof params.path !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'path parameter is required and must be a string',
        },
      };
    }

    // TODO: Implement actual file system reading for memory files
    // For now, return a helpful message
    return {
      success: false,
      content: [],
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `memory_get is not yet implemented. Use memory_search to query stored memories. File path: ${params.path}`,
      },
    };
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'MEMORY_GET_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during memory get',
      },
    };
  }
}
