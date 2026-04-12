import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserLocalTool } from './browser-local.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Mock MCP Client returned by the mock Client constructor.
 * Simulates callTool responses from @playwright/mcp.
 */
const mockCallTool = vi.fn();
const mockClientClose = vi.fn();
const mockClientConnect = vi.fn();

/**
 * Mock MCP Server returned by createConnection.
 */
const mockServerConnect = vi.fn();
const mockServerClose = vi.fn();

// Mock @playwright/mcp
vi.mock('@playwright/mcp', () => ({
  createConnection: vi.fn().mockResolvedValue({
    connect: mockServerConnect,
    close: mockServerClose,
  }),
}));

// Mock @modelcontextprotocol/sdk/client/index.js
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    callTool: mockCallTool,
    close: mockClientClose,
  })),
}));

// Mock @modelcontextprotocol/sdk/inMemory.js
const mockClientTransport = { start: vi.fn(), close: vi.fn() };
const mockServerTransport = { start: vi.fn(), close: vi.fn() };
vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
  InMemoryTransport: {
    createLinkedPair: vi.fn().mockReturnValue([mockClientTransport, mockServerTransport]),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowserLocalTool', () => {
  let tool: BrowserLocalTool;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();

    tool = new BrowserLocalTool({
      logger,
      headless: true,
      ssrf: { allowedDomains: ['*'] },
    });
  });

  describe('isBrowserTool', () => {
    it('recognizes browser tool names', () => {
      expect(tool.isBrowserTool('browser_navigate')).toBe(true);
      expect(tool.isBrowserTool('browser_snapshot')).toBe(true);
      expect(tool.isBrowserTool('browser_click')).toBe(true);
      expect(tool.isBrowserTool('browser_tab_select')).toBe(true);
      expect(tool.isBrowserTool('browser_console_messages')).toBe(true);
      expect(tool.isBrowserTool('browser_network_requests')).toBe(true);
      expect(tool.isBrowserTool('browser_pdf_save')).toBe(true);
    });

    it('rejects non-browser tool names', () => {
      expect(tool.isBrowserTool('web_fetch')).toBe(false);
      expect(tool.isBrowserTool('exec')).toBe(false);
      expect(tool.isBrowserTool('browser')).toBe(false);
    });
  });

  describe('execute', () => {
    it('initializes MCP client+server on first call', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'page snapshot' }],
        isError: false,
      });

      await tool.execute({
        id: 'call-1',
        tool: 'browser_snapshot',
        sessionId: 'session-1',
        parameters: {},
      });

      // Verify the MCP server was connected to the server transport
      expect(mockServerConnect).toHaveBeenCalledWith(mockServerTransport);

      // Verify the MCP client was connected to the client transport
      expect(mockClientConnect).toHaveBeenCalledWith(mockClientTransport);

      // Verify callTool was invoked
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'browser_snapshot',
        arguments: {},
      });
    });

    it('forwards tool calls to the MCP client', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'navigated to https://example.com' }],
        isError: false,
      });

      const result = await tool.execute({
        id: 'call-2',
        tool: 'browser_navigate',
        sessionId: 'session-1',
        parameters: { url: 'https://example.com' },
      });

      expect(result.success).toBe(true);
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' },
      });
    });

    it('wraps text content as untrusted external content', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello from the page' }],
        isError: false,
      });

      const result = await tool.execute({
        id: 'call-3',
        tool: 'browser_snapshot',
        sessionId: 'session-1',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      const textBlock = result.content[0] as { type: 'text'; text: string };
      expect(textBlock.text).toContain('<browser-observation');
      expect(textBlock.text).toContain('untrusted="true"');
      expect(textBlock.text).toContain('Hello from the page');
      expect(textBlock.text).toContain('</browser-observation>');
    });

    it('passes through image content blocks without wrapping', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
        isError: false,
      });

      const result = await tool.execute({
        id: 'call-4',
        tool: 'browser_screenshot',
        sessionId: 'session-1',
        parameters: {},
      });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      const imgBlock = result.content[0] as { type: 'image'; data: string; mimeType: string };
      expect(imgBlock.type).toBe('image');
      expect(imgBlock.data).toBe('base64data');
      expect(imgBlock.mimeType).toBe('image/png');
    });

    it('returns error result when MCP reports isError', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Element not found' }],
        isError: true,
      });

      const result = await tool.execute({
        id: 'call-5',
        tool: 'browser_click',
        sessionId: 'session-1',
        parameters: { element: 'Submit', ref: 'e42' },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BROWSER_ERROR');
    });

    it('catches and wraps exceptions from callTool', async () => {
      mockCallTool.mockRejectedValue(new Error('Browser crashed'));

      const result = await tool.execute({
        id: 'call-6',
        tool: 'browser_navigate',
        sessionId: 'session-1',
        parameters: { url: 'https://example.com' },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BROWSER_TOOL_ERROR');
      expect(result.error?.message).toBe('Browser crashed');
    });

    it('blocks SSRF attempts on navigation tools', async () => {
      // Create a tool that blocks private IPs
      const restrictedTool = new BrowserLocalTool({
        logger,
        headless: true,
        ssrf: {
          allowedDomains: ['example.com'],
          blockPrivateIPs: true,
          blockLocalhost: true,
        },
      });

      const result = await restrictedTool.execute({
        id: 'call-7',
        tool: 'browser_navigate',
        sessionId: 'session-1',
        parameters: { url: 'http://evil.com' },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SSRF_BLOCKED');
    });

    it('does not SSRF-check non-navigation tools', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'clicked' }],
        isError: false,
      });

      const result = await tool.execute({
        id: 'call-8',
        tool: 'browser_click',
        sessionId: 'session-1',
        parameters: { element: 'Submit', ref: 'e1' },
      });

      // Should succeed — no SSRF check on click
      expect(result.success).toBe(true);
    });

    it('only initializes once even with concurrent calls', async () => {
      const { createConnection } = await import('@playwright/mcp');
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      });

      // Fire 3 concurrent calls
      await Promise.all([
        tool.execute({ id: 'a', tool: 'browser_snapshot', sessionId: 's', parameters: {} }),
        tool.execute({ id: 'b', tool: 'browser_snapshot', sessionId: 's', parameters: {} }),
        tool.execute({ id: 'c', tool: 'browser_snapshot', sessionId: 's', parameters: {} }),
      ]);

      // createConnection should only be called once
      expect(createConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('closes both client and server', async () => {
      // Initialize first
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      });
      await tool.execute({
        id: 'call-init',
        tool: 'browser_snapshot',
        sessionId: 'session-1',
        parameters: {},
      });

      await tool.close();

      expect(mockClientClose).toHaveBeenCalled();
      expect(mockServerClose).toHaveBeenCalled();
    });

    it('handles close when not initialized', async () => {
      // Should not throw
      await tool.close();
      expect(mockClientClose).not.toHaveBeenCalled();
    });
  });
});
