/**
 * Web search tool schemas for LLM tool calling
 *
 * This tool enables the LLM to search the web using the Brave Search API.
 * It runs natively in the gateway process (no container required).
 */

import type { ToolCall, ToolResult } from '@nachos/types';

const MAX_OUTPUT_SIZE = 50 * 1024; // 50KB limit for large result sets

/**
 * Rate limiting state
 */
interface RateLimitState {
  calls: number;
  windowStart: number;
}

const rateLimitState = new Map<string, RateLimitState>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_CALLS_PER_WINDOW = 20;

/**
 * Brave Search API configuration
 */
export interface WebSearchConfig {
  api_key: string;
  default_country?: string;
  safe_search?: 'off' | 'moderate' | 'strict';
  max_results?: number;
}

/**
 * web_search tool schema
 */
export const WebSearchToolSchema = {
  $id: 'web_search',
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query text',
    },
    count: {
      type: 'number',
      description: 'Number of results to return (1-20, default: 10)',
      minimum: 1,
      maximum: 20,
    },
    country: {
      type: 'string',
      description: 'Two-letter country code for region-specific results (e.g., "US", "DE", "GB")',
    },
    search_lang: {
      type: 'string',
      description: 'Language code for search results (e.g., "en", "de", "fr")',
    },
    freshness: {
      type: 'string',
      description:
        'Filter by discovery time: "pd" (past day), "pw" (past week), "pm" (past month), "py" (past year), or date range "YYYY-MM-DDtoYYYY-MM-DD"',
    },
    safe_search: {
      type: 'string',
      enum: ['off', 'moderate', 'strict'],
      description: 'Safe search filtering level (default: "moderate")',
    },
  },
  required: ['query'],
};

/**
 * Brave Search API response types
 */
interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveSearchResult[];
  };
  query?: {
    original: string;
  };
}

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
 * Format search results as readable text
 */
function formatResults(results: BraveSearchResult[], query: string): string {
  if (!results || results.length === 0) {
    return `No results found for: "${query}"`;
  }

  let output = `Found ${results.length} results for: "${query}"\n\n`;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue;

    const index = i + 1;

    output += `${index}. ${result.title || 'Untitled'}\n`;
    output += `   ${result.url || ''}\n`;

    if (result.description) {
      output += `   ${result.description}\n`;
    }

    if (result.age) {
      output += `   (${result.age})\n`;
    }

    output += '\n';
  }

  // Truncate if too large
  if (output.length > MAX_OUTPUT_SIZE) {
    output = output.substring(0, MAX_OUTPUT_SIZE) + '\n\n[Output truncated due to size limit]';
  }

  return output.trim();
}

/**
 * Execute web_search tool
 */
export async function executeWebSearch(
  call: ToolCall,
  config: WebSearchConfig,
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
      query?: string;
      count?: number;
      country?: string;
      search_lang?: string;
      freshness?: string;
      safe_search?: string;
    };

    if (!params.query || typeof params.query !== 'string') {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'query parameter is required and must be a string',
        },
      };
    }

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('q', params.query);
    queryParams.set('count', String(params.count || config.max_results || 10));

    if (params.country || config.default_country) {
      queryParams.set('country', params.country || config.default_country!);
    }

    if (params.search_lang) {
      queryParams.set('search_lang', params.search_lang);
    }

    if (params.freshness) {
      queryParams.set('freshness', params.freshness);
    }

    const safeSearch = params.safe_search || config.safe_search || 'moderate';
    queryParams.set('safesearch', safeSearch);

    // Make API request
    const url = `https://api.search.brave.com/res/v1/web/search?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': config.api_key,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          content: [],
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: 'Invalid Brave Search API key',
          },
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          content: [],
          error: {
            code: 'API_RATE_LIMIT',
            message: 'Brave Search API rate limit exceeded',
          },
        };
      }

      return {
        success: false,
        content: [],
        error: {
          code: 'API_ERROR',
          message: `Brave Search API error: ${response.status} ${response.statusText}`,
        },
      };
    }

    const data = (await response.json()) as BraveSearchResponse;
    const results = data.web?.results || [];
    const formattedOutput = formatResults(results, params.query);

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: formattedOutput,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      content: [],
      error: {
        code: 'WEB_SEARCH_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during web search',
      },
    };
  }
}
