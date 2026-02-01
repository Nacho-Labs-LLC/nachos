/**
 * Health check endpoint for the Gateway
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { HealthCheck, HealthStatus } from '@nachos/types';

const VERSION = '0.0.0';

/**
 * Health check dependencies
 */
export interface HealthCheckDeps {
  checkDatabase?: () => boolean;
  checkBus?: () => boolean;
}

/**
 * Health check server options
 */
export interface HealthServerOptions {
  port?: number;
  componentName?: string;
  deps?: HealthCheckDeps;
}

/**
 * Start time for uptime calculation
 */
let startTime: number = Date.now();

/**
 * Get the current uptime in seconds
 */
export function getUptime(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

/**
 * Reset the start time (for testing)
 */
export function resetStartTime(): void {
  startTime = Date.now();
}

/**
 * Perform health checks and return status
 */
export function performHealthCheck(deps?: HealthCheckDeps): HealthCheck {
  const checks: Record<string, 'ok' | 'error'> = {};
  let overallStatus: HealthStatus = 'healthy';

  // Check database
  if (deps?.checkDatabase) {
    try {
      const dbOk = deps.checkDatabase();
      checks['database'] = dbOk ? 'ok' : 'error';
      if (!dbOk) {
        overallStatus = 'degraded';
      }
    } catch {
      checks['database'] = 'error';
      overallStatus = 'degraded';
    }
  } else {
    checks['database'] = 'ok';
  }

  // Check bus connection
  if (deps?.checkBus) {
    try {
      const busOk = deps.checkBus();
      checks['bus'] = busOk ? 'ok' : 'error';
      if (!busOk) {
        overallStatus = 'degraded';
      }
    } catch {
      checks['bus'] = 'error';
      overallStatus = 'degraded';
    }
  } else {
    checks['bus'] = 'ok';
  }

  // If any critical check failed, mark as unhealthy
  const hasError = Object.values(checks).some((status) => status === 'error');
  if (hasError) {
    overallStatus = 'unhealthy';
  }

  return {
    status: overallStatus,
    component: 'gateway',
    version: VERSION,
    uptime: getUptime(),
    checks,
  };
}

/**
 * HTTP handler for health check endpoint
 */
function healthHandler(
  deps?: HealthCheckDeps
): (req: IncomingMessage, res: ServerResponse) => void {
  return (_req: IncomingMessage, res: ServerResponse) => {
    const health = performHealthCheck(deps);
    const statusCode = health.status === 'healthy' ? 200 : 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  };
}

/**
 * Create and start a health check HTTP server
 */
export function createHealthServer(options?: HealthServerOptions): {
  server: ReturnType<typeof createServer>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const port = options?.port ?? 8081;
  const deps = options?.deps;

  const server = createServer((req, res) => {
    // Only handle /health endpoint
    if (req.url === '/health' && req.method === 'GET') {
      healthHandler(deps)(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  });

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, () => {
          console.log(`Health server listening on port ${port}`);
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}
