/**
 * Port availability health checks
 */

import { createServer } from 'node:net';
import type { DoctorCheck } from '../types.js';

/**
 * Check if required ports are available
 */
export async function checkPorts(): Promise<DoctorCheck> {
  const requiredPorts = [
    { port: 3000, service: 'Gateway' },
    { port: 8080, service: 'Webchat' },
    { port: 4222, service: 'NATS' },
    { port: 6379, service: 'Redis' },
  ];

  const unavailable: string[] = [];

  for (const { port, service } of requiredPorts) {
    const isAvailable = await isPortAvailable(port);
    if (!isAvailable) {
      unavailable.push(`${port} (${service})`);
    }
  }

  if (unavailable.length > 0) {
    return {
      id: 'ports',
      name: 'Port Availability',
      status: 'warn',
      message: `Ports in use: ${unavailable.join(', ')}`,
      suggestion:
        'These ports may already be in use. Services will fail to start if ports are blocked.',
    };
  }

  return {
    id: 'ports',
    name: 'Port Availability',
    status: 'pass',
    message: 'All required ports available (3000, 8080, 4222, 6379)',
  };
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}
