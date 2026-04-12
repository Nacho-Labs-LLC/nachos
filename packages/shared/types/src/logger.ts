/**
 * Structured Logger
 *
 * Lightweight wrapper around pino for structured JSON logging.
 * Pretty-prints in development, JSON in production.
 */

import pino from 'pino';

export type Logger = pino.Logger;

/**
 * Create a structured logger for a named component.
 *
 * @param component - Component name (e.g. 'gateway', 'bus', 'llm-proxy')
 * @returns A pino Logger instance with the component tag
 */
export function createLogger(component: string): Logger {
  const isDev = process.env['NODE_ENV'] === 'development';

  return pino({
    name: component,
    level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}
