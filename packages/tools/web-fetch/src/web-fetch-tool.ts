/**
 * Web Fetch Tool
 *
 * Fetches a URL and extracts readable content as text or markdown.
 * Optional Firecrawl fallback for hard-to-extract pages.
 *
 * SecurityTier: STANDARD (1) - Read-only network operations
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { ToolService } from '@nachos/tool-base';
import {
  SecurityTier,
  type ToolConfig,
  type ToolParameters,
  type ToolResult,
  type ToolValidationResult,
  type ToolHealthStatus,
  type ParameterSchema,
} from '@nachos/types';
import { SSRFProtection } from './ssrf-protection.js';

type ExtractMode = 'text' | 'markdown';

type FirecrawlConfig = {
  enabled?: boolean;
  api_key?: string;
  base_url?: string;
  only_main_content?: boolean;
  max_age_ms?: number;
  timeout_seconds?: number;
};

type FirecrawlResult = {
  url: string;
  mode: ExtractMode;
  source: 'firecrawl';
  content: string;
  length: number;
  truncated: boolean;
};

type FetchConfig = {
  allowed_domains: string[];
  max_chars: number;
  timeout_seconds: number;
  max_redirects: number;
  user_agent?: string;
  firecrawl?: FirecrawlConfig;
};

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MIN_CONTENT_CHARS = 200;

export class WebFetchTool extends ToolService {
  readonly toolId = 'web_fetch';
  readonly name = 'Web Fetch';
  readonly description = 'Fetch a URL and extract readable content as text or markdown.';
  readonly securityTier = SecurityTier.STANDARD;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch (http/https only)',
      },
      extract_mode: {
        type: 'string',
        description: 'Extraction mode',
        enum: ['text', 'markdown'],
        default: 'markdown',
      },
      max_chars: {
        type: 'number',
        description: 'Maximum characters to return (override config default)',
      },
    },
    required: ['url'],
  };

  private ssrfProtection!: SSRFProtection;
  private fetchConfig!: FetchConfig;
  private turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  async initialize(config: ToolConfig): Promise<void> {
    const allowedDomains = (config.config.allowed_domains as string[]) ?? ['*'];

    this.fetchConfig = {
      allowed_domains: allowedDomains,
      max_chars: (config.config.max_chars as number) ?? 50000,
      timeout_seconds: (config.config.timeout_seconds as number) ?? 30,
      max_redirects: (config.config.max_redirects as number) ?? 3,
      user_agent: (config.config.user_agent as string) ?? DEFAULT_USER_AGENT,
      firecrawl: (config.config.firecrawl as FirecrawlConfig) ?? {},
    };

    this.ssrfProtection = new SSRFProtection({
      allowedDomains: allowedDomains,
      blockPrivateIPs: true,
      blockLocalhost: true,
    });

    this.logger.info(
      `Initialized with allowed domains: ${this.ssrfProtection.getAllowedDomains().join(', ')}`
    );
  }

  validate(params: ToolParameters): ToolValidationResult {
    const requiredValidation = this.validateRequired(params, 'url');
    if (!requiredValidation.valid) {
      return requiredValidation;
    }

    const urlTypeValidation = this.validateType(params, 'url', 'string');
    if (!urlTypeValidation.valid) {
      return urlTypeValidation;
    }

    if (params.extract_mode) {
      const modeValidation = this.validateEnum(params, 'extract_mode', ['text', 'markdown']);
      if (!modeValidation.valid) {
        return modeValidation;
      }
    }

    if (params.max_chars !== undefined) {
      const maxCharsValidation = this.validateType(params, 'max_chars', 'number');
      if (!maxCharsValidation.valid) {
        return maxCharsValidation;
      }
    }

    return { valid: true };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const url = params.url as string;
    const extractMode = (params.extract_mode as ExtractMode) ?? 'markdown';
    const maxChars =
      typeof params.max_chars === 'number' && Number.isFinite(params.max_chars)
        ? params.max_chars
        : this.fetchConfig.max_chars;

    const validation = await this.ssrfProtection.validateURL(url);
    if (!validation.valid) {
      return this.formatErrorResponse(
        'SSRF_BLOCKED',
        validation.errors?.join('; ') ?? 'URL blocked by SSRF protection'
      );
    }

    try {
      const response = await this.fetchWithRedirects(url);
      const extracted = await this.extractContent(response.finalUrl, response.body, extractMode);

      if (extracted.content.length < MIN_CONTENT_CHARS && this.isFirecrawlEnabled()) {
        const fallback = await this.fetchWithFirecrawl(url, extractMode, maxChars);
        if (fallback) {
          return this.formatTextResponse(JSON.stringify(fallback, null, 2));
        }
      }

      const normalized = this.clampContent(extracted.content, maxChars);
      const result = {
        url: response.finalUrl,
        mode: extractMode,
        source: 'http',
        title: extracted.title,
        content: normalized.text,
        length: normalized.text.length,
        truncated: normalized.truncated,
      };

      return this.formatTextResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      if (this.isFirecrawlEnabled()) {
        const fallback = await this.fetchWithFirecrawl(url, extractMode, maxChars);
        if (fallback) {
          return this.formatTextResponse(JSON.stringify(fallback, null, 2));
        }
      }

      return this.formatErrorResponse(
        'FETCH_FAILED',
        error instanceof Error ? error.message : 'Failed to fetch URL'
      );
    }
  }

  async healthCheck(): Promise<ToolHealthStatus> {
    return { healthy: true };
  }

  private async fetchWithRedirects(url: string): Promise<{ finalUrl: string; body: string }> {
    let currentUrl = url;
    let redirects = 0;

    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.fetchConfig.timeout_seconds * 1000);

      try {
        const response = await fetch(currentUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': this.fetchConfig.user_agent ?? DEFAULT_USER_AGENT,
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`Redirect response missing location header (${response.status})`);
          }

          if (redirects >= this.fetchConfig.max_redirects) {
            throw new Error('Too many redirects');
          }

          const nextUrl = new URL(location, currentUrl).toString();
          const redirectValidation = await this.ssrfProtection.validateURL(nextUrl);
          if (!redirectValidation.valid) {
            throw new Error(
              redirectValidation.errors?.join('; ') ?? 'Redirect blocked by SSRF protection'
            );
          }

          redirects += 1;
          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const body = await response.text();
        return { finalUrl: currentUrl, body };
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async extractContent(
    url: string,
    body: string,
    mode: ExtractMode
  ): Promise<{ title?: string; content: string }> {
    const contentType = this.detectContentType(body);

    if (contentType !== 'html') {
      return { content: body };
    }

    const dom = new JSDOM(body, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const title = article?.title ?? dom.window.document.title ?? undefined;

    const html = article?.content ?? dom.window.document.body?.innerHTML ?? '';
    const text = article?.textContent ?? dom.window.document.body?.textContent ?? '';

    if (mode === 'text') {
      return { title, content: this.normalizeWhitespace(text) };
    }

    const markdown = html ? this.turndown.turndown(html) : this.turndown.turndown(body);
    return { title, content: markdown };
  }

  private detectContentType(body: string): 'html' | 'text' {
    const trimmed = body.trimStart();
    if (
      trimmed.startsWith('<!DOCTYPE html') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<')
    ) {
      return 'html';
    }
    return 'text';
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private clampContent(content: string, maxChars: number): { text: string; truncated: boolean } {
    if (content.length <= maxChars) {
      return { text: content, truncated: false };
    }
    return { text: content.slice(0, maxChars), truncated: true };
  }

  private isFirecrawlEnabled(): boolean {
    return Boolean(this.fetchConfig.firecrawl?.enabled && this.fetchConfig.firecrawl?.api_key);
  }

  private async fetchWithFirecrawl(
    url: string,
    mode: ExtractMode,
    maxChars: number
  ): Promise<FirecrawlResult | null> {
    const firecrawl = this.fetchConfig.firecrawl ?? {};
    if (!firecrawl.api_key) {
      return null;
    }

    const baseUrl = firecrawl.base_url ?? 'https://api.firecrawl.dev';
    const timeoutSeconds = firecrawl.timeout_seconds ?? 60;
    const onlyMainContent = firecrawl.only_main_content ?? true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/scrape`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${firecrawl.api_key}`,
        },
        body: JSON.stringify({
          url,
          formats: mode === 'markdown' ? ['markdown'] : ['text'],
          onlyMainContent,
          maxAge: firecrawl.max_age_ms ? Math.floor(firecrawl.max_age_ms / 1000) : undefined,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        success?: boolean;
        data?: { markdown?: string; text?: string };
      };

      if (!payload.success || !payload.data) {
        return null;
      }

      const content = mode === 'markdown' ? payload.data.markdown : payload.data.text;
      if (!content) {
        return null;
      }

      const normalized = this.clampContent(content, maxChars);
      return {
        url,
        mode,
        source: 'firecrawl',
        content: normalized.text,
        length: normalized.text.length,
        truncated: normalized.truncated,
      };
    } catch (error) {
      this.logger.warn(
        'Firecrawl fallback failed:',
        error instanceof Error ? error.message : error
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
