import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createLogger } from '@nachos/types';
import { authMiddleware } from './middleware/auth.js';
import { configRouter } from './routes/config.js';
import { statusRouter } from './routes/status.js';
import { auditRouter } from './routes/audit.js';
import { sessionsRouter } from './routes/sessions.js';
import { skillsRouter } from './routes/skills.js';
import { servicesRouter } from './routes/services.js';
import { logsRouter } from './routes/logs.js';
import { chatRouter } from './routes/chat.js';
import { webchatRouter } from './routes/webchat.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const logger = createLogger('admin');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['PORT'] ?? '8082');

// In production: dist/server.js lives in dist/, public files in dist/public/
// In dev: serve-static path won't be hit; Vite dev server handles frontend
const publicDir = join(__dirname, 'public');

const app = new Hono();

app.use('*', honoLogger());
app.use(
  '/api/*',
  cors({
    // Allow only localhost origins — admin UI is not intended for cross-origin access
    origin: (origin) => {
      if (!origin) return null;
      try {
        const { hostname } = new URL(origin);
        // Allow localhost, 127.0.0.1, and private network IPs (LAN access)
        if (hostname === 'localhost' || hostname === '127.0.0.1') return origin;
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return origin;
        return null;
      } catch {
        return null;
      }
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);
app.use('/api/*', authMiddleware());

app.route('/api/config', configRouter);
app.route('/api/status', statusRouter);
app.route('/api/audit', auditRouter);
app.route('/api/sessions', sessionsRouter);
app.route('/api/skills', skillsRouter);
app.route('/api/services', servicesRouter);
app.route('/api/logs', logsRouter);
app.route('/api/chat', chatRouter);
app.route('/api/webchat', webchatRouter);

app.get('/api/health', (c) =>
  c.json({ status: 'ok', service: 'nachos-admin', timestamp: new Date().toISOString() })
);

// Serve built Vue SPA static assets
app.use('/*', serveStatic({ root: publicDir }));

// SPA fallback — return index.html for any unmatched route (client-side routing)
app.get('/*', serveStatic({ root: publicDir, path: '/index.html' }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info({ port: info.port, url: `http://localhost:${info.port}` }, 'Nachos Admin UI started');
  logger.info(
    { configPath: process.env['NACHOS_CONFIG_PATH'] ?? '/app/nachos.toml' },
    'Config path'
  );

  if (!process.env['NACHOS_ADMIN_TOKEN']) {
    logger.warn(
      'NACHOS_ADMIN_TOKEN is not set. A random admin token will be generated for this process. Set NACHOS_ADMIN_TOKEN in your environment to use a stable, operator-controlled token.'
    );
  }
});
