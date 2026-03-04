/**
 * Memory tool schemas for LLM tool calling
 *
 * These tools enable the LLM to query and write to its own memory storage.
 */

import { randomUUID } from 'node:crypto';
import type { ToolCall, ToolResult } from '@nachos/types';
import type { StateLayer, StateOperationContext } from '@nachos/state';
import type { MemoryQuery, MemoryKind, MemoryEntry } from '@nachos/types';

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
      description:
        'Text to search for in memory entries (searches content, subject, predicate, object)',
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
    semantic: {
      type: 'boolean',
      description:
        'Use semantic search instead of text matching (finds similar meanings, not just exact words). Default: false',
      default: false,
    },
    minSimilarity: {
      type: 'number',
      description: 'Minimum similarity score for semantic search (0-1). Default: 0.7',
      default: 0.7,
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
      semantic?: boolean;
      minSimilarity?: number;
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
      semantic: params.semantic ?? false,
      minSimilarity: params.minSimilarity ?? 0.7,
    };

    const result = await stateLayer.queryMemory(memoryQuery, context);

    // Format results for LLM
    const searchType = params.semantic ? 'semantic' : 'text';
    const entriesText = result.entries
      .map((entry, idx) => {
        const tagsStr =
          entry.tags && entry.tags.length > 0 ? ` [tags: ${entry.tags.join(', ')}]` : '';
        const confidenceStr = entry.confidence
          ? ` (${params.semantic ? 'similarity' : 'confidence'}: ${entry.confidence.toFixed(2)})`
          : '';
        return `${idx + 1}. [${entry.kind}]${tagsStr}${confidenceStr}\n   ${entry.content}`;
      })
      .join('\n\n');

    const factsText =
      result.facts && result.facts.length > 0
        ? '\n\n**Facts:**\n' +
          result.facts
            .map((fact, idx) => `${idx + 1}. ${fact.subject} ${fact.predicate} ${fact.object}`)
            .join('\n')
        : '';

    const summary =
      `Found ${result.entries.length} memory entries` +
      (result.facts ? ` and ${result.facts.length} facts` : '') +
      ` (${searchType} search) for query: "${params.query}"`;

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
 * memory_write tool schema
 * Saves a memory entry (fact, decision, preference, task, etc.) to persistent storage
 */
export const MemoryWriteToolSchema = {
  $id: 'memory_write',
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'The memory content to save (a concise, self-contained statement)',
    },
    kind: {
      type: 'string',
      enum: ['summary', 'preference', 'fact', 'decision', 'task', 'issue'],
      description:
        'Type of memory: preference (user likes/dislikes), fact (learned information), decision (choice made), task (action item), issue (problem found), summary (conversation summary)',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for categorization and retrieval (optional)',
    },
  },
  required: ['content', 'kind'],
};

/**
 * Execute memory_write tool
 */
export async function executeMemoryWrite(
  call: ToolCall,
  stateLayer: StateLayer,
  context: StateOperationContext
): Promise<ToolResult> {
  try {
    const params = call.parameters as {
      content?: string;
      kind?: string;
      tags?: string[];
    };

    if (!params.content || typeof params.content !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'content parameter is required and must be a string',
        },
      };
    }

    const validKinds: MemoryKind[] = ['summary', 'preference', 'fact', 'decision', 'task', 'issue'];
    const kind = (params.kind as MemoryKind) ?? 'fact';
    if (!validKinds.includes(kind)) {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: `kind must be one of: ${validKinds.join(', ')}`,
        },
      };
    }

    const agentId = context.userId ?? context.sessionId;
    const now = new Date().toISOString();

    const entry: MemoryEntry = {
      id: randomUUID(),
      agentId,
      kind,
      content: params.content,
      tags: params.tags,
      confidence: 1.0,
      provenance: {
        source: 'tool',
        sessionId: context.sessionId,
      },
      createdAt: now,
    };

    const stored = await stateLayer.appendMemoryEntry(entry, context);

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: `Saved memory entry [${stored.kind}]: "${stored.content.slice(0, 100)}${stored.content.length > 100 ? '...' : ''}" (id: ${stored.id})`,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'MEMORY_WRITE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during memory write',
      },
    };
  }
}

/**
 * Execute memory_get tool
 *
 * Reads memory files (MEMORY.md, memory/YYYY-MM-DD.md) from the workspace.
 * Supports optional line range for large files.
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

    // Security: Only allow reading from memory files
    const normalizedPath = params.path.trim();
    const allowedPaths = [
      'MEMORY.md',
      'memory/',
      'AGENTS.md',
      'SOUL.md',
      'USER.md',
      'TOOLS.md',
      'IDENTITY.md',
    ];

    const isAllowed = allowedPaths.some(
      (allowed) =>
        normalizedPath === allowed ||
        normalizedPath.startsWith(allowed) ||
        normalizedPath.startsWith('./' + allowed)
    );

    if (!isAllowed) {
      return {
        success: false,
        content: [],
        error: {
          code: 'ACCESS_DENIED',
          message: `Access denied. Only memory files are allowed (MEMORY.md, memory/, AGENTS.md, etc.). Requested: ${normalizedPath}`,
        },
      };
    }

    // Use Node.js fs module to read file
    const fs = await import('fs/promises');
    const path = await import('path');

    // Construct full path (workspace root + requested path)
    // TODO: Get actual workspace dir from config/context
    const workspaceDir = process.env.NACHOS_WORKSPACE_DIR || process.cwd();
    const fullPath = path.join(workspaceDir, normalizedPath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      // Apply line range if specified
      const from = params.from && params.from > 0 ? params.from - 1 : 0; // 1-indexed to 0-indexed
      const linesToRead = params.lines || lines.length;
      const selectedLines = lines.slice(from, from + linesToRead);

      const resultText = selectedLines.join('\n');
      const totalLines = lines.length;
      const readLines = selectedLines.length;

      const summary =
        params.from || params.lines
          ? `Read lines ${from + 1}-${from + readLines} of ${totalLines} from ${normalizedPath}`
          : `Read ${totalLines} lines from ${normalizedPath}`;

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: `${summary}\n\n---\n\n${resultText}`,
          },
        ],
      };
    } catch (fileError) {
      const err = fileError as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return {
          success: false,
          content: [],
          error: {
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${normalizedPath}. Make sure the file exists in your workspace.`,
          },
        };
      }
      throw fileError;
    }
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
