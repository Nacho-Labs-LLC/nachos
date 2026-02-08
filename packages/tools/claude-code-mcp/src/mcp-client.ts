/**
 * MCP client wrapper for Claude Code MCP server
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ClaudeCodeMcpClientConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  logger?: Logger;
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type ClaudeCodeToolResult = CallToolResult | { toolResult: unknown };

export class ClaudeCodeMcpClient {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private config: ClaudeCodeMcpClientConfig) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.createConnection();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async createConnection(): Promise<void> {
    const client = new Client({
      name: 'nachos-claude-code-mcp-client',
      version: '0.1.0',
    });

    client.onerror = (error) => {
      this.config.logger?.error('MCP client error:', error);
    };

    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
    });

    await client.connect(transport);

    this.client = client;
  }

  async close(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.close();
    } finally {
      this.client = null;
    }
  }

  async listTools(): Promise<string[]> {
    await this.connect();

    if (!this.client) {
      return [];
    }

    const result = await this.client.listTools();
    return result.tools.map((tool) => tool.name);
  }

  async callClaudeCode(argumentsMap: Record<string, unknown>): Promise<ClaudeCodeToolResult> {
    await this.connect();

    if (!this.client) {
      throw new Error('MCP client not connected');
    }

    return this.client.callTool({
      name: 'claude_code',
      arguments: argumentsMap,
    });
  }
}
