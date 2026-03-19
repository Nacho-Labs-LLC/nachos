import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebFetchTool } from './web-fetch-tool.js';

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

describe('WebFetchTool', () => {
  let tool: WebFetchTool;

  beforeEach(async () => {
    tool = new WebFetchTool();
    (tool as { logger: typeof noopLogger }).logger = noopLogger;

    await tool.initialize({
      config: {
        allowed_domains: ['example.com'],
        max_chars: 5000,
        timeout_seconds: 5,
        max_redirects: 2,
      },
      secrets: {},
      securityMode: 'standard',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns SSRF error when blocked', async () => {
    (
      tool as {
        ssrfProtection: { validateURL: () => Promise<{ valid: boolean; errors?: string[] }> };
      }
    ).ssrfProtection = {
      validateURL: async () => ({ valid: false, errors: ['blocked'] }),
    };

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      url: 'https://example.com',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SSRF_BLOCKED');
  });

  it('extracts readable content from HTML', async () => {
    (
      tool as { ssrfProtection: { validateURL: () => Promise<{ valid: boolean }> } }
    ).ssrfProtection = {
      validateURL: async () => ({ valid: true }),
    };

    const html =
      '<html><head><title>Title</title></head><body><h1>Heading</h1><p>Hello world.</p></body></html>';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => null,
        },
        text: async () => html,
      })
    );

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      url: 'https://example.com',
      extract_mode: 'markdown',
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.url).toBe('https://example.com');
    expect(payload.content).toContain('Hello');
    expect(payload.source).toBe('http');
  });


});
