/**
 * Browser Tool
 *
 * Provides browser automation with 5 core actions:
 * - navigate: Navigate to URL
 * - screenshot: Capture page screenshot
 * - extract: Extract content (text/links/images)
 * - get_url: Get current URL
 * - reload: Reload current page
 *
 * SecurityTier: STANDARD (1) - Read-only browser operations
 */

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
import { PlaywrightWrapper } from './playwright-wrapper.js';

/**
 * Browser actions
 */
type BrowserAction = 'navigate' | 'screenshot' | 'extract' | 'get_url' | 'reload';

/**
 * Browser tool
 */
export class BrowserTool extends ToolService {
  readonly toolId = 'browser';
  readonly name = 'Browser';
  readonly description =
    'Web browser automation for navigation, screenshots, and content extraction';
  readonly securityTier = SecurityTier.STANDARD;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Browser action to perform',
        enum: ['navigate', 'screenshot', 'extract', 'get_url', 'reload'],
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (for navigate action)',
      },
      contextId: {
        type: 'string',
        description: 'Browser context ID (defaults to sessionId)',
      },
      fullPage: {
        type: 'boolean',
        description: 'Capture full page screenshot (for screenshot action)',
        default: false,
      },
      selector: {
        type: 'string',
        description: 'CSS selector for element (for screenshot/extract actions)',
      },
      extractLinks: {
        type: 'boolean',
        description: 'Extract links from page (for extract action)',
        default: false,
      },
      extractImages: {
        type: 'boolean',
        description: 'Extract images from page (for extract action)',
        default: false,
      },
    },
    required: ['action'],
  };

  private ssrfProtection!: SSRFProtection;
  private playwright!: PlaywrightWrapper;
  private headless: boolean = true;
  private timeout: number = 30000;

  async initialize(config: ToolConfig): Promise<void> {
    // Get configuration
    const allowedDomains = (config.config.allowed_domains as string[]) ?? ['*'];
    this.headless = (config.config.headless as boolean) ?? true;
    this.timeout = (config.config.timeout as number) ?? 30000;

    // Initialize SSRF protection
    this.ssrfProtection = new SSRFProtection({
      allowedDomains,
      blockPrivateIPs: true,
      blockLocalhost: true,
    });

    // Initialize Playwright
    this.playwright = new PlaywrightWrapper(this.headless, this.timeout);
    await this.playwright.initialize();

    this.logger.info(
      `Initialized with allowed domains: ${this.ssrfProtection.getAllowedDomains().join(', ')}`
    );
    this.logger.info(`Headless mode: ${this.headless}`);
  }

  validate(params: ToolParameters): ToolValidationResult {
    // Validate required fields
    const requiredValidation = this.validateRequired(params, 'action');
    if (!requiredValidation.valid) {
      return requiredValidation;
    }

    // Validate action enum
    const actionValidation = this.validateEnum(params, 'action', [
      'navigate',
      'screenshot',
      'extract',
      'get_url',
      'reload',
    ]);
    if (!actionValidation.valid) {
      return actionValidation;
    }

    // Validate URL for navigate action
    const action = params.action as BrowserAction;
    if (action === 'navigate') {
      const urlValidation = this.validateRequired(params, 'url');
      if (!urlValidation.valid) {
        return urlValidation;
      }

      const urlTypeValidation = this.validateType(params, 'url', 'string');
      if (!urlTypeValidation.valid) {
        return urlTypeValidation;
      }
    }

    return { valid: true };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const action = params.action as BrowserAction;
    const contextId = (params.contextId as string) ?? params.sessionId;

    try {
      // Ensure context exists
      if (!this.playwright.hasContext(contextId)) {
        await this.playwright.createContext(contextId);
        this.logger.info(`Created browser context: ${contextId}`);
      }

      // Execute action
      switch (action) {
        case 'navigate':
          return await this.navigateAction(contextId, params);

        case 'screenshot':
          return await this.screenshotAction(contextId, params);

        case 'extract':
          return await this.extractAction(contextId, params);

        case 'get_url':
          return await this.getURLAction(contextId);

        case 'reload':
          return await this.reloadAction(contextId);

        default:
          return this.formatErrorResponse('INVALID_ACTION', `Unknown action: ${action}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        return this.formatErrorResponse('EXECUTION_ERROR', error.message);
      }
      return this.formatErrorResponse('UNKNOWN_ERROR', 'Unknown error occurred');
    }
  }

  /**
   * Navigate to URL
   */
  private async navigateAction(contextId: string, params: ToolParameters): Promise<ToolResult> {
    const url = params.url as string;

    // Validate URL with SSRF protection
    const validation = await this.ssrfProtection.validateURL(url);
    if (!validation.valid) {
      return this.formatErrorResponse(
        'SSRF_BLOCKED',
        validation.errors?.join('; ') ?? 'URL blocked by SSRF protection'
      );
    }

    // Navigate
    await this.playwright.navigate(contextId, url);

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          action: 'navigate',
          url,
          contextId,
        },
        null,
        2
      )
    );
  }

  /**
   * Take screenshot
   */
  private async screenshotAction(contextId: string, params: ToolParameters): Promise<ToolResult> {
    const fullPage = params.fullPage === true;
    const selector = params.selector as string | undefined;

    // Take screenshot
    const screenshot = await this.playwright.screenshot(contextId, {
      fullPage,
      selector,
    });

    // Convert to base64
    const base64 = screenshot.toString('base64');

    // Return as image content
    return this.formatImageResponse(base64, 'image/png', 'base64', {
      duration: 0,
      warnings: selector ? [`Screenshot of element: ${selector}`] : undefined,
    });
  }

  /**
   * Extract content from page
   */
  private async extractAction(contextId: string, params: ToolParameters): Promise<ToolResult> {
    const selector = params.selector as string | undefined;
    const extractLinks = params.extractLinks === true;
    const extractImages = params.extractImages === true;

    // Extract content
    const content = await this.playwright.extract(contextId, {
      selector,
      extractLinks,
      extractImages,
    });

    // Format as JSON
    const result = JSON.stringify(
      {
        success: true,
        action: 'extract',
        contextId,
        content,
      },
      null,
      2
    );

    return this.formatTextResponse(result);
  }

  /**
   * Get current URL
   */
  private async getURLAction(contextId: string): Promise<ToolResult> {
    const url = await this.playwright.getCurrentURL(contextId);

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          action: 'get_url',
          contextId,
          url,
        },
        null,
        2
      )
    );
  }

  /**
   * Reload current page
   */
  private async reloadAction(contextId: string): Promise<ToolResult> {
    await this.playwright.reload(contextId);

    return this.formatTextResponse(
      JSON.stringify(
        {
          success: true,
          action: 'reload',
          contextId,
        },
        null,
        2
      )
    );
  }

  /**
   * Stop the tool and cleanup
   */
  override async stop(): Promise<void> {
    await this.playwright.close();
    await super.stop();
  }

  override async healthCheck(): Promise<ToolHealthStatus> {
    try {
      // Check if playwright is initialized
      if (!this.playwright) {
        return {
          healthy: false,
          error: 'Playwright not initialized',
        };
      }

      // Get context count
      const contexts = this.playwright.getContexts();

      return {
        healthy: true,
        details: {
          contexts: contexts.length,
          allowedDomains: this.ssrfProtection.getAllowedDomains(),
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
