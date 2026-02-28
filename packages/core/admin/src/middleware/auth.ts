import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createLogger } from '@nachos/types';

const logger = createLogger('admin-auth');

/**
 * Timing-safe token comparison that handles length mismatches gracefully.
 * Returns false (without leaking timing info about the expected token length)
 * when the provided value differs in length from the expected token.
 */
function safeCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Compare against itself to burn the same CPU time, then return false
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function authMiddleware(): MiddlewareHandler {
  let token = process.env['NACHOS_ADMIN_TOKEN'];

  if (!token) {
    token = randomBytes(32).toString('hex');
    logger.warn(
      { tokenHint: token.slice(-8) },
      'NACHOS_ADMIN_TOKEN not set — generated session token (ends: ...%s)',
      token.slice(-8)
    );
  }

  // Capture in a const so TypeScript knows it is definitely a string
  const resolvedToken: string = token;

  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const cookieToken = getCookie(c, 'nachos_admin_token');

    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!provided || !safeCompare(provided, resolvedToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}
