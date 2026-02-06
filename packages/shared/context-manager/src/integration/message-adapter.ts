/**
 * Message Adapter - Converts between NACHOS Message format and ContextMessage format
 *
 * This adapter allows the context manager to work with NACHOS messages while
 * maintaining compatibility with the internal ContextMessage format.
 */

import type { Message, MessageRole } from '@nachos/types';
import type { ContextMessage, ContentBlock, ToolCall } from '../types/index.js';

/**
 * Adapter class for converting between NACHOS Message and ContextMessage formats
 */
export class MessageAdapter {
  /**
   * Convert a NACHOS Message to internal ContextMessage format
   *
   * @param nachosMsg - NACHOS Message from session history
   * @returns ContextMessage compatible with context manager operations
   */
  toContextMessage(nachosMsg: Message): ContextMessage {
    // Estimate tokens and cache the result
    const tokens = this.estimateTokens(nachosMsg.content);

    return {
      role: nachosMsg.role as 'system' | 'user' | 'assistant' | 'tool',
      content: nachosMsg.content,
      toolCalls: nachosMsg.toolCalls ? this.parseToolCalls(nachosMsg.toolCalls) : undefined,
      id: nachosMsg.id,
      timestamp: new Date(nachosMsg.createdAt).getTime(),
      _tokenCache: tokens,
    };
  }

  /**
   * Convert an array of NACHOS Messages to ContextMessages
   *
   * @param nachosMessages - Array of NACHOS Messages
   * @returns Array of ContextMessages
   */
  toContextMessages(nachosMessages: Message[]): ContextMessage[] {
    return nachosMessages.map((msg) => this.toContextMessage(msg));
  }

  /**
   * Convert a ContextMessage back to NACHOS Message format
   *
   * @param contextMsg - Internal ContextMessage
   * @param sessionId - Session ID to include in the message
   * @returns NACHOS Message
   */
  toNachosMessage(contextMsg: ContextMessage, sessionId: string): Message {
    return {
      id: contextMsg.id || this.generateId(),
      sessionId,
      role: contextMsg.role as MessageRole,
      content: this.serializeContent(contextMsg.content),
      toolCalls: contextMsg.toolCalls,
      createdAt:
        contextMsg.timestamp
          ? new Date(contextMsg.timestamp).toISOString()
          : new Date().toISOString(),
    };
  }

  /**
   * Convert an array of ContextMessages back to NACHOS Messages
   *
   * @param contextMessages - Array of ContextMessages
   * @param sessionId - Session ID to include in the messages
   * @returns Array of NACHOS Messages
   */
  toNachosMessages(contextMessages: ContextMessage[], sessionId: string): Message[] {
    return contextMessages.map((msg) => this.toNachosMessage(msg, sessionId));
  }

  /**
   * Estimate token count for a message using heuristic approach
   *
   * Uses the OpenAI rule of thumb: ~4 chars per token for English.
   * We use 3.5 to be slightly conservative (80-90% accuracy).
   *
   * @param content - Message content (string or ContentBlock array)
   * @returns Estimated token count
   */
  estimateTokens(content: string | ContentBlock[]): number {
    let textContent: string;

    if (typeof content === 'string') {
      textContent = content;
    } else {
      // Extract text from content blocks
      textContent = content
        .map((block) => {
          if (block.type === 'text') {
            return block.text || block.content || '';
          }
          if (block.type === 'tool_result') {
            return block.content || '';
          }
          return '';
        })
        .join(' ');
    }

    // Conservative estimate: 3.5 chars per token
    const baseTokens = Math.ceil(textContent.length / 3.5);

    // Add overhead for message structure (role, formatting, etc.)
    const overhead = 4;

    return baseTokens + overhead;
  }

  /**
   * Estimate token count for a ContextMessage
   *
   * @param message - ContextMessage to estimate
   * @returns Estimated token count
   */
  estimateMessageTokens(message: ContextMessage): number {
    // Check if we have a cached token count
    if (message._tokenCache !== undefined) {
      return message._tokenCache;
    }

    let tokens = this.estimateTokens(message.content);

    // Add overhead for tool calls if present
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      tokens += message.toolCalls.length * 10; // Rough estimate: 10 tokens per tool call
    }

    return tokens;
  }

  /**
   * Estimate total tokens for an array of messages
   *
   * @param messages - Array of ContextMessages
   * @returns Total estimated token count
   */
  estimateTotalTokens(messages: ContextMessage[]): number {
    return messages.reduce((total, msg) => total + this.estimateMessageTokens(msg), 0);
  }

  /**
   * Serialize content (convert ContentBlock[] to string if needed)
   *
   * @param content - Content to serialize
   * @returns Serialized content string
   */
  private serializeContent(content: string | ContentBlock[]): string {
    if (typeof content === 'string') {
      return content;
    }

    // Convert content blocks to string
    return content
      .map((block) => {
        if (block.type === 'text') {
          return block.text || block.content || '';
        }
        if (block.type === 'tool_result') {
          return block.content || '';
        }
        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n\n');
  }

  /**
   * Parse tool calls from unknown format to ToolCall[]
   *
   * @param toolCalls - Tool calls in unknown format
   * @returns Parsed ToolCall array
   */
  private parseToolCalls(toolCalls: unknown): ToolCall[] | undefined {
    if (!toolCalls) {
      return undefined;
    }

    // If already an array, assume it's in the right format
    if (Array.isArray(toolCalls)) {
      return toolCalls as ToolCall[];
    }

    // If it's a single object, wrap in array
    if (typeof toolCalls === 'object') {
      return [toolCalls as ToolCall];
    }

    return undefined;
  }

  /**
   * Generate a unique ID for a message
   *
   * @returns Unique message ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Singleton instance of MessageAdapter for convenience
 */
export const messageAdapter = new MessageAdapter();
