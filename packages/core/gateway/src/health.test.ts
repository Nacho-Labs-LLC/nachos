import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  performHealthCheck,
  createHealthServer,
  getUptime,
  resetStartTime,
  type HealthCheckDeps,
} from './health.js';
import type { HookStats } from './hooks/index.js';

describe('Health Check', () => {
  beforeEach(() => {
    resetStartTime();
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when no deps provided', () => {
      const health = performHealthCheck();

      expect(health.status).toBe('healthy');
      expect(health.component).toBe('gateway');
      expect(health.version).toBeDefined();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.checks.database).toBe('ok');
      expect(health.checks.bus).toBe('ok');
    });

    it('should return healthy when all checks pass', () => {
      const deps: HealthCheckDeps = {
        checkDatabase: () => true,
        checkBus: () => true,
      };

      const health = performHealthCheck(deps);

      expect(health.status).toBe('healthy');
      expect(health.checks.database).toBe('ok');
      expect(health.checks.bus).toBe('ok');
    });

    it('should return unhealthy when database check fails', () => {
      const deps: HealthCheckDeps = {
        checkDatabase: () => false,
        checkBus: () => true,
      };

      const health = performHealthCheck(deps);

      expect(health.status).toBe('unhealthy');
      expect(health.checks.database).toBe('error');
      expect(health.checks.bus).toBe('ok');
    });

    it('should return unhealthy when bus check fails', () => {
      const deps: HealthCheckDeps = {
        checkDatabase: () => true,
        checkBus: () => false,
      };

      const health = performHealthCheck(deps);

      expect(health.status).toBe('unhealthy');
      expect(health.checks.database).toBe('ok');
      expect(health.checks.bus).toBe('error');
    });

    it('should return unhealthy when check throws error', () => {
      const deps: HealthCheckDeps = {
        checkDatabase: () => {
          throw new Error('Connection failed');
        },
        checkBus: () => true,
      };

      const health = performHealthCheck(deps);

      expect(health.status).toBe('unhealthy');
      expect(health.checks.database).toBe('error');
    });

    it('should return hooks ok when hook stats have no failures', () => {
      const hookStats: HookStats = {
        events: { 'message:received': { successCount: 5, failureCount: 0, timeoutCount: 0 } },
        totalEmits: 5,
        totalFailures: 0,
      };

      const health = performHealthCheck({
        checkDatabase: () => true,
        checkBus: () => true,
        getHookStats: () => hookStats,
      });

      expect(health.status).toBe('healthy');
      expect(health.checks['hooks']).toBe('ok');
      expect(health.hookStats).toEqual(hookStats);
    });

    it('should return hooks error without affecting overall status when hook stats have failures', () => {
      const hookStats: HookStats = {
        events: {
          'message:received': {
            successCount: 3,
            failureCount: 2,
            timeoutCount: 1,
            lastFailure: { error: 'boom', label: 'test', timestamp: new Date().toISOString() },
          },
        },
        totalEmits: 5,
        totalFailures: 2,
      };

      const health = performHealthCheck({
        checkDatabase: () => true,
        checkBus: () => true,
        getHookStats: () => hookStats,
      });

      // Hook failures should NOT make the gateway unhealthy — they are observability only
      expect(health.status).toBe('healthy');
      expect(health.checks['hooks']).toBe('error');
      expect(health.hookStats).toEqual(hookStats);
    });
  });

  describe('getUptime', () => {
    it('should return uptime in seconds', () => {
      const uptime = getUptime();
      expect(typeof uptime).toBe('number');
      expect(uptime).toBeGreaterThanOrEqual(0);
    });

    it('should increase over time', async () => {
      const uptime1 = getUptime();

      // Wait a short time
      await new Promise((resolve) => setTimeout(resolve, 100));

      const uptime2 = getUptime();
      expect(uptime2).toBeGreaterThanOrEqual(uptime1);
    });
  });

  describe('resetStartTime', () => {
    it('should reset the uptime counter', async () => {
      // Wait a bit to increase uptime
      await new Promise((resolve) => setTimeout(resolve, 50));

      resetStartTime();
      const uptime = getUptime();

      expect(uptime).toBeLessThan(1);
    });
  });
});

describe('Health Server', () => {
  let healthServer: ReturnType<typeof createHealthServer> | null = null;

  afterEach(async () => {
    if (healthServer && healthServer.server.listening) {
      await healthServer.stop();
    }
    healthServer = null;
  });

  describe('createHealthServer', () => {
    it('should create a health server', () => {
      healthServer = createHealthServer({ port: 8996 });

      expect(healthServer.server).toBeDefined();
      expect(typeof healthServer.start).toBe('function');
      expect(typeof healthServer.stop).toBe('function');
    });

    it('should start and stop the server', async () => {
      healthServer = createHealthServer({ port: 8995 });

      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await healthServer.start();
      await healthServer.stop();
    });

    it('should respond to /health endpoint', async () => {
      healthServer = createHealthServer({
        port: 8999,
        deps: {
          checkDatabase: () => true,
          checkBus: () => true,
        },
      });

      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await healthServer.start();

      // Make HTTP request to health endpoint
      const response = await fetch('http://localhost:8999/health');
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.component).toBe('gateway');
      expect(body.checks).toBeDefined();
    });

    it('should return 503 when unhealthy', async () => {
      healthServer = createHealthServer({
        port: 8998,
        deps: {
          checkDatabase: () => false,
          checkBus: () => true,
        },
      });

      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await healthServer.start();

      const response = await fetch('http://localhost:8998/health');
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.status).toBe('unhealthy');
    });

    it('should return 404 for unknown endpoints', async () => {
      healthServer = createHealthServer({ port: 8997 });

      // Mock console.log to suppress output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await healthServer.start();

      const response = await fetch('http://localhost:8997/unknown');

      expect(response.status).toBe(404);
    });
  });
});
