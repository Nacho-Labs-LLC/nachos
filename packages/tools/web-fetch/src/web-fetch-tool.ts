/**
 * Web Fetch Tool
 *
 * Fetches a URL and extracts readable content as text or markdown.
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
  createToolFailedError,
} from '@nachos/types';
import { SSRFProtection } from './ssrf-protection.js';

type ExtractMode = 'text' | 'markdown';

type FetchConfig = {
  allowed_domains: string[];
  max_chars: number;
  timeout_seconds: number;
  max_redirects: number;
  user_agent?: string;
};

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
      const normalized = this.clampContent(extracted.content, maxChars);
      const result = {
        url: response.finalUrl,
        source: 'http',
        mode: extractMode,
        title: extracted.title,
        content: normalized.text,
        length: normalized.text.length,
        truncated: normalized.truncated,
      };

      return this.formatTextResponse(JSON.stringify(result, null, 2));
    } catch (error) {
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
            throw createToolFailedError(
              `Redirect response missing location header (${response.status})`,
              { component: 'web-fetch' }
            );
          }

          if (redirects >= this.fetchConfig.max_redirects) {
            throw createToolFailedError('Too many redirects', { component: 'web-fetch' });
          }

          const nextUrl = new URL(location, currentUrl).toString();
          const redirectValidation = await this.ssrfProtection.validateURL(nextUrl);
          if (!redirectValidation.valid) {
            throw createToolFailedError(
              redirectValidation.errors?.join('; ') ?? 'Redirect blocked by SSRF protection',
              { component: 'web-fetch' }
            );
          }

          redirects += 1;
          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          throw createToolFailedError(`HTTP ${response.status} ${response.statusText}`, {
            component: 'web-fetch',
          });
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
}
