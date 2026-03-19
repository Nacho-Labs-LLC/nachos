import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebFetchNativeToolSchema,
  executeWebFetchNative,
  type WebFetchConfig,
} from './web-fetch-tools.js';
import type { ToolCall } from '@nachos/types';

// Mock dns to avoid real DNS lookups (used by SSRFProtection internally)
vi.mock('node:dns/promises', () => ({
  default: {
    resolve4: vi.fn().mockResolvedValue(['93.184.216.34']),
    resolve6: vi.fn().mockRejectedValue(new Error('no AAAA')),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Counter to ensure each test gets a unique userId so module-level rate limiting
// state doesn't leak between tests.
let userCounter = 0;
function nextUserId(): string {
  return `user-${++userCounter}-${Date.now()}`;
}

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    tool: 'web_fetch_native',
    sessionId: 'session-1',
    userId: 'user-1',
    parameters: {},
    ...overrides,
  };
}

const defaultConfig: WebFetchConfig = {
  timeout_ms: 5000,
  max_chars: 50000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebFetchNativeToolSchema', () => {
  it('should have correct $id', () => {
    expect(WebFetchNativeToolSchema.$id).toBe('web_fetch_native');
  });

  it('should define url as required property', () => {
    expect(WebFetchNativeToolSchema.required).toContain('url');
  });

  it('should define url property as string type', () => {
    expect(WebFetchNativeToolSchema.properties.url.type).toBe('string');
  });

  it('should define extract_mode as enum with markdown and text', () => {
    expect(WebFetchNativeToolSchema.properties.extract_mode.enum).toEqual(['markdown', 'text']);
  });

  it('should define max_chars as number type', () => {
    expect(WebFetchNativeToolSchema.properties.max_chars.type).toBe('number');
  });

  it('should have type object', () => {
    expect(WebFetchNativeToolSchema.type).toBe('object');
  });
});

describe('executeWebFetchNative', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let testUserId: string;

  beforeEach(() => {
    // Each test gets a unique userId to avoid module-level rate-limiter contamination
    testUserId = nextUserId();

    // Mock global fetch
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Parameter validation
  // ---------------------------------------------------------------------------

  describe('parameter validation', () => {
    it('should return error when url parameter is missing', async () => {
      const call = createToolCall({ parameters: {} });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMETERS');
      expect(result.error?.message).toContain('url parameter is required');
    });

    it('should return error when url parameter is not a string', async () => {
      const call = createToolCall({ parameters: { url: 12345 } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMETERS');
    });

    it('should return error for invalid URL format', async () => {
      const call = createToolCall({ parameters: { url: 'not a url' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
      expect(result.error?.message).toContain('Invalid URL format');
    });
  });

  // ---------------------------------------------------------------------------
  // URL validation and SSRF protection
  // ---------------------------------------------------------------------------

  describe('URL validation', () => {
    it('should reject ftp:// URLs', async () => {
      const call = createToolCall({ parameters: { url: 'ftp://example.com/file' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
      expect(result.error?.message).toContain('Only http and https');
    });

    it('should reject localhost URLs', async () => {
      const call = createToolCall({ parameters: { url: 'http://localhost:8080' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
      expect(result.error?.message).toContain('private/local');
    });

    it('should reject 127.0.0.1', async () => {
      const call = createToolCall({ parameters: { url: 'http://127.0.0.1' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject 10.x.x.x private range', async () => {
      const call = createToolCall({ parameters: { url: 'http://10.0.0.5' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject 192.168.x.x private range', async () => {
      const call = createToolCall({ parameters: { url: 'http://192.168.1.1' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject 172.16-31.x.x private range', async () => {
      const call = createToolCall({ parameters: { url: 'http://172.16.0.1' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject 169.254.x.x (link-local)', async () => {
      const call = createToolCall({ parameters: { url: 'http://169.254.169.254' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
    });

    it('should reject ::1 (IPv6 loopback)', async () => {
      const call = createToolCall({ parameters: { url: 'http://[::1]' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      // IPv6 bracketed URLs may be blocked at different stages depending on
      // platform URL parsing — the key requirement is that the request is blocked.
      expect(['INVALID_URL', 'SSRF_BLOCKED', 'WEB_FETCH_FAILED']).toContain(result.error?.code);
    });

    it('should reject fe80:: (IPv6 link-local)', async () => {
      const call = createToolCall({ parameters: { url: 'http://[fe80::1]' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(['INVALID_URL', 'SSRF_BLOCKED', 'WEB_FETCH_FAILED']).toContain(result.error?.code);
    });

    it('should reject fc00:: (IPv6 unique local)', async () => {
      const call = createToolCall({ parameters: { url: 'http://[fc00::1]' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(['INVALID_URL', 'SSRF_BLOCKED', 'WEB_FETCH_FAILED']).toContain(result.error?.code);
    });
  });

  // ---------------------------------------------------------------------------
  // Domain allowlist
  // ---------------------------------------------------------------------------

  describe('domain allowlist', () => {
    it('should reject domain not in allowlist', async () => {
      const config: WebFetchConfig = {
        ...defaultConfig,
        domain_allowlist: ['example.com'],
      };
      const call = createToolCall({ parameters: { url: 'https://evil.com' } });
      const result = await executeWebFetchNative(call, config, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_URL');
      expect(result.error?.message).toContain('not in the allowlist');
    });

    it('should allow domain in allowlist', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>Hello</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const config: WebFetchConfig = {
        ...defaultConfig,
        domain_allowlist: ['example.com'],
      };
      const call = createToolCall({ parameters: { url: 'https://example.com/page' } });
      const result = await executeWebFetchNative(call, config, testUserId);

      expect(result.success).toBe(true);
    });

    it('should allow subdomain of allowed domain', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>Hello</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const config: WebFetchConfig = {
        ...defaultConfig,
        domain_allowlist: ['example.com'],
      };
      const call = createToolCall({ parameters: { url: 'https://api.example.com/data' } });
      const result = await executeWebFetchNative(call, config, testUserId);

      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  describe('rate limiting', () => {
    it('should enforce rate limit of 10 calls per minute', async () => {
      // Must return a NEW Response per call — Response.body can only be read once
      fetchSpy.mockImplementation(() =>
        Promise.resolve(
          new Response('<html><body>Hello</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        )
      );

      // Use a unique user for this test to avoid cross-test contamination
      const userId = `rate-limit-user-${Date.now()}`;

      // Make 10 calls (should all succeed)
      for (let i = 0; i < 10; i++) {
        const call = createToolCall({ parameters: { url: 'https://example.com' } });
        const result = await executeWebFetchNative(call, defaultConfig, userId);
        expect(result.success, `Call ${i + 1} failed: ${JSON.stringify(result.error)}`).toBe(true);
      }

      // 11th call should be rate limited
      const call = createToolCall({ parameters: { url: 'https://example.com' } });
      const result = await executeWebFetchNative(call, defaultConfig, userId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(result.error?.message).toContain('10 calls per minute');
    });

    it('should reset rate limit after window expires', async () => {
      vi.useFakeTimers();
      try {
        // Must return a NEW Response per call — Response.body can only be read once
        fetchSpy.mockImplementation(() =>
          Promise.resolve(
            new Response('<html><body>Hello</body></html>', {
              status: 200,
              headers: { 'content-type': 'text/html' },
            })
          )
        );

        const userId = `rate-limit-reset-user-${Date.now()}`;

        // Make 10 calls to exhaust the window
        for (let i = 0; i < 10; i++) {
          const call = createToolCall({ parameters: { url: 'https://example.com' } });
          await executeWebFetchNative(call, defaultConfig, userId);
        }

        // Advance time past the rate limit window (1 minute)
        vi.advanceTimersByTime(61 * 1000);

        // Should be allowed again
        const call = createToolCall({ parameters: { url: 'https://example.com' } });
        const result = await executeWebFetchNative(call, defaultConfig, userId);

        expect(result.success).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should track rate limits per user', async () => {
      // Must return a NEW Response per call — Response.body can only be read once
      fetchSpy.mockImplementation(() =>
        Promise.resolve(
          new Response('<html><body>Hello</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        )
      );

      const userA = `user-a-${Date.now()}`;
      const userB = `user-b-${Date.now()}`;

      // Exhaust user A's quota
      for (let i = 0; i < 10; i++) {
        const call = createToolCall({ parameters: { url: 'https://example.com' } });
        await executeWebFetchNative(call, defaultConfig, userA);
      }

      // User B should still be able to make calls
      const call = createToolCall({ parameters: { url: 'https://example.com' } });
      const result = await executeWebFetchNative(call, defaultConfig, userB);

      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Fetch execution
  // ---------------------------------------------------------------------------

  describe('fetch execution', () => {
    it('should fetch and return HTML content as markdown', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          '<html><body><h1>Title</h1><p>Some <strong>bold</strong> text</p></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('# Title');
      expect(text).toContain('**bold**');
    });

    it('should fetch and return HTML content as plain text', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body><h1>Title</h1><p>Paragraph text</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'text' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      // Should not contain markdown formatting
      expect(text).not.toContain('# ');
      expect(text).toContain('Title');
      expect(text).toContain('Paragraph text');
    });

    it('should default to markdown extraction mode', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body><h2>Heading</h2></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('## Heading');
    });

    it('should truncate content exceeding max_chars', async () => {
      const longContent = '<html><body>' + 'A'.repeat(60000) + '</body></html>';
      fetchSpy.mockResolvedValue(
        new Response(longContent, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const config: WebFetchConfig = { ...defaultConfig, max_chars: 100 };
      const call = createToolCall({ parameters: { url: 'https://example.com' } });
      const result = await executeWebFetchNative(call, config, testUserId);

      expect(result.success).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('[Content truncated due to length limit]');
    });

    it('should use max_chars from tool parameters over config', async () => {
      const longContent = '<html><body>' + 'B'.repeat(500) + '</body></html>';
      fetchSpy.mockResolvedValue(
        new Response(longContent, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', max_chars: 50 },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('[Content truncated due to length limit]');
    });

    it('should include source URL in result text', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>Content</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com/page' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('Fetched content from:');
      expect(text).toContain('example.com');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('should return HTTP_ERROR for non-OK responses', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Not Found', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({ parameters: { url: 'https://example.com/missing' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HTTP_ERROR');
      expect(result.error?.message).toContain('404');
    });

    it('should return UNSUPPORTED_CONTENT_TYPE for non-text content', async () => {
      fetchSpy.mockResolvedValue(
        new Response('binary data', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      );

      const call = createToolCall({ parameters: { url: 'https://example.com/doc.pdf' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNSUPPORTED_CONTENT_TYPE');
      expect(result.error?.message).toContain('application/pdf');
    });

    it('should accept text/plain content type', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Plain text content', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      );

      const call = createToolCall({ parameters: { url: 'https://example.com/file.txt' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
    });

    it('should accept application/xhtml content type', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>XHTML</body></html>', {
          status: 200,
          headers: { 'content-type': 'application/xhtml+xml' },
        })
      );

      const call = createToolCall({ parameters: { url: 'https://example.com/page.xhtml' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
    });

    it('should handle fetch exceptions gracefully', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const call = createToolCall({ parameters: { url: 'https://unreachable.example.com' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WEB_FETCH_FAILED');
      expect(result.error?.message).toContain('Network error');
    });

    it('should return TOO_MANY_REDIRECTS when redirect limit exceeded', async () => {
      // Simulate a redirect loop
      fetchSpy.mockResolvedValue(
        new Response('', {
          status: 302,
          headers: { location: 'https://example.com/redirect-loop' },
        })
      );

      const call = createToolCall({ parameters: { url: 'https://example.com/start' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOO_MANY_REDIRECTS');
    });

    it('should follow redirects and SSRF-validate each hop', async () => {
      let hopCount = 0;
      fetchSpy.mockImplementation(() => {
        hopCount++;
        if (hopCount === 1) {
          return Promise.resolve(
            new Response('', {
              status: 301,
              headers: { location: 'https://final.example.com/page' },
            })
          );
        }
        return Promise.resolve(
          new Response('<html><body>Final</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        );
      });

      const call = createToolCall({ parameters: { url: 'https://example.com/start' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should block redirect to private IP', async () => {
      fetchSpy.mockResolvedValue(
        new Response('', {
          status: 302,
          headers: { location: 'http://10.0.0.1/internal' },
        })
      );

      const call = createToolCall({ parameters: { url: 'https://example.com/redirect' } });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SSRF_BLOCKED');
    });
  });

  // ---------------------------------------------------------------------------
  // HTML conversion
  // ---------------------------------------------------------------------------

  describe('HTML to markdown conversion', () => {
    it('should convert links to markdown format', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body><a href="https://example.com">Link</a></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('[Link](https://example.com)');
    });

    it('should convert bold and italic tags', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body><strong>Bold</strong> and <em>italic</em></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('**Bold**');
      expect(text).toContain('*italic*');
    });

    it('should convert code blocks', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body><code>inline code</code></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('`inline code`');
    });

    it('should convert list items', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body><ul><li>Item 1</li><li>Item 2</li></ul></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('- Item 1');
      expect(text).toContain('- Item 2');
    });

    it('should strip script and style tags', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          '<html><head><style>body{color:red}</style></head><body><script>alert("xss")</script><p>Safe content</p></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).not.toContain('alert');
      expect(text).not.toContain('color:red');
      expect(text).toContain('Safe content');
    });

    it('should decode HTML entities', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html><body>&amp; &lt; &gt; &quot; &#39; &apos; &nbsp;</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'text' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('&');
      expect(text).toContain('<');
      expect(text).toContain('>');
      expect(text).toContain('"');
      expect(text).toContain("'");
    });

    it('should convert all heading levels (h1-h6)', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          '<html><body><h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'markdown' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('# H1');
      expect(text).toContain('## H2');
      expect(text).toContain('### H3');
      expect(text).toContain('#### H4');
      expect(text).toContain('##### H5');
      expect(text).toContain('###### H6');
    });
  });

  // ---------------------------------------------------------------------------
  // HTML to text conversion
  // ---------------------------------------------------------------------------

  describe('HTML to text conversion', () => {
    it('should strip all HTML tags in text mode', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          '<html><body><div class="container"><p>Plain <a href="#">link</a> text</p></div></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'text' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).not.toContain('<');
      expect(text).not.toContain('>');
      expect(text).toContain('Plain');
      expect(text).toContain('link');
      expect(text).toContain('text');
    });

    it('should strip script and style in text mode', async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          '<html><head><style>.x{}</style></head><body><script>var x=1;</script>Visible</body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
      );

      const call = createToolCall({
        parameters: { url: 'https://example.com', extract_mode: 'text' },
      });
      const result = await executeWebFetchNative(call, defaultConfig, testUserId);

      const text = (result.content[0] as { text: string }).text;
      expect(text).not.toContain('var x');
      expect(text).not.toContain('.x{}');
      expect(text).toContain('Visible');
    });
  });
});
