import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

export function authMiddleware(): MiddlewareHandler {
  const token = process.env['NACHOS_ADMIN_TOKEN'];

  if (!token) {
    return async (_c, next) => next();
  }

  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const cookieToken = getCookie(c, 'nachos_admin_token');

    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (provided !== token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}
