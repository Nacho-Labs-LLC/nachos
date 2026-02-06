/**
 * Playwright Wrapper
 *
 * Wraps Playwright functionality for browser automation
 * Handles browser context management and page operations
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/**
 * Browser context information
 */
export interface BrowserContextInfo {
  contextId: string;
  pageCount: number;
  createdAt: number;
}

/**
 * Screenshot options
 */
export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  quality?: number;
}

/**
 * Extract options
 */
export interface ExtractOptions {
  selector?: string;
  extractLinks?: boolean;
  extractImages?: boolean;
}

/**
 * Playwright wrapper for browser automation
 */
export class PlaywrightWrapper {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private currentPages: Map<string, Page> = new Map();
  private headless: boolean;
  private timeout: number;

  constructor(headless: boolean = true, timeout: number = 30000) {
    this.headless = headless;
    this.timeout = timeout;
  }

  /**
   * Initialize browser
   */
  async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    // Close all contexts
    for (const [contextId, context] of this.contexts) {
      await context.close();
      this.contexts.delete(contextId);
    }

    // Clear pages
    this.currentPages.clear();

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Create a new browser context
   */
  async createContext(contextId: string): Promise<void> {
    if (!this.browser) {
      await this.initialize();
    }

    if (this.contexts.has(contextId)) {
      throw new Error(`Context ${contextId} already exists`);
    }

    const context = await this.browser!.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Nachos/1.0',
    });

    // Set default timeout
    context.setDefaultTimeout(this.timeout);

    this.contexts.set(contextId, context);

    // Create initial page
    const page = await context.newPage();
    this.currentPages.set(contextId, page);
  }

  /**
   * Close a browser context
   */
  async closeContext(contextId: string): Promise<void> {
    const context = this.contexts.get(contextId);
    if (context) {
      await context.close();
      this.contexts.delete(contextId);
      this.currentPages.delete(contextId);
    }
  }

  /**
   * Get current page for context
   */
  private getPage(contextId: string): Page {
    const page = this.currentPages.get(contextId);
    if (!page) {
      throw new Error(`No page found for context ${contextId}`);
    }
    return page;
  }

  /**
   * Navigate to URL
   */
  async navigate(contextId: string, url: string): Promise<void> {
    const page = this.getPage(contextId);
    await page.goto(url, { waitUntil: 'networkidle', timeout: this.timeout });
  }

  /**
   * Reload current page
   */
  async reload(contextId: string): Promise<void> {
    const page = this.getPage(contextId);
    await page.reload({ waitUntil: 'networkidle', timeout: this.timeout });
  }

  /**
   * Get current URL
   */
  async getCurrentURL(contextId: string): Promise<string> {
    const page = this.getPage(contextId);
    return page.url();
  }

  /**
   * Take screenshot
   */
  async screenshot(
    contextId: string,
    options: ScreenshotOptions = {}
  ): Promise<Buffer> {
    const page = this.getPage(contextId);

    if (options.selector) {
      // Screenshot specific element
      const element = await page.$(options.selector);
      if (!element) {
        throw new Error(`Element not found: ${options.selector}`);
      }
      return await element.screenshot({ type: 'png' });
    } else {
      // Full page or viewport screenshot
      return await page.screenshot({
        type: 'png',
        fullPage: options.fullPage ?? false,
      });
    }
  }

  /**
   * Extract content from page
   */
  async extract(
    contextId: string,
    options: ExtractOptions = {}
  ): Promise<{
    text: string;
    links?: Array<{ text: string; href: string }>;
    images?: Array<{ alt: string; src: string }>;
  }> {
    const page = this.getPage(contextId);

    const result: {
      text: string;
      links?: Array<{ text: string; href: string }>;
      images?: Array<{ alt: string; src: string }>;
    } = {
      text: '',
    };

    // Extract text
    if (options.selector) {
      const element = await page.$(options.selector);
      if (element) {
        result.text = (await element.textContent()) ?? '';
      }
    } else {
      result.text = await page.textContent('body') ?? '';
    }

    // Extract links
    if (options.extractLinks) {
      result.links = await page.evaluate(() => {
        const doc = (globalThis as unknown as {
          document?: { querySelectorAll: (selector: string) => ArrayLike<unknown> };
        }).document;

        if (!doc) {
          return [];
        }

        const links = Array.from(doc.querySelectorAll('a')) as Array<{
          textContent?: string | null;
          href?: string;
        }>;

        return links.map((link) => ({
          text: link.textContent?.trim() ?? '',
          href: link.href ?? '',
        }));
      });
    }

    // Extract images
    if (options.extractImages) {
      result.images = await page.evaluate(() => {
        const doc = (globalThis as unknown as {
          document?: { querySelectorAll: (selector: string) => ArrayLike<unknown> };
        }).document;

        if (!doc) {
          return [];
        }

        const images = Array.from(doc.querySelectorAll('img')) as Array<{
          alt?: string | null;
          src?: string;
        }>;

        return images.map((img) => ({
          alt: img.alt ?? '',
          src: img.src ?? '',
        }));
      });
    }

    return result;
  }

  /**
   * Get all contexts
   */
  getContexts(): BrowserContextInfo[] {
    return Array.from(this.contexts.entries()).map(([contextId, context]) => ({
      contextId,
      pageCount: context.pages().length,
      createdAt: Date.now(), // Approximation
    }));
  }

  /**
   * Check if context exists
   */
  hasContext(contextId: string): boolean {
    return this.contexts.has(contextId);
  }

  /**
   * Get context
   */
  getContext(contextId: string): BrowserContext | undefined {
    return this.contexts.get(contextId);
  }
}
