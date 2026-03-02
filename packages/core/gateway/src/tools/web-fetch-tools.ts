/**
 * Web fetch tool schemas for LLM tool calling
 *
 * This tool enables the LLM to fetch and read individual web pages.
 * It runs natively in the gateway process (no container required).
 * This complements the Docker-based web-fetch tool with a lighter alternative.
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import { SSRFProtection } from './ssrf-protection.js';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const DEFAULT_MAX_CHARS = 50000;

/**
 * Rate limiting state
 */
interface RateLimitState {
  calls: number;
  windowStart: number;
}

const rateLimitState = new Map<string, RateLimitState>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_CALLS_PER_WINDOW = 10;

/**
 * Web fetch configuration
 */
export interface WebFetchConfig {
  timeout_ms?: number;
  max_chars?: number;
  domain_allowlist?: string[];
}

/**
 * web_fetch_native tool schema
 * Using a different name to avoid conflict with the Docker-based web_fetch tool
 */
export const WebFetchNativeToolSchema = {
  $id: 'web_fetch_native',
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'URL to fetch (http or https)',
    },
    extract_mode: {
      type: 'string',
      enum: ['markdown', 'text'],
      description:
        'Extraction mode: "markdown" for structured content, "text" for plain text (default: "markdown")',
    },
    max_chars: {
      type: 'number',
      description: 'Maximum characters to return (default: 50000)',
    },
  },
  required: ['url'],
};

/**
 * Check and update rate limit for a user
 */
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const state = rateLimitState.get(userId);

  if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // Start new window
    rateLimitState.set(userId, {
      calls: 1,
      windowStart: now,
    });
    return true;
  }

  if (state.calls >= MAX_CALLS_PER_WINDOW) {
    return false;
  }

  state.calls++;
  return true;
}

/**
 * Validate URL and check domain allowlist
 */
function validateUrl(
  urlString: string,
  domainAllowlist?: string[]
): { valid: boolean; error?: string; url?: URL } {
  try {
    const url = new URL(urlString);

    // Only allow http and https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        valid: false,
        error: 'Only http and https URLs are allowed',
      };
    }

    // Check for private/local addresses (SSRF protection)
    const hostname = url.hostname.toLowerCase();
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
    ];

    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        return {
          valid: false,
          error: 'Access to private/local addresses is not allowed',
        };
      }
    }

    // Check domain allowlist if configured
    if (domainAllowlist && domainAllowlist.length > 0) {
      const allowed = domainAllowlist.some((domain) => {
        const normalizedDomain = domain.toLowerCase();
        return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
      });

      if (!allowed) {
        return {
          valid: false,
          error: `Domain ${hostname} is not in the allowlist`,
        };
      }
    }

    return {
      valid: true,
      url,
    };
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format',
    };
  }
}

/**
 * Simple HTML to text conversion
 */
function htmlToText(html: string): string {
  let text = html;

  // Remove script and style tags
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert common tags to newlines
  text = text.replace(/<\/?(div|p|br|hr|h[1-6]|li|tr)[^>]*>/gi, '\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n'); // Reduce multiple newlines
  text = text.replace(/[ \t]+/g, ' '); // Normalize spaces
  text = text.trim();

  return text;
}

/**
 * Simple HTML to markdown conversion
 */
function htmlToMarkdown(html: string): string {
  let markdown = html;

  // Remove script and style tags
  markdown = markdown.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  markdown = markdown.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n');

  // Convert links
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Convert bold and italic
  markdown = markdown.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, '**$2**');
  markdown = markdown.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, '*$2*');

  // Convert code
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  markdown = markdown.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '```\n$1\n```');

  // Convert lists
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Convert line breaks
  markdown = markdown.replace(/<br[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/?(div|p|hr)[^>]*>/gi, '\n\n');

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  markdown = markdown
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Clean up whitespace
  markdown = markdown.replace(/\n\s*\n\s*\n/g, '\n\n');
  markdown = markdown.replace(/[ \t]+/g, ' ');
  markdown = markdown.trim();

  return markdown;
}

/**
 * Execute web_fetch_native tool
 */
export async function executeWebFetchNative(
  call: ToolCall,
  config: WebFetchConfig,
  userId: string
): Promise<ToolResult> {
  try {
    // Check rate limit
    if (!checkRateLimit(userId)) {
      return {
        success: false,
        content: [],
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded: maximum ${MAX_CALLS_PER_WINDOW} calls per minute`,
        },
      };
    }

    const params = call.parameters as {
      url?: string;
      extract_mode?: string;
      max_chars?: number;
    };

    if (!params.url || typeof params.url !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'url parameter is required and must be a string',
        },
      };
    }

    // Validate URL
    const validation = validateUrl(params.url, config.domain_allowlist);
    if (!validation.valid) {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_URL',
          message: validation.error || 'URL validation failed',
        },
      };
    }

    const url = validation.url!;

    // SSRF protection: validate URL via DNS resolution to catch rebinding attacks
    const ssrf = new SSRFProtection({
      allowedDomains: config.domain_allowlist ?? ['*'],
      blockPrivateIPs: true,
      blockLocalhost: true,
    });
    const ssrfResult = await ssrf.validateURL(url.toString());
    if (!ssrfResult.valid) {
      return {
        success: false,
        content: [],
        error: {
          code: 'SSRF_BLOCKED',
          message: ssrfResult.errors?.join('; ') || 'URL blocked by SSRF protection',
        },
      };
    }

    const extractMode = params.extract_mode || 'markdown';
    const maxChars = params.max_chars || config.max_chars || DEFAULT_MAX_CHARS;
    const timeoutMs = config.timeout_ms || DEFAULT_TIMEOUT_MS;

    // Fetch the page — manually follow redirects so each hop is SSRF-validated
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const ssrfConfig = {
      allowedDomains: config.domain_allowlist ?? ['*'],
      blockPrivateIPs: true,
      blockLocalhost: true,
    };

    let currentUrl = url.toString();
    let response!: Response;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NachosBot/1.0)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break; // No Location header — treat as final response
        if (hop === MAX_REDIRECTS) {
          clearTimeout(timeoutId);
          return {
            success: false,
            content: [],
            error: { code: 'TOO_MANY_REDIRECTS', message: `Exceeded ${MAX_REDIRECTS} redirects` },
          };
        }
        // Validate redirect target before following
        const redirectUrl = new URL(location, currentUrl).toString();
        const redirectSsrf = new SSRFProtection(ssrfConfig);
        const redirectCheck = await redirectSsrf.validateURL(redirectUrl);
        if (!redirectCheck.valid) {
          clearTimeout(timeoutId);
          return {
            success: false,
            content: [],
            error: {
              code: 'SSRF_BLOCKED',
              message: `Redirect to blocked URL: ${redirectCheck.errors?.join('; ') || 'SSRF protection'}`,
            },
          };
        }
        currentUrl = redirectUrl;
        continue;
      }
      break; // Non-redirect response — done
    }

    try {
      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          content: [],
          error: {
            code: 'HTTP_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        };
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('text/plain') &&
        !contentType.includes('application/xhtml')
      ) {
        return {
          success: false,
          content: [],
          error: {
            code: 'UNSUPPORTED_CONTENT_TYPE',
            message: `Unsupported content type: ${contentType}. Only HTML and plain text are supported.`,
          },
        };
      }

      const html = await response.text();

      // Extract text
      let extracted: string;
      if (extractMode === 'text') {
        extracted = htmlToText(html);
      } else {
        extracted = htmlToMarkdown(html);
      }

      // Truncate if necessary
      if (extracted.length > maxChars) {
        extracted =
          extracted.substring(0, maxChars) + '\n\n[Content truncated due to length limit]';
      }

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: `Fetched content from: ${currentUrl}\n\n---\n\n${extracted}`,
          },
        ],
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if ((fetchError as Error).name === 'AbortError') {
        return {
          success: false,
          content: [],
          error: {
            code: 'TIMEOUT',
            message: `Request timeout after ${timeoutMs}ms`,
          },
        };
      }

      throw fetchError;
    }
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'WEB_FETCH_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during web fetch',
      },
    };
  }
}
