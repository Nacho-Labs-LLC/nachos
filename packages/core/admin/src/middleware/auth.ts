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

function resolveToken(): string {
  let token = process.env['NACHOS_ADMIN_TOKEN'];

  if (!token) {
    token = randomBytes(32).toString('hex');
    logger.warn(
      { tokenHint: token.slice(-8) },
      'NACHOS_ADMIN_TOKEN not set — generated session token (ends: ...%s)',
      token.slice(-8)
    );
  }

  return token;
}

let cachedToken: string | null = null;

function getToken(): string {
  if (!cachedToken) {
    cachedToken = resolveToken();
  }
  return cachedToken;
}

/** Validate a token against the admin token. */
export function verifyToken(provided: string): boolean {
  return safeCompare(provided, getToken());
}

export function authMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const cookieToken = getCookie(c, 'nachos_admin_token');

    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!provided || !verifyToken(provided)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}
