/**
 * Bootstrap content sanitization to prevent prompt injection attacks
 */

import { createLogger } from '@nachos/types';

const logger = createLogger('bootstrap-sanitizer');

/**
 * Known prompt injection patterns to detect
 */
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|the)\s+(instructions?|rules?|prompts?)/i,
  /you\s+are\s+now\s+(admin|administrator|root|system)/i,
  /disregard\s+(previous|all|the)\s+(instructions?|rules?|commands?)/i,
  /forget\s+(everything|all)\s+(you|that)\s+(know|learned)/i,
  /new\s+(instruction|rule|prompt|system)/i,
  /override\s+(system|security|policy)/i,
  /act\s+as\s+(admin|root|system)/i,
  /\[system\]/i,
  /<system>/i,
  /{{system}}/i,
];

/**
 * Integrity delimiter for wrapping bootstrap blocks
 */
const BOOTSTRAP_DELIMITER_START = '<!-- BOOTSTRAP_CONTENT_START -->';
const BOOTSTRAP_DELIMITER_END = '<!-- BOOTSTRAP_CONTENT_END -->';

/**
 * Sanitize bootstrap content to prevent prompt injection
 */
export function sanitizeBootstrapContent(content: string): {
  sanitized: string;
  hasInjection: boolean;
} {
  let hasInjection = false;

  // Check for injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      hasInjection = true;
      logger.warn(
        { pattern: pattern.source },
        'Detected potential prompt injection pattern in bootstrap content'
      );
    }
  }

  // Wrap content in integrity-checked delimiters
  const sanitized = `${BOOTSTRAP_DELIMITER_START}\n${content}\n${BOOTSTRAP_DELIMITER_END}`;

  return { sanitized, hasInjection };
}

/**
 * Unwrap bootstrap content from delimiters (for display/editing)
 */
export function unwrapBootstrapContent(content: string): string {
  if (content.includes(BOOTSTRAP_DELIMITER_START) && content.includes(BOOTSTRAP_DELIMITER_END)) {
    return content
      .replace(BOOTSTRAP_DELIMITER_START, '')
      .replace(BOOTSTRAP_DELIMITER_END, '')
      .trim();
  }
  return content;
}
