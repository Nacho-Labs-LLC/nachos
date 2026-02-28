import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// Mock @nachos/types before importing auth module
vi.mock('@nachos/types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks are set up
const { authMiddleware } = await import('../../middleware/auth.js');

function createApp(token?: string) {
  // Set or clear the env var before creating middleware
  if (token) {
    process.env['NACHOS_ADMIN_TOKEN'] = token;
  } else {
    delete process.env['NACHOS_ADMIN_TOKEN'];
  }

  const app = new Hono();
  app.use('/api/*', authMiddleware());
  app.get('/api/test', (c) => c.json({ ok: true }));
  return app;
}

describe('authMiddleware', () => {
  const savedToken = process.env['NACHOS_ADMIN_TOKEN'];

  afterEach(() => {
    // Restore original env
    if (savedToken !== undefined) {
      process.env['NACHOS_ADMIN_TOKEN'] = savedToken;
    } else {
      delete process.env['NACHOS_ADMIN_TOKEN'];
    }
  });

  describe('token validation via Authorization header', () => {
    it('allows request with valid Bearer token', async () => {
      const app = createApp('my-secret-token');

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer my-secret-token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it('rejects request with invalid Bearer token', async () => {
      const app = createApp('my-secret-token');

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer wrong-token' },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects request with no Authorization header and no cookie', async () => {
      const app = createApp('my-secret-token');

      const res = await app.request('/api/test');

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('rejects request with non-Bearer Authorization header', async () => {
      const app = createApp('my-secret-token');

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('token validation via cookie', () => {
    it('allows request with valid cookie token', async () => {
      const app = createApp('cookie-secret');

      const res = await app.request('/api/test', {
        headers: { Cookie: 'nachos_admin_token=cookie-secret' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it('rejects request with invalid cookie token', async () => {
      const app = createApp('cookie-secret');

      const res = await app.request('/api/test', {
        headers: { Cookie: 'nachos_admin_token=wrong-value' },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('auto-generated token', () => {
    it('generates a token when NACHOS_ADMIN_TOKEN is not set', async () => {
      const app = createApp(undefined);

      // Without any token, should be rejected
      const res = await app.request('/api/test');
      expect(res.status).toBe(401);
    });

    it('auto-generated token is consistent within a middleware instance', async () => {
      delete process.env['NACHOS_ADMIN_TOKEN'];

      const app = new Hono();
      app.use('/api/*', authMiddleware());
      app.get('/api/test', (c) => c.json({ ok: true }));

      // Both requests should fail since we do not know the auto-generated token
      const res1 = await app.request('/api/test', {
        headers: { Authorization: 'Bearer guess1' },
      });
      const res2 = await app.request('/api/test', {
        headers: { Authorization: 'Bearer guess2' },
      });

      expect(res1.status).toBe(401);
      expect(res2.status).toBe(401);
    });
  });

  describe('timing-safe comparison', () => {
    it('rejects tokens of different lengths', async () => {
      const app = createApp('exact-token');

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer short' },
      });

      expect(res.status).toBe(401);
    });

    it('rejects tokens that match in length but differ in content', async () => {
      const app = createApp('abcdefgh');

      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer abcdxxxx' },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Bearer header takes precedence over cookie', () => {
    it('uses Bearer token when both are provided', async () => {
      const app = createApp('the-right-token');

      // Valid Bearer + wrong cookie -> should succeed (Bearer takes precedence)
      const res = await app.request('/api/test', {
        headers: {
          Authorization: 'Bearer the-right-token',
          Cookie: 'nachos_admin_token=wrong-cookie',
        },
      });

      expect(res.status).toBe(200);
    });
  });
});
