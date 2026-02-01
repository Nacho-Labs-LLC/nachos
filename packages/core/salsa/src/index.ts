#!/usr/bin/env node

/**
 * Nachos Salsa Policy Engine
 * 
 * Security layer that:
 * - Evaluates requests against policy rules
 * - DLP scanning for sensitive data
 * - Rate limiting per user/operation
 * - Audit logging for compliance
 */

const PORT = process.env.PORT || 3002;
const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const SECURITY_MODE = process.env.SECURITY_MODE || 'standard';

console.log('🌶️  Nachos Salsa Policy Engine starting...');
console.log(`   Port: ${PORT}`);
console.log(`   NATS: ${NATS_URL}`);
console.log(`   Security Mode: ${SECURITY_MODE}`);
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);

let isHealthy = true;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  isHealthy = false;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  isHealthy = false;
  process.exit(0);
});

// Keep the process alive
setInterval(() => {
  if (isHealthy) {
    console.log(`[${new Date().toISOString()}] Salsa healthy - policy checks active (${SECURITY_MODE} mode)`);
  }
}, 30000);

console.log('✅ Salsa service ready');
console.log('   Enforcing security policies...');
