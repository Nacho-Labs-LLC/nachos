/**
 * Browser Local Tool
 *
 * Gateway-integrated browser automation powered by @playwright/mcp.
 * Replaces the standalone browser container with an in-process Playwright
 * instance that provides ARIA snapshots, element interaction via refs,
 * screenshots, and more.
 *
 * Architecture:
 * - Uses @playwright/mcp's createConnection() for a programmatic MCP server
 * - Wraps MCP tool calls so they can be dispatched from the nachos ToolCoordinator
 * - Applies SSRF protection before any navigation
 * - Runs Chromium headless via Alpine's system chromium package
 *
 * @see https://github.com/microsoft/playwright-mcp
 */

import type { ToolCall, ToolResult, ContentBlock } from '@nachos/types';
import { SSRFProtection, type SSRFProtectionConfig } from './ssrf-protection.js';

/**
 * Logger interface (pino-compatible)
 */
interface Logger {
  info(msg: string): void;
  info(obj: object, msg?: string): void;
  warn(msg: string): void;
  warn(obj: object, msg?: string): void;
  error(msg: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * Browser tool configuration
 */
export interface BrowserToolConfig {
  logger: Logger;
  /** Headless mode (default: true) */
  headless?: boolean;
  /** Navigation timeout in ms (default: 30000) */
  timeout?: number;
  /** SSRF protection config */
  ssrf?: Partial<SSRFProtectionConfig>;
}

/**
 * MCP tool call (simplified interface for what @playwright/mcp expects)
 */
interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * MCP tool result (simplified interface for what @playwright/mcp returns)
 */
interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Server interface (subset of what createConnection returns)
 */
interface MCPServer {
  callTool(call: MCPToolCall): Promise<MCPToolResult>;
  close(): Promise<void>;
}

/**
 * Nachos browser tool names mapped to @playwright/mcp tool names
 */
const BROWSER_TOOLS = new Set([
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_fill',
  'browser_select_option',
  'browser_hover',
  'browser_drag',
  'browser_press_key',
  'browser_screenshot',
  'browser_evaluate',
  'browser_upload_file',
  'browser_handle_dialog',
  'browser_wait',
  'browser_close',
  'browser_resize',
  'browser_go_back',
  'browser_go_forward',
  'browser_tab_new',
  'browser_tab_close',
  'browser_tab_list',
  'browser_console_messages',
  'browser_network_requests',
  'browser_pdf_save',
  'browser_install',
]);

/**
 * Tools that involve navigation and need SSRF checks
 */
const NAVIGATION_TOOLS = new Set(['browser_navigate', 'browser_tab_new']);

/**
 * Gateway-integrated browser tool powered by @playwright/mcp
 */
export class BrowserLocalTool {
  private logger: Logger;
  private mcpServer: MCPServer | null = null;
  private ssrfProtection: SSRFProtection;
  private headless: boolean;
  private initializing: Promise<void> | null = null;

  constructor(config: BrowserToolConfig) {
    this.logger = config.logger;
    this.headless = config.headless ?? process.env.BROWSER_HEADLESS !== 'false';

    const allowedDomains = config.ssrf?.allowedDomains ??
      process.env.BROWSER_ALLOWED_DOMAINS?.split(',') ?? ['*'];

    this.ssrfProtection = new SSRFProtection({
      allowedDomains,
      blockPrivateIPs: true,
      blockLocalhost: true,
      ...config.ssrf,
    });
  }

  /**
   * Check if a tool name is a browser tool
   */
  isBrowserTool(toolName: string): boolean {
    return BROWSER_TOOLS.has(toolName);
  }

  /**
   * Execute a browser tool call
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Lazy-initialize MCP server on first use
      await this.ensureInitialized();

      // SSRF check for navigation tools
      if (NAVIGATION_TOOLS.has(call.tool)) {
        const url = call.parameters?.url as string;
        if (url) {
          const validation = await this.ssrfProtection.validateURL(url);
          if (!validation.valid) {
            return {
              success: false,
              content: [],
              error: {
                code: 'SSRF_BLOCKED',
                message: validation.errors?.join('; ') ?? 'URL blocked by SSRF protection',
              },
              metadata: { duration: Date.now() - startTime },
            };
          }
        }
      }

      // Forward to @playwright/mcp
      const mcpResult = await this.mcpServer!.callTool({
        name: call.tool,
        arguments: call.parameters ?? {},
      });

      // Convert MCP result to nachos ToolResult
      const content: ContentBlock[] = mcpResult.content.map((block) => {
        if (block.type === 'image' && block.data) {
          return {
            type: 'image' as const,
            data: block.data,
            mimeType: block.mimeType ?? 'image/png',
          };
        }
        return {
          type: 'text' as const,
          text: block.text ?? '',
        };
      });

      return {
        success: !mcpResult.isError,
        content,
        error: mcpResult.isError
          ? {
              code: 'BROWSER_ERROR',
              message: content.map((c) => ('text' in c ? c.text : '')).join('\n'),
            }
          : undefined,
        metadata: { duration: Date.now() - startTime },
      };
    } catch (error) {
      this.logger.error({ error: error instanceof Error ? error.message : error }, 'Browser tool execution error');
      return {
        success: false,
        content: [],
        error: {
          code: 'BROWSER_TOOL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown browser error',
        },
        metadata: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * Lazily initialize the MCP server (starts Chromium on first browser tool call)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.mcpServer) return;

    // Prevent concurrent initialization
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.initialize();
    await this.initializing;
    this.initializing = null;
  }

  private async initialize(): Promise<void> {
    this.logger.info('Initializing browser tool (Playwright MCP)');

    const { createConnection } = await import('@playwright/mcp');

    // Determine Chromium executable path
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.env.CHROME_BIN ?? undefined;

    this.mcpServer = (await createConnection({
      browser: {
        launchOptions: {
          headless: this.headless,
          executablePath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        },
      },
    })) as unknown as MCPServer;

    this.logger.info({
      headless: this.headless,
      executablePath: executablePath ?? 'default',
      allowedDomains: this.ssrfProtection.getAllowedDomains(),
    }, 'Browser tool initialized successfully');
  }

  /**
   * Shut down the browser and MCP server
   */
  async close(): Promise<void> {
    if (this.mcpServer) {
      try {
        await this.mcpServer.close();
      } catch (error) {
        this.logger.warn({ error: error instanceof Error ? error.message : error }, 'Error closing browser MCP server');
      }
      this.mcpServer = null;
    }
  }
}
